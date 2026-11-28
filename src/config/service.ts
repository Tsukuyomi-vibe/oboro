import type { ProfileStorage } from "../profile/repository";
import { readProfileRevision } from "../profile/repository";
import { PROFILE_REVISION_KEY, PROFILE_STORAGE_KEY, type RegionalProfile } from "../profile/types";
import { createRegionalProfile, parseRegionalProfile, profileToDraft } from "../profile/validation";
import { SITE_POLICY_KEY, createSitePolicy, parseSitePolicy, policyToDraft, ruleOrigins, type SitePolicy } from "../sites/policy";
import type { ActivationState } from "../activation/coordinator";
import { configObject, decodeConfiguration, parsePermissionHints, parseUiPreferences, parseUiRestore, permissionHintsFromGrants, readConfigurationFile } from "./format";
import {
  CONFIG_FORMAT, CONFIG_SCHEMA_VERSION, CONFIG_UI_RESTORE_KEY, CONFIG_PERMISSION_HINTS_KEY, CONFIG_IMPORT_JOURNAL_KEY, ConfigurationError,
  type ConfigurationFile, type ConfigurationImportResult, type ConfigurationPreview, type PermissionHints, type SavedConfiguration, type UiPreferences, type UiRestoreRecord
} from "./types";

interface StorageSnapshot {
  profile: RegionalProfile | null; profileClock: number; policy: SitePolicy;
  uiRestore: UiRestoreRecord | null; hints: PermissionHints;
}
interface ImportJournal { schemaVersion: 1; previous: StorageSnapshot; }
interface PendingPreview { view: ConfigurationPreview; baseline: string; created: number; }
interface Dependencies {
  storage: ProfileStorage; loadProfile(): Promise<RegionalProfile | null>; loadPolicy(): Promise<SitePolicy>;
  disable(): Promise<Pick<ActivationState, "status" | "enabled" | "phase">>;
  origins(): Promise<string[]>; contains(origins: string[]): Promise<boolean>; id(): string; version(): string;
}
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** All methods run inside the worker's shared ConfigurationQueue. */
export class ConfigurationService {
  private previews = new Map<string, PendingPreview>();
  private pendingRecovery: ImportJournal | null = null;
  constructor(private readonly dependencies: Dependencies) {}

