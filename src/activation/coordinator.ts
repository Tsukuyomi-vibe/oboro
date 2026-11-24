import type { ProfileStorage } from "../profile/repository";
import type { RegionalProfile } from "../profile/types";
import { parseRegionalProfile } from "../profile/validation";
import { parseSitePolicy, ruleOrigins, selectedScopes, resolveSite, type SitePolicy } from "../sites/policy";
import { compileActivation, createRuntimeSnapshot } from "../runtime/compiler";
import type { RuntimeSnapshot } from "../runtime/types";
import { TIME_RUNTIME_LIMITATIONS } from "../runtime/types";
import { CAPABILITY_EVIDENCE_KEY, validateCapabilityEvidence } from "./capabilities";
import type { inspectProductCapabilities } from "./capabilities";
import type { ActivationBackend } from "./backend";
import type { FrameRegistry } from "./frames";
import {
  ACTIVATION_JOURNAL_KEY, ACTIVATION_SNAPSHOT_KEY, parseActivationJournal, parseActivationSnapshot,
  parseActivationVersion, sameVersion, snapshotVersion, type ActivationJournal, type ActivationVersion
} from "./persistence";

export { ACTIVATION_JOURNAL_KEY, ACTIVATION_SNAPSHOT_KEY } from "./persistence";
export type { ActivationVersion } from "./persistence";
export const ACTIVATION_KEY = "activationState";
export type ActivationStatus = "OFF" | "PREPARING" | "READY" | "LIMITED" | "ERROR" | "NEEDS_RELOAD" | "OUT_OF_SCOPE";
export interface ActivationState {
  status: ActivationStatus; enabled: boolean; pending: ActivationVersion | null; committed: ActivationVersion | null;
  reasons: string[]; staticReasons: string[]; targets: number[]; reloadTabs: number[]; updatedAt: string;
  buildVersion: string; phase: "idle" | "prepared" | "awaiting_documents";
  recovery: "none" | "resumed" | "rebuilt" | "rolled_back" | "cleared" | "failed";
}
export interface ActivationDependencies {
  storage: ProfileStorage; backend: ActivationBackend; frames: FrameRegistry;
  loadProfile(): Promise<RegionalProfile | null>; loadPolicy(): Promise<SitePolicy>;
  origins(): Promise<string[]>; contains(origins: string[]): Promise<boolean>;
  capabilities(): ReturnType<typeof inspectProductCapabilities>;
  setEnabled(enabled: boolean): Promise<void>; id(): string; buildVersion?: string;
}
const initialState = (buildVersion: string): ActivationState => ({
  status: "OFF", enabled: false, pending: null, committed: null, reasons: [], staticReasons: [], targets: [], reloadTabs: [],
  updatedAt: new Date().toISOString(), buildVersion, phase: "idle", recovery: "none"
});
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length <= 1000).slice(0, 64) : [];
const text = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Mutations are serialized by the service worker's shared configuration queue. */
export class ActivationCoordinator {
  private state: ActivationState;
  private journal: ActivationJournal | null = null;
  private epoch = 0;
  private lastCleanupAudit = 0;
  private lastResyncAudit = 0;
  activeSnapshot: RuntimeSnapshot | null = null;
  constructor(private readonly dependencies: ActivationDependencies) { this.state = initialState(this.buildVersion); }
  private get buildVersion(): string { return this.dependencies.buildVersion ?? "development"; }
  view(): ActivationState { return JSON.parse(JSON.stringify(this.state)) as ActivationState; }
  environmentChanged(): void { this.epoch += 1; if (this.activeSnapshot) this.dependencies.frames.markReload(); }
  private assertEpoch(epoch: number): void { if (epoch !== this.epoch) throw new Error("Конфигурация или доступы изменились во время применения."); }
  private async update(patch: Partial<ActivationState>, extra: Record<string, unknown> = {}): Promise<ActivationState> {
    const candidate: ActivationState = { ...this.state, ...patch, buildVersion: this.buildVersion };
    if (!Object.keys(extra).length && JSON.stringify(candidate) === JSON.stringify(this.state)) return this.view();
    const next: ActivationState = { ...candidate, updatedAt: new Date().toISOString() };
    try { await this.dependencies.storage.set({ ...extra, [ACTIVATION_KEY]: next }); }
    catch (error) {
      this.state = { ...this.state, status: "ERROR", recovery: "failed", reasons: ["Запись состояния не подтверждена. Повторите проверку или отключение.", text(error)] };
      throw error;
    }
    this.state = next; return this.view();
  }
  private async checkpoint(journal: ActivationJournal, patch: Partial<ActivationState>): Promise<void> {
    await this.update({ ...patch, phase: journal.phase }, {
      [ACTIVATION_JOURNAL_KEY]: journal,
      ...(journal.phase === "awaiting_documents" ? { [ACTIVATION_SNAPSHOT_KEY]: journal.target } : {})
    });
    this.journal = journal;
  }
  private async check(snapshot: RuntimeSnapshot, epoch = this.epoch): Promise<void> {
    const [rawProfile, rawPolicy, origins, capabilities, evidence] = await Promise.all([
      this.dependencies.loadProfile(), this.dependencies.loadPolicy(), this.dependencies.origins(),
      this.dependencies.capabilities(), this.dependencies.storage.get(CAPABILITY_EVIDENCE_KEY)
    ]);
    this.assertEpoch(epoch);
    const record = evidence[CAPABILITY_EVIDENCE_KEY];
    validateCapabilityEvidence(record && typeof record === "object" && "report" in record ? record.report : null, capabilities.environment.exactChromeVersion);
    if (!capabilities.available) throw new Error(capabilities.reasons.join(" "));
    const currentProfile = rawProfile && parseRegionalProfile(rawProfile); const currentPolicy = parseSitePolicy(rawPolicy);
    const current = currentProfile && createRuntimeSnapshot(currentProfile, currentPolicy, origins, snapshot.activationId, snapshot.geolocationOneShot);
    if (!current || JSON.stringify(current.profile) !== JSON.stringify(snapshot.profile) || JSON.stringify(current.policy) !== JSON.stringify(snapshot.policy) ||
        JSON.stringify(current.grantedOrigins) !== JSON.stringify(snapshot.grantedOrigins)) throw new Error("Профиль, политика или доступы больше не совпадают со снимком.");
  }
  private async staticReasons(snapshot: RuntimeSnapshot): Promise<string[]> {
    const missing = snapshot.policy.mode === "selected_sites" &&
      (await Promise.all(snapshot.policy.include.map((rule) => this.dependencies.contains(ruleOrigins(rule))))).some((allowed) => !allowed);
    return [...TIME_RUNTIME_LIMITATIONS, ...(missing ? ["Для части выбранных правил доступ не выдан полностью."] : [])];
  }
  private async clearOwned(enabledAfter: boolean, reason: string, status: ActivationStatus = "NEEDS_RELOAD"): Promise<ActivationState> {
    const intent: ActivationJournal = { schemaVersion: 1, kind: "clear", phase: "prepared", target: null, previous: null, enabledAfter };
    try {
      await this.checkpoint(intent, { status: "PREPARING", enabled: enabledAfter, recovery: "none" });
      await this.dependencies.setEnabled(enabledAfter);
      this.activeSnapshot = null; this.dependencies.frames.markReload();
      await this.dependencies.backend.clear();
      const reload = this.dependencies.frames.needsReload;
      const result = await this.update({
        status: status === "ERROR" ? "ERROR" : !enabledAfter ? reload ? "NEEDS_RELOAD" : "OFF" : status,
        enabled: enabledAfter, pending: null, committed: null, phase: "idle", recovery: "cleared",
        targets: [], staticReasons: [], reloadTabs: [...new Set(this.dependencies.frames.list().filter((frame) => frame.status === "NEEDS_RELOAD").map((frame) => frame.tabId))],
        reasons: [reason, ...(reload ? ["Уже обработанные документы требуют перезагрузки; будущие подмены сняты."] : [])].filter(Boolean)
      }, { [ACTIVATION_JOURNAL_KEY]: null, [ACTIVATION_SNAPSHOT_KEY]: null });
      this.journal = null; return result;
    } catch (error) {
      this.activeSnapshot = null; this.dependencies.frames.markReload();
      return this.update({ status: "ERROR", enabled: enabledAfter, recovery: "failed", reasons: [reason, text(error), "Очистка не подтверждена; успешное отключение не объявлено."] });
    }
  }
  private async rollback(previous: RuntimeSnapshot | null, failure: string): Promise<ActivationState> {
    this.activeSnapshot = null; this.dependencies.frames.markReload();
    if (previous) {
      try {
        await this.check(previous);
        const plan = compileActivation(previous);
        await this.dependencies.backend.restore({ main: plan.mainScript ? [plan.mainScript] : [], bridge: plan.bridgeScript ? [plan.bridgeScript] : [], rules: plan.networkRules });
        if (!await this.dependencies.backend.registrationsMatch(plan)) throw new Error("Восстановленные регистрации не совпали.");
        await this.check(previous);
        const waiting: ActivationJournal = { schemaVersion: 1, kind: "apply", phase: "awaiting_documents", target: previous, previous: null, enabledAfter: true };
        await this.checkpoint(waiting, { status: "ERROR", enabled: true, committed: null, pending: snapshotVersion(previous), recovery: "rolled_back",
          reasons: [failure, "Предыдущая проверенная конфигурация восстановлена. Документам нужна повторная проверка или перезагрузка."] });
        this.activeSnapshot = previous; return this.view();
      } catch { /* A stale or unverified previous configuration must never be restored. */ }
    }
    return this.clearOwned(this.state.enabled, failure, "ERROR");
  }
  private async verify(snapshot: RuntimeSnapshot, targets: number[], extraReasons: string[] = [], recovery: ActivationState["recovery"] = this.state.recovery, wait = true): Promise<ActivationState> {
    const epoch = this.epoch;
    const coverage = wait ? await this.dependencies.backend.waitForDocuments(snapshot, targets) : this.dependencies.frames.verification(snapshot, targets);
    await this.check(snapshot, epoch);
    if (!await this.dependencies.backend.registrationsMatch(compileActivation(snapshot))) throw new Error("Фактические регистрации или DNR-правила изменились.");
    this.assertEpoch(epoch);
    const staticReasons = await this.staticReasons(snapshot);
    this.assertEpoch(epoch);
    const reasons = [...new Set([...staticReasons, ...extraReasons, ...coverage.reasons])];
    if (!coverage.complete) return this.update({
      status: coverage.needsReload || recovery === "rebuilt" ? "NEEDS_RELOAD" : "LIMITED",
      targets, staticReasons, recovery, reasons: [...reasons, "Не все документы подтвердили текущую версию; требуется проверка или перезагрузка."]
    });
    const completedPatch: Partial<ActivationState> = {
      status: reasons.length ? "LIMITED" : "READY", targets, staticReasons, recovery, phase: "idle", pending: null,
      committed: snapshotVersion(snapshot), reloadTabs: [], reasons
    };
    if (!this.journal && sameVersion(snapshot, this.state.committed) && this.state.phase === "idle") return this.update(completedPatch);
    const result = await this.update(completedPatch, { [ACTIVATION_JOURNAL_KEY]: null, [ACTIVATION_SNAPSHOT_KEY]: snapshot });
    this.journal = null; return result;
  }
  private async resume(snapshot: RuntimeSnapshot, rebuild: boolean): Promise<void> {
    await this.check(snapshot);
    let target = snapshot;
    if (rebuild) {
      target = createRuntimeSnapshot(snapshot.profile, snapshot.policy, snapshot.grantedOrigins, this.dependencies.id(), snapshot.geolocationOneShot);
      const intent: ActivationJournal = { schemaVersion: 1, kind: "apply", phase: "prepared", target, previous: snapshot, enabledAfter: true };
      await this.checkpoint(intent, { status: "PREPARING", enabled: true, pending: snapshotVersion(target), recovery: "rebuilt" });
      this.dependencies.frames.markReload(target);
      await this.dependencies.backend.install(compileActivation(target));
      if (!await this.dependencies.backend.registrationsMatch(compileActivation(target))) throw new Error("Пересборка регистраций не подтверждена.");
      await this.check(target);
      await this.checkpoint({ ...intent, phase: "awaiting_documents" }, { status: "NEEDS_RELOAD", recovery: "rebuilt" });
    }
    this.activeSnapshot = target;
    const targets = await this.dependencies.backend.resync?.(target) ?? [];
    await this.verify(target, targets, [], rebuild ? "rebuilt" : "resumed");
  }
  async initialize(): Promise<void> {
    await this.dependencies.frames.initialize();
    const [stateData, journalData, snapshotData] = await Promise.all([
      this.dependencies.storage.get(ACTIVATION_KEY), this.dependencies.storage.get(ACTIVATION_JOURNAL_KEY), this.dependencies.storage.get(ACTIVATION_SNAPSHOT_KEY)
    ]);
    const raw = stateData[ACTIVATION_KEY]; let snapshot: RuntimeSnapshot | null = null;
    let savedBuild: unknown;
    try {
      if (raw !== undefined) {
        if (!raw || typeof raw !== "object" || !("enabled" in raw) || typeof raw.enabled !== "boolean") throw new Error("Повреждено состояние применения.");
        const saved = raw as Partial<ActivationState>; savedBuild = saved.buildVersion;
        this.state = { ...initialState(this.buildVersion), enabled: raw.enabled, committed: parseActivationVersion(saved.committed), pending: parseActivationVersion(saved.pending), staticReasons: strings(saved.staticReasons) };
      }
      this.journal = parseActivationJournal(journalData[ACTIVATION_JOURNAL_KEY]);
      snapshot = parseActivationSnapshot(snapshotData[ACTIVATION_SNAPSHOT_KEY]);
    } catch (error) { await this.clearOwned(false, text(error), "ERROR"); return; }
    if (this.journal?.kind === "clear") { await this.clearOwned(this.journal.enabledAfter, "Завершена прерванная очистка."); return; }
    if (this.journal?.kind === "apply") {
      const intent = this.journal;
      if (intent.phase === "prepared") { await this.rollback(intent.previous, "Применение прервано до подтверждения регистраций."); return; }
      try {
        if (!intent.target || !sameVersion(intent.target, this.state.pending)) throw new Error("Журнал не совпадает с pending.");
        await this.check(intent.target);
        const matches = await this.dependencies.backend.registrationsMatch(compileActivation(intent.target));
        await this.resume(intent.target, !matches || savedBuild !== this.buildVersion);
      } catch (error) { await this.rollback(intent.previous, text(error)); }
      return;
    }
    if (this.state.enabled && this.state.committed) {
      try {
        if (!snapshot) {
          const [profile, policy, origins] = await Promise.all([this.dependencies.loadProfile(), this.dependencies.loadPolicy(), this.dependencies.origins()]);
          if (!profile) throw new Error("Профиль отсутствует.");
          snapshot = createRuntimeSnapshot(parseRegionalProfile(profile), parseSitePolicy(policy), origins, this.state.committed.activationId, true);
        }
        if (!sameVersion(snapshot, this.state.committed)) throw new Error("Снимок не совпадает с committed.");
        await this.check(snapshot);
        const matches = await this.dependencies.backend.registrationsMatch(compileActivation(snapshot));
        await this.resume(snapshot, !matches || savedBuild !== this.buildVersion);
      } catch (error) { await this.clearOwned(this.state.enabled, text(error), "ERROR"); }
      return;
    }
    // OFF and missing/corrupt metadata do not prove that no owned registrations remain.
    try {
      const owned = await this.dependencies.backend.readOwned();
      if (owned.main.length || owned.bridge.length || owned.rules.length || this.state.pending) await this.clearOwned(this.state.enabled, "Удалены регистрации без подтверждённой версии.", this.state.enabled ? "NEEDS_RELOAD" : "OFF");
      else if (raw !== undefined) await this.update({ status: this.dependencies.frames.needsReload ? "NEEDS_RELOAD" : this.state.enabled ? "LIMITED" : "OFF", pending: null, committed: null, phase: "idle", reasons: [] }, { [ACTIVATION_SNAPSHOT_KEY]: null });
    } catch (error) { await this.update({ status: "LIMITED", recovery: "failed", reasons: ["Не удалось проверить оставшиеся регистрации. Настройки профиля доступны; применение не подтверждено.", text(error)] }); }
  }
  async reconcileAfterUpdate(): Promise<void> {
    if (!this.activeSnapshot) { await this.audit(); return; }
    const previous = this.activeSnapshot;
    try { await this.resume(previous, !await this.dependencies.backend.registrationsMatch(compileActivation(previous))); }
    catch (error) { await this.rollback(previous, "Обновление расширения: " + text(error)); }
  }
  async audit(): Promise<void> {
    if (this.journal?.kind === "clear") {
      if (Date.now() - this.lastCleanupAudit < 5000) return;
      this.lastCleanupAudit = Date.now();
      if ((await this.dependencies.capabilities()).available) await this.clearOwned(this.journal.enabledAfter, "Повторная проверка незавершённой очистки.");
      return;
    }
    if (!this.activeSnapshot) return;
    try {
      await this.check(this.activeSnapshot);
      if (!await this.dependencies.backend.registrationsMatch(compileActivation(this.activeSnapshot))) throw new Error("Регистрации или сетевые правила изменились.");
      if (Date.now() - this.lastResyncAudit >= 1500) {
        this.lastResyncAudit = Date.now();
        await this.dependencies.backend.resync?.(this.activeSnapshot);
        await this.refreshCoverage();
      }
    } catch (error) { await this.invalidate(text(error)); }
  }
  async importEvidence(value: unknown): Promise<ActivationState> {
    const capabilities = await this.dependencies.capabilities();
    const certificate = validateCapabilityEvidence(value, capabilities.environment.exactChromeVersion);
    await this.dependencies.storage.set({ [CAPABILITY_EVIDENCE_KEY]: { certificate, report: value } });
    return this.update({ reasons: ["Совместимость Chrome подтверждена отчётом Oboro Check. Можно применить профиль."] });
  }
  async invalidate(reason: string): Promise<void> {
    if (!this.activeSnapshot && !this.journal && !this.state.pending && !this.state.committed) return;
    await this.clearOwned(this.state.enabled, reason);
    if (this.state.status === "ERROR") throw new Error(this.state.reasons.join(" "));
  }
  async disable(): Promise<ActivationState> { this.environmentChanged(); return this.clearOwned(false, "Будущие подмены отключены."); }
  async apply(): Promise<ActivationState> {
    const previous = this.activeSnapshot; const epoch = this.epoch;
    try {
      await this.dependencies.setEnabled(true);
      await this.update({ enabled: true, status: "PREPARING", recovery: "none", reasons: [], staticReasons: [] });
      const [rawProfile, rawPolicy, origins, capabilities] = await Promise.all([
        this.dependencies.loadProfile(), this.dependencies.loadPolicy(), this.dependencies.origins(), this.dependencies.capabilities()
      ]);
      this.assertEpoch(epoch);
      if (!rawProfile) return await this.clearOwned(true, "Сначала сохраните региональный профиль.", "LIMITED");
      const profile = parseRegionalProfile(rawProfile); const policy = parseSitePolicy(rawPolicy);
      if (!selectedScopes(policy, origins).length) return await this.clearOwned(true, "Нет выбранных адресов с выданным доступом. Пустой список ничего не включает.", "OUT_OF_SCOPE");
      if (!capabilities.available) return await this.clearOwned(true, capabilities.reasons.join(" "), "LIMITED");
      const evidence = (await this.dependencies.storage.get(CAPABILITY_EVIDENCE_KEY))[CAPABILITY_EVIDENCE_KEY];
      try { validateCapabilityEvidence(evidence && typeof evidence === "object" && "report" in evidence ? evidence.report : null, capabilities.environment.exactChromeVersion); }
      catch (error) { return await this.clearOwned(true, "Импортируйте полный отчёт проверки совместимости для текущего Chrome. " + text(error), "LIMITED"); }
      this.assertEpoch(epoch);
      const snapshot = createRuntimeSnapshot(profile, policy, origins, this.dependencies.id(), true);
      await this.dependencies.backend.readOwned();
      const intent: ActivationJournal = { schemaVersion: 1, kind: "apply", phase: "prepared", target: snapshot, previous, enabledAfter: true };
      await this.checkpoint(intent, { status: "PREPARING", pending: snapshotVersion(snapshot), targets: [], reloadTabs: [] });
      this.dependencies.frames.markReload(snapshot); this.activeSnapshot = snapshot;
      this.assertEpoch(epoch);
      await this.dependencies.backend.install(compileActivation(snapshot));
      if (!await this.dependencies.backend.registrationsMatch(compileActivation(snapshot))) throw new Error("Регистрации или сетевые правила не подтвердились после применения.");
      await this.check(snapshot, epoch);
      await this.checkpoint({ ...intent, phase: "awaiting_documents" }, {});
      const reloaded = await this.dependencies.backend.reloadSelected(snapshot);
      this.assertEpoch(epoch);
      await this.update({ targets: reloaded.targets, reloadTabs: reloaded.manualTabs });
      return await this.verify(snapshot, reloaded.targets, reloaded.reasons);
    } catch (error) { return this.rollback(previous, text(error)); }
  }
  async refreshCoverage(): Promise<void> {
    if (!this.state.enabled) {
      if (!this.dependencies.frames.needsReload && this.state.status === "NEEDS_RELOAD") await this.update({ status: "OFF", reasons: [], reloadTabs: [] });
      return;
    }
    if (!this.activeSnapshot || this.state.status === "PREPARING" || this.state.status === "ERROR") return;
    try { await this.verify(this.activeSnapshot, this.state.targets, [], this.state.recovery, false); }
    catch (error) { await this.invalidate(text(error)); }
  }
  async removeTab(tabId: number): Promise<void> {
    this.dependencies.frames.removeTab(tabId);
    this.state.targets = this.state.targets.filter((entry) => entry !== tabId);
    this.state.reloadTabs = this.state.reloadTabs.filter((entry) => entry !== tabId);
    await this.refreshCoverage();
  }
  async rootNavigated(tabId: number, url: string): Promise<void> {
    if (this.activeSnapshot && resolveSite(url, this.activeSnapshot.policy, this.activeSnapshot.grantedOrigins).selection !== "selected") {
      this.state.targets = this.state.targets.filter((entry) => entry !== tabId);
      this.state.reloadTabs = this.state.reloadTabs.filter((entry) => entry !== tabId);
    }
    await this.refreshCoverage();
  }
}
