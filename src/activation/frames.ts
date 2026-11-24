import { httpUrl, resolveSite } from "../sites/policy";
import { RUNTIME_IMPLEMENTATION, type RuntimeReport, type RuntimeSnapshot } from "../runtime/types";
import type { ProfileStorage } from "../profile/repository";
import { isKeyboardLayoutId } from "../keyboard/layouts";
import { authenticatePageRuntimeReport } from "../runtime/report";

export const FRAME_REGISTRY_KEY = "frameRegistry";
export type FrameLifecycle = "active" | "cached" | "unconfirmed" | "prerender";
export interface FrameRecord {
  tabId: number; frameId: number; documentId: string; parentFrameId: number; rootDocumentId: string;
  origin: string; originVerified: boolean; urlKind: string; lifecycle: FrameLifecycle; lastEvent: string;
  selection: "selected" | "excluded" | "not_selected" | "unsupported"; granted: boolean;
  activationId: string | null; profileRevision: number | null; policyRevision: number | null;
  expectedActivationId: string | null; expectedProfileRevision: number | null; expectedPolicyRevision: number | null;
  status: "PENDING" | "INSTALLED" | "NEEDS_RELOAD" | "OUT_OF_SCOPE" | "UNSUPPORTED" | "LIMITED";
  implementation: number | null; languages: RuntimeReport["languages"] | null;
  geolocation: RuntimeReport["geolocation"] | null; locale: RuntimeReport["locale"] | null; time: RuntimeReport["time"] | null;
  timeCoverage: RuntimeReport["timeCoverage"] | null; temporal: RuntimeReport["temporal"] | null;
  keyboard: RuntimeReport["keyboard"] | null; keyboardLayout: RuntimeReport["keyboardLayout"] | null; keyboardReason: string | null;
  timeCompatibility: RuntimeReport["timeCompatibility"] | null; reasons: string[]; telemetryTrusted: false;
}
export interface NavigationFrame {
  tabId: number; frameId: number; documentId: string; parentFrameId: number; url: string;
  documentLifecycle?: string; transitionType?: string;
}
const nullableRevision = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
function urlKind(value: string): string { try { return new URL(value).protocol.replace(":", ""); } catch { return "unknown"; } }
function emptyModules() {
  return { implementation: null, languages: null, geolocation: null, locale: null, time: null, timeCoverage: null,
    temporal: null, keyboard: null, keyboardLayout: null, keyboardReason: null, timeCompatibility: null } as const;
}
export class FrameRegistry {
  private frames = new Map<string, FrameRecord>();
  private history = new Map<string, FrameRecord>();
  private completed = new Map<number, string>();
  private saving: Promise<void> = Promise.resolve();
  persistenceLimited = false;
  constructor(private readonly storage: ProfileStorage) {}
  async initialize(): Promise<void> {
    this.frames.clear(); this.history.clear(); this.completed.clear();
    try {
      const data = (await this.storage.get(FRAME_REGISTRY_KEY))[FRAME_REGISTRY_KEY];
      if (data === undefined) return;
      if (!Array.isArray(data) || data.length > 1000) throw new Error("Invalid frame registry");
      for (const item of data) {
        if (!item || typeof item !== "object" || !Number.isInteger(item.tabId) || !Number.isInteger(item.frameId) || typeof item.documentId !== "string" || item.documentId.length > 200 || typeof item.origin !== "string" || item.origin.length > 2048 ||
            !["selected", "excluded", "not_selected", "unsupported"].includes(item.selection) || typeof item.granted !== "boolean") { this.persistenceLimited = true; continue; }
        const activationId = typeof item.activationId === "string" && item.activationId.length <= 100 ? item.activationId : null;
        const record: FrameRecord = {
          tabId: item.tabId, frameId: item.frameId, documentId: item.documentId, parentFrameId: Number.isInteger(item.parentFrameId) ? item.parentFrameId : -1,
          rootDocumentId: typeof item.rootDocumentId === "string" ? item.rootDocumentId : item.frameId === 0 ? item.documentId : "",
          origin: item.origin, originVerified: false, urlKind: typeof item.urlKind === "string" ? item.urlKind : "unknown",
          lifecycle: item.lifecycle === "cached" || item.lifecycle === "unconfirmed" ? item.lifecycle : item.lifecycle === "prerender" ? "prerender" : "active",
          lastEvent: "worker_restart", selection: item.selection, granted: item.granted, activationId,
          profileRevision: nullableRevision(item.profileRevision), policyRevision: nullableRevision(item.policyRevision),
          expectedActivationId: null, expectedProfileRevision: null, expectedPolicyRevision: null,
          status: activationId ? "NEEDS_RELOAD" : item.selection === "unsupported" ? "UNSUPPORTED" : item.selection === "selected" ? "PENDING" : "OUT_OF_SCOPE",
          ...emptyModules(), reasons: ["После перезапуска требуется новое наблюдение документа."], telemetryTrusted: false
        };
        if (record.lifecycle === "cached" || record.lifecycle === "unconfirmed") this.history.set(record.tabId + ":" + record.documentId, record);
        else this.frames.set(record.tabId + ":" + record.frameId, record);
      }
    } catch { this.persistenceLimited = true; }
  }
  private persist(): void {
    const data = this.list();
    this.saving = this.saving.then(() => this.storage.set({ [FRAME_REGISTRY_KEY]: data })).catch(() => { this.persistenceLimited = true; });
  }
  flush(): Promise<void> { return this.saving; }
  list(): FrameRecord[] { return JSON.parse(JSON.stringify([...this.frames.values(), ...this.history.values()])) as FrameRecord[]; }
  hasTab(tabId: number): boolean { return [...this.frames.values(), ...this.history.values()].some((entry) => entry.tabId === tabId); }
  private clearActive(tabId: number): void { for (const [key, frame] of this.frames) if (frame.tabId === tabId) this.frames.delete(key); this.completed.delete(tabId); }
  removeTab(tabId: number): void {
    this.clearActive(tabId); for (const [key, frame] of this.history) if (frame.tabId === tabId) this.history.delete(key); this.persist();
  }
  reconcileTabs(tabIds: readonly number[]): void {
    const open = new Set(tabIds);
    for (const frame of [...this.frames.values(), ...this.history.values()]) if (!open.has(frame.tabId)) this.removeTab(frame.tabId);
  }
  reconcileTabFrames(tabId: number, documentIds: readonly string[]): void {
    const current = new Set(documentIds);
    for (const [key, frame] of this.frames) if (frame.tabId === tabId && !current.has(frame.documentId)) {
      if (frame.activationId) this.stash(frame, "unconfirmed");
      this.frames.delete(key);
    }
    this.persist();
  }
  private stash(record: FrameRecord, lifecycle: "cached" | "unconfirmed"): void {
    if (!record.activationId) return;
    if (this.history.size >= 200 && !this.history.has(record.tabId + ":" + record.documentId)) { this.persistenceLimited = true; return; }
    this.history.set(record.tabId + ":" + record.documentId, { ...record, lifecycle, lastEvent: lifecycle === "cached" ? "pagehide.persisted" : "departed" });
  }
  observe(frame: NavigationFrame, snapshot: RuntimeSnapshot | null, trackTab = false, event = "navigation"): void {
    const key = frame.tabId + ":" + frame.frameId;
    const previous = this.frames.get(key);
    const cachedKey = frame.tabId + ":" + frame.documentId;
    const cached = this.history.get(cachedKey);
    if (!snapshot) {
      if (frame.frameId === 0 && previous?.documentId !== frame.documentId) {
        if (frame.transitionType !== "reload") for (const record of this.frames.values()) if (record.tabId === frame.tabId) this.stash(record, "unconfirmed");
        this.clearActive(frame.tabId);
      }
      if (cached) {
        this.history.delete(cachedKey);
        this.frames.set(key, { ...cached, lifecycle: "active", lastEvent: "bfcache_return", expectedActivationId: null, expectedProfileRevision: null, expectedPolicyRevision: null,
          status: "NEEDS_RELOAD", reasons: ["Возвращён документ с прежними обёртками; подмены выключены или изменены."] });
      } else if (previous?.documentId === frame.documentId) { previous.lastEvent = event; if (previous.activationId) previous.status = "NEEDS_RELOAD"; }
      else if (frame.frameId !== 0) this.frames.delete(key);
      this.persist(); return;
    }
    const decision = resolveSite(frame.url, snapshot.policy, snapshot.grantedOrigins);
    if (decision.selection !== "selected" && !this.hasTab(frame.tabId) && !trackTab) return;
    if (frame.frameId === 0 && previous?.documentId !== frame.documentId) {
      if (frame.transitionType !== "reload") for (const record of this.frames.values()) if (record.tabId === frame.tabId) this.stash(record, "unconfirmed");
      this.clearActive(frame.tabId);
    }
    const existing = previous?.documentId === frame.documentId ? previous : cached;
    if (cached) this.history.delete(cachedKey);
    if (!existing && this.frames.size + this.history.size >= 1000) { this.persistenceLimited = true; return; }
    const selected = decision.selection === "selected";
    const lifecycle: FrameLifecycle = frame.documentLifecycle === "prerender" ? "prerender" : "active";
    const nativeRoot = frame.frameId === 0 ? frame.documentId : this.frames.get(frame.tabId + ":0")?.documentId ?? "";
    const base: FrameRecord = existing ?? {
      tabId: frame.tabId, frameId: frame.frameId, documentId: frame.documentId, parentFrameId: frame.parentFrameId, rootDocumentId: nativeRoot,
      origin: httpUrl(frame.url)?.origin ?? "null", originVerified: false, urlKind: urlKind(frame.url), lifecycle, lastEvent: event,
      selection: decision.selection, granted: decision.granted, activationId: null, profileRevision: null, policyRevision: null,
      expectedActivationId: null, expectedProfileRevision: null, expectedPolicyRevision: null, status: "PENDING",
      ...emptyModules(), reasons: [], telemetryTrusted: false
    };
    Object.assign(base, { parentFrameId: frame.parentFrameId, rootDocumentId: nativeRoot, lifecycle, lastEvent: cached ? "bfcache_return" : event,
      origin: httpUrl(frame.url)?.origin ?? "null", urlKind: urlKind(frame.url), selection: decision.selection, granted: decision.granted,
      expectedActivationId: selected ? snapshot.activationId : null, expectedProfileRevision: selected ? snapshot.profile.revision : null,
      expectedPolicyRevision: selected ? snapshot.policy.policyRevision : null });
    if (lifecycle === "prerender") { base.status = "UNSUPPORTED"; base.reasons = ["Пререндер не подтверждён до активации документа."]; }
    else if (decision.selection === "unsupported") { base.status = "UNSUPPORTED"; base.reasons = ["Адрес " + base.urlKind + " не имеет подтверждённой HTTP/HTTPS-области; подмена пропущена."]; }
    else if (!selected) {
      base.status = base.activationId ? "NEEDS_RELOAD" : "OUT_OF_SCOPE";
      base.reasons = [decision.selection === "excluded" ? "Документ исключён правилом." : "Документ не выбран текущим режимом."];
    } else if (!decision.granted) { base.status = "LIMITED"; base.reasons = ["Сайт выбран, но host permission не выдан."]; }
    else if (base.activationId && (base.activationId !== snapshot.activationId || base.profileRevision !== snapshot.profile.revision || base.policyRevision !== snapshot.policy.policyRevision || base.implementation !== RUNTIME_IMPLEMENTATION)) {
      base.status = "NEEDS_RELOAD"; base.reasons = ["Документ содержит прежнюю версию; возврат из BFCache не применяет новый профиль."];
    } else if (!base.activationId) { base.status = "PENDING"; base.reasons = ["Ранняя установка и origin документа ещё не подтверждены."]; }
    this.frames.set(key, base); this.persist();
  }
  complete(tabId: number, documentId: string): void {
    if (this.frames.get(tabId + ":0")?.documentId === documentId) this.completed.set(tabId, documentId);
  }
  navigationError(tabId: number, frameId: number, documentId?: string): void {
    const frame = this.frames.get(tabId + ":" + frameId);
    if (!frame || documentId && frame.documentId !== documentId) return;
    frame.status = "LIMITED"; frame.reasons = ["Навигация документа завершилась ошибкой; покрытие не подтверждено."];
    if (frameId === 0) this.completed.delete(tabId); this.persist();
  }
  markReload(expected: RuntimeSnapshot | null = null): void {
    for (const frame of [...this.frames.values(), ...this.history.values()]) if (frame.activationId !== null || frame.status === "PENDING") {
      frame.status = "NEEDS_RELOAD"; frame.reasons = ["Конфигурация изменилась; документ требует перезагрузки."];
      const selected = expected && resolveSite(frame.origin + "/", expected.policy, expected.grantedOrigins).selection === "selected";
      frame.expectedActivationId = selected ? expected.activationId : null;
      frame.expectedProfileRevision = selected ? expected.profile.revision : null;
      frame.expectedPolicyRevision = selected ? expected.policy.policyRevision : null;
    }
    this.persist();
  }
  get needsReload(): boolean { return [...this.frames.values(), ...this.history.values()].some((entry) => entry.status === "NEEDS_RELOAD"); }
  private sender(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
    return sender.id === extensionId && Number.isInteger(sender.tab?.id) && Number.isInteger(sender.frameId) && typeof sender.documentId === "string" && sender.documentId.length > 0 && sender.documentId.length <= 200 && typeof sender.url === "string";
  }
  context(sender: chrome.runtime.MessageSender, event: string, persisted: boolean, snapshot: RuntimeSnapshot | null, extensionId: string): boolean {
    if (!this.sender(sender, extensionId) || !["initial", "pageshow", "pagehide", "ping"].includes(event)) return false;
    const tabId = sender.tab!.id!; const frameId = sender.frameId!; const documentId = sender.documentId!;
    const key = tabId + ":" + frameId; const historicalKey = tabId + ":" + documentId;
    const old = this.frames.get(key)?.documentId === documentId ? this.frames.get(key) : this.history.get(historicalKey);
    if (event === "pagehide") {
      if (!old || !["active", "cached"].includes(sender.documentLifecycle ?? "") || sender.origin !== old.origin) return false;
      if (persisted) {
        if (frameId === 0) {
          for (const [entryKey, entry] of this.frames) if (entry.tabId === tabId) { this.stash(entry, "cached"); this.frames.delete(entryKey); }
        } else { this.stash(old, "cached"); this.frames.delete(key); }
        if (this.history.has(historicalKey)) this.history.get(historicalKey)!.lifecycle = "cached";
      } else {
        this.history.delete(historicalKey);
        if (frameId === 0) {
          for (const [entryKey, entry] of this.history) if (entry.tabId === tabId && entry.rootDocumentId === documentId) this.history.delete(entryKey);
          if (this.frames.get(key)?.documentId === documentId) this.clearActive(tabId);
        }
        if (this.frames.get(key)?.documentId === documentId) this.frames.delete(key);
      }
      if (frameId === 0) this.completed.delete(tabId); this.persist(); return true;
    }
    if (sender.documentLifecycle !== "active" || !httpUrl(sender.url!) || typeof sender.origin !== "string") return false;
    if (sender.origin !== httpUrl(sender.url!)!.origin) {
      if (sender.origin !== "null" || !snapshot) return false;
      this.observe({ tabId, frameId, documentId, parentFrameId: old?.parentFrameId ?? -1, url: sender.url! }, snapshot, false, event);
      const record = this.frames.get(key);
      if (!record || record.documentId !== documentId) return false;
      record.status = "UNSUPPORTED"; record.origin = "null"; record.originVerified = true; record.reasons = ["Нативный sender сообщает непрозрачный origin; API пропущены."]; this.persist(); return true;
    }
    if (!old || old.lifecycle === "cached" || old.lifecycle === "unconfirmed") this.observe({ tabId, frameId, documentId, parentFrameId: old?.parentFrameId ?? -1, url: sender.url! }, snapshot, false, event);
    const record = this.frames.get(key);
    if (!record || record.documentId !== documentId) return false;
    record.originVerified = true; record.lastEvent = event;
    if (event === "pageshow" && frameId === 0) this.complete(tabId, documentId);
    this.persist(); return true;
  }
  accept(sender: chrome.runtime.MessageSender, value: unknown, snapshot: RuntimeSnapshot, extensionId: string): boolean {
    if (!this.sender(sender, extensionId) || sender.documentLifecycle !== "active" || sender.origin !== httpUrl(sender.url!)?.origin) return false;
    const decision = resolveSite(sender.url!, snapshot.policy, snapshot.grantedOrigins);
    if (decision.selection !== "selected" || !decision.granted || typeof value !== "object" || value === null) return false;
    const report = authenticatePageRuntimeReport(value, snapshot, sender.origin!);
    if (!report) return false;
    if (!["installed", "error"].includes(report.locale ?? "")) return false;
    if (!["installed", "partial", "error"].includes(report.time ?? "") || !report.timeCoverage || typeof report.timeCoverage !== "object" || !["formatting", "localRead", "construction", "parse", "localSetters", "temporal", "complete"].every((key) => typeof (report.timeCoverage as unknown as Record<string, unknown>)[key] === "boolean")) return false;
    if (!["installed", "absent", "unsupported", "error", "not_checked"].includes(report.temporal ?? "")) return false;
    if (!["native", "installed", "unsupported", "error", "not_checked"].includes(report.keyboard ?? "") || !isKeyboardLayoutId(report.keyboardLayout) || !(report.keyboardReason === null || typeof report.keyboardReason === "string" && report.keyboardReason.length <= 1000)) return false;
    const compatibility = report.timeCompatibility;
    if (!compatibility || !["passed", "failed", "not_run"].includes(compatibility.status) || !["passed", "absent", "failed", "not_run"].includes(compatibility.structuredClone)
      || !Array.isArray(compatibility.checks) || compatibility.checks.length > 32 || !compatibility.checks.every((entry) => typeof entry === "string" && entry.length <= 128)
      || !Array.isArray(compatibility.failures) || compatibility.failures.length > 16 || !compatibility.failures.every((entry) => typeof entry === "string" && entry.length <= 1000)) return false;
    if (typeof report.activationId !== "string" || !Number.isSafeInteger(report.profileRevision) || !Number.isSafeInteger(report.policyRevision) || !["loading", "interactive", "complete"].includes(report.readyState ?? "") || !["installed", "error"].includes(report.languages ?? "") || !["installed", "unsupported", "error", "not_implemented"].includes(report.geolocation ?? "") || typeof report.needsReload !== "boolean") return false;
    if (report.implementation !== RUNTIME_IMPLEMENTATION) return false;
    const key = sender.tab!.id + ":" + sender.frameId;
    let frame = this.frames.get(key);
    if (frame && frame.documentId !== sender.documentId) return false;
    if (!frame) {
      this.observe({ tabId: sender.tab!.id!, frameId: sender.frameId!, documentId: sender.documentId!, parentFrameId: -1, url: sender.url! }, snapshot);
      frame = this.frames.get(key);
    }
    if (!frame) return false;
    const current = report.activationId === snapshot.activationId && report.profileRevision === snapshot.profile.revision && report.policyRevision === snapshot.policy.policyRevision;
    Object.assign(frame, { activationId: report.activationId, profileRevision: report.profileRevision, policyRevision: report.policyRevision,
      implementation: report.implementation, languages: report.languages, geolocation: report.geolocation, locale: report.locale, time: report.time,
      temporal: report.temporal, keyboard: report.keyboard, keyboardLayout: report.keyboardLayout, keyboardReason: report.keyboardReason, originVerified: true,
      timeCoverage: { formatting: report.timeCoverage.formatting, localRead: report.timeCoverage.localRead, construction: report.timeCoverage.construction, parse: report.timeCoverage.parse, localSetters: report.timeCoverage.localSetters, temporal: report.timeCoverage.temporal, complete: report.timeCoverage.complete },
      timeCompatibility: { status: compatibility.status, structuredClone: compatibility.structuredClone, checks: [...compatibility.checks], failures: [...compatibility.failures] } });
    const dateCovered = (["formatting", "localRead", "construction", "parse", "localSetters"] as const).every((name) => report.timeCoverage?.[name] === true);
    const temporalCovered = report.temporal === "installed" && report.timeCoverage.temporal || report.temporal === "absent" && !report.timeCoverage.temporal;
    const timeCovered = report.time === "installed" && report.timeCoverage.complete && dateCovered && temporalCovered && compatibility.status === "passed" && !compatibility.failures.length && ["passed", "absent"].includes(compatibility.structuredClone);
    const requestedKeyboard = snapshot.profile.keyboardLayout ?? "native";
    const keyboardCovered = report.keyboardLayout === requestedKeyboard && report.keyboard === (requestedKeyboard === "native" ? "native" : "installed");
    frame.status = !current || report.needsReload || report.readyState !== "loading" ? "NEEDS_RELOAD" : report.languages === "installed" && report.locale === "installed" && timeCovered && keyboardCovered && (!snapshot.geolocationOneShot || report.geolocation === "installed") ? "INSTALLED" : "LIMITED";
    frame.reasons = Array.isArray(report.reasons) ? report.reasons.filter((entry): entry is string => typeof entry === "string" && entry.length <= 1000).slice(0, 16) : [];
    if (frame.status === "NEEDS_RELOAD") frame.reasons.push("Версия или ранняя установка не совпадает; перезагрузите документ.");
    else if (frame.status === "LIMITED" && !frame.reasons.length) frame.reasons.push("Часть запрошенных модулей не установлена.");
    this.persist(); return true;
  }
  verification(snapshot: RuntimeSnapshot, expectedTabs: readonly number[]) {
    const active = [...this.frames.values()].filter((frame) => frame.lifecycle === "active");
    const selectedTabs = new Set([...expectedTabs, ...active.filter((frame) => frame.selection === "selected" || frame.expectedActivationId === snapshot.activationId).map((frame) => frame.tabId)]);
    const reasons: string[] = []; let complete = true; let needsReload = false;
    for (const tabId of selectedTabs) {
      const root = this.frames.get(tabId + ":0");
      if (!root || this.completed.get(tabId) !== root.documentId || root.selection === "selected" && root.activationId !== snapshot.activationId) complete = false;
    }
    for (const frame of active) {
      if (!selectedTabs.has(frame.tabId)) continue;
      if (frame.selection === "selected") {
        if (frame.status !== "INSTALLED" || frame.activationId !== snapshot.activationId || !frame.originVerified) complete = false;
        if (frame.status === "NEEDS_RELOAD") needsReload = true;
        if (frame.status !== "INSTALLED") reasons.push(...frame.reasons);
        if (frame.time !== "installed") reasons.push(...(frame.timeCompatibility?.failures ?? []).map((failure) => "Модуль времени: " + failure));
        if (frame.keyboardReason) reasons.push("Карта раскладки: " + frame.keyboardReason);
      }
      if (frame.status === "UNSUPPORTED") { complete = false; reasons.push(...frame.reasons); }
      if (frame.selection !== "unsupported" && !frame.granted) reasons.push("У части контекстов нет host permission; заголовки запросов могут остаться исходными.");
    }
    for (const frame of this.history.values()) if (frame.status === "NEEDS_RELOAD") {
      complete = false; needsReload = true; reasons.push("Кэшированный или неактивный документ содержит прежнюю версию. Вернитесь к нему и перезагрузите либо закройте вкладку.");
    }
    if (this.persistenceLimited) { complete = false; reasons.push("Наблюдения сохранены не полностью; отсутствие других пробелов покрытия не доказано."); }
    return { complete, needsReload, reasons: [...new Set(reasons)] };
  }
}