  private async snapshot(): Promise<StorageSnapshot> {
    const { storage } = this.dependencies;
    const [profile, policy, restored, hints] = await Promise.all([
      this.dependencies.loadProfile(), this.dependencies.loadPolicy(), storage.get(CONFIG_UI_RESTORE_KEY), storage.get(CONFIG_PERMISSION_HINTS_KEY)
    ]);
    return { profile, profileClock: await readProfileRevision(storage, profile?.revision ?? 0), policy,
      uiRestore: parseUiRestore(restored[CONFIG_UI_RESTORE_KEY]), hints: hints[CONFIG_PERMISSION_HINTS_KEY] == null ? { origins: [] } : parsePermissionHints(hints[CONFIG_PERMISSION_HINTS_KEY]) };
  }
  private settings(snapshot: StorageSnapshot, ui: UiPreferences): SavedConfiguration {
    return { profile: snapshot.profile && profileToDraft(snapshot.profile), sitePolicy: policyToDraft(snapshot.policy), ui };
  }
  private storageValues(snapshot: StorageSnapshot): Record<string, unknown> {
    return { [PROFILE_STORAGE_KEY]: snapshot.profile, [PROFILE_REVISION_KEY]: snapshot.profileClock, [SITE_POLICY_KEY]: snapshot.policy,
      [CONFIG_UI_RESTORE_KEY]: snapshot.uiRestore, [CONFIG_PERMISSION_HINTS_KEY]: snapshot.hints };
  }
  private readJournal(value: unknown): ImportJournal | null {
    if (value == null) return null;
    const journal = configObject(value, ["schemaVersion", "previous"]);
    const previous = configObject(journal.previous, ["profile", "profileClock", "policy", "uiRestore", "hints"]);
    if (journal.schemaVersion !== 1 || typeof previous.profileClock !== "number" || !Number.isSafeInteger(previous.profileClock) || previous.profileClock < 0) {
      throw new ConfigurationError("CONFIG_RECOVERY_REQUIRED", "Повреждён журнал импорта. Сохранённые данные оставлены без изменений.");
    }
    const profile = previous.profile === null ? null : parseRegionalProfile(previous.profile);
    if (previous.profileClock < (profile?.revision ?? 0)) throw new ConfigurationError("CONFIG_RECOVERY_REQUIRED", "Повреждён счётчик версий профиля.");
    return { schemaVersion: 1, previous: { profile, profileClock: previous.profileClock, policy: parseSitePolicy(previous.policy), uiRestore: parseUiRestore(previous.uiRestore), hints: parsePermissionHints(previous.hints) } };
  }
  private async ensureDisabled(): Promise<void> {
    const state = await this.dependencies.disable();
    if (state.enabled || state.status === "ERROR" || state.phase !== "idle") throw new ConfigurationError("CONFIG_CLEANUP_FAILED", "Не удалось подтвердить отключение подмен. Конфигурация не заменена.");
  }
  private async verify(snapshot: StorageSnapshot): Promise<void> {
    if (!equal(await this.snapshot(), snapshot)) throw new ConfigurationError("CONFIG_WRITE_UNCONFIRMED", "Не удалось подтвердить запись конфигурации.");
  }
  private async clearJournal(): Promise<void> {
    await this.dependencies.storage.set({ [CONFIG_IMPORT_JOURNAL_KEY]: null });
    if ((await this.dependencies.storage.get(CONFIG_IMPORT_JOURNAL_KEY))[CONFIG_IMPORT_JOURNAL_KEY] != null) throw new ConfigurationError("CONFIG_RECOVERY_REQUIRED", "Не удалось завершить журнал импорта.");
  }
  async recover(): Promise<void> {
    const journal = this.pendingRecovery ?? this.readJournal((await this.dependencies.storage.get(CONFIG_IMPORT_JOURNAL_KEY))[CONFIG_IMPORT_JOURNAL_KEY]);
    if (!journal) return;
    this.pendingRecovery = journal;
    try {
      await this.ensureDisabled();
      // An interrupted import has not been acknowledged. Restore the previous
      // coherent settings; never resume activation from a configuration file.
      await this.dependencies.storage.set({ [CONFIG_IMPORT_JOURNAL_KEY]: journal });
      await this.dependencies.storage.set(this.storageValues(journal.previous));
      await this.verify(journal.previous);
      await this.clearJournal();
    } catch { throw new ConfigurationError("CONFIG_RECOVERY_REQUIRED", "Результат импорта не подтверждён. Запись заблокирована до восстановления; перезагрузите расширение и проверьте настройки."); }
    this.pendingRecovery = null; this.previews.clear();
  }
  async uiRestore(): Promise<UiRestoreRecord | null> { return (await this.snapshot()).uiRestore; }
  async export(uiValue: unknown): Promise<ConfigurationFile> {
    const ui = parseUiPreferences(uiValue), snapshot = await this.snapshot();
    const grants = permissionHintsFromGrants(await this.dependencies.origins());
    return readConfigurationFile({ format: CONFIG_FORMAT, schemaVersion: CONFIG_SCHEMA_VERSION, oboroVersion: this.dependencies.version(),
      config: this.settings(snapshot, ui), permissionHints: { origins: [...new Set([...snapshot.hints.origins, ...grants.origins])] } });
  }
  async preview(text: unknown, uiValue: unknown): Promise<ConfigurationPreview> {
    const decoded = decodeConfiguration(text), ui = parseUiPreferences(uiValue), snapshot = await this.snapshot();
    const current = this.settings(snapshot, ui);
    const view: ConfigurationPreview = { id: this.dependencies.id(), kind: decoded.kind, sourceOboroVersion: decoded.sourceOboroVersion, sourceSchemaVersion: decoded.sourceSchemaVersion,
      discardedGeolocationSettings: decoded.discardedGeolocationSettings,
      current, proposed: decoded.kind === "configuration" ? decoded.file.config : { ...current, profile: decoded.profile },
      permissionHints: decoded.kind === "configuration" ? decoded.file.permissionHints : snapshot.hints };
    if (this.previews.size >= 8) { const oldest = this.previews.keys().next().value; if (oldest) this.previews.delete(oldest); }
    this.previews.set(view.id, { view, baseline: JSON.stringify(snapshot), created: Date.now() });
    return view;
  }
  async missingAccess(): Promise<string[]> {
    const snapshot = await this.snapshot();
    const needed = [...new Set([...snapshot.hints.origins, ...(snapshot.policy.mode === "selected_sites" ? snapshot.policy.include.flatMap(ruleOrigins) : [])])].sort();
    const granted = await Promise.all(needed.map((origin) => this.dependencies.contains([origin])));
    return needed.filter((_, index) => !granted[index]);
  }
  async import(id: unknown): Promise<ConfigurationImportResult> {
    const pending = typeof id === "string" ? this.previews.get(id) : undefined;
    if (!pending || Date.now() - pending.created > 10 * 60_000) throw new ConfigurationError("CONFIG_PREVIEW_EXPIRED", "Предпросмотр устарел. Выберите файл и проверьте изменения ещё раз.");
    this.previews.delete(pending.view.id);
    const previous = await this.snapshot();
    if (JSON.stringify(previous) !== pending.baseline) throw new ConfigurationError("CONFIG_CONFLICT", "Настройки изменились после предпросмотра. Проверьте файл ещё раз; данные не заменены.");
    const { proposed, kind } = pending.view;
    if (kind === "configuration" && previous.policy.policyRevision === Number.MAX_SAFE_INTEGER || proposed.profile !== null && previous.profileClock === Number.MAX_SAFE_INTEGER) throw new ConfigurationError("CONFIG_REVISION_LIMIT", "Достигнут предел версий настроек; конфигурация не заменена.");
    const next: StorageSnapshot = {
      profile: proposed.profile === null ? null : createRegionalProfile(proposed.profile, previous.profileClock + 1),
      profileClock: previous.profileClock + (proposed.profile === null ? 0 : 1),
      policy: kind === "profile" ? previous.policy : createSitePolicy(proposed.sitePolicy, previous.policy.policyRevision + 1),
      uiRestore: kind === "profile" ? previous.uiRestore : { schemaVersion: 1, token: this.dependencies.id(), ui: proposed.ui },
      hints: pending.view.permissionHints
    };
    await this.ensureDisabled();
    const journal: ImportJournal = { schemaVersion: 1, previous };
    this.pendingRecovery = journal;
    try {
      await this.dependencies.storage.set({ [CONFIG_IMPORT_JOURNAL_KEY]: journal });
      await this.dependencies.storage.set(this.storageValues(next));
      await this.verify(next);
      await this.clearJournal();
      this.pendingRecovery = null; this.previews.clear();
    } catch {
      try { await this.recover(); }
      catch { throw new ConfigurationError("CONFIG_RECOVERY_REQUIRED", "Результат импорта не подтверждён. Запись заблокирована до восстановления; перезагрузите расширение и проверьте настройки."); }
      throw new ConfigurationError("CONFIG_IMPORT_FAILED", "Импорт не завершён. Предыдущие настройки восстановлены, подмены выключены.");
    }
    let missingOrigins: string[] = [];
    // Failure to inspect permissions must not turn a verified import into an
    // ambiguous failure. The UI refreshes access independently after saving.
    try { missingOrigins = await this.missingAccess(); } catch { /* No permissions are requested here. */ }
    return { profileRevision: next.profile?.revision ?? 0, policyRevision: next.policy.policyRevision, missingOrigins };
  }
}
