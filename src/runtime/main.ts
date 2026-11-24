import { httpUrl, resolveSite } from "../sites/policy";
import { installLanguageRuntime } from "./language";
import { installGeolocationRuntime } from "./geolocation";
import { emptyTimeCompatibility, installTimeRuntime } from "./time";
import { installKeyboardRuntime } from "./keyboard";
import { authenticatePageRuntimeReport, createDocumentNonce, createPageRuntimeReport, readPageRuntimeReport } from "./report";
import { PAGE_QUERY, PAGE_REPORT, RUNTIME_IMPLEMENTATION, type PageRuntimeReport, type RuntimeReport, type RuntimeSnapshot } from "./types";

export function installMainRuntime(snapshot: RuntimeSnapshot): PageRuntimeReport | null {
  if (globalThis.origin !== httpUrl(location.href)?.origin || globalThis.origin === "null") return null;
  const decision = resolveSite(location.href, snapshot.policy, snapshot.grantedOrigins);
  if (decision.selection !== "selected" || !decision.granted) return null;
  const key = Symbol.for("regional-profile.runtime.v1");
  const root = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const post = window.postMessage.bind(window);
  const existing = root[key];
  // Never pass a private identifier to a page-owned function. The existing
  // marker exposes only a zero-argument, document-local public report.
  if (typeof existing === "function") {
    let page: PageRuntimeReport | null = null;
    try { page = readPageRuntimeReport(existing()); } catch { /* An unrelated page marker is not trusted. */ }
    if (page && authenticatePageRuntimeReport(page, snapshot, globalThis.origin)) {
      post({ type: PAGE_REPORT, report: page }, "*"); return page;
    }
  }
  const nonce = createDocumentNonce();
  const report: RuntimeReport = {
    implementation: RUNTIME_IMPLEMENTATION,
    activationId: snapshot.activationId, profileRevision: snapshot.profile.revision,
    policyRevision: snapshot.policy.policyRevision, readyState: document.readyState,
    languages: "error", locale: "error", time: "error",
    temporal: "not_checked", timeCompatibility: emptyTimeCompatibility(),
    keyboard: "not_checked", keyboardLayout: snapshot.profile.keyboardLayout ?? "native", keyboardReason: null,
    timeCoverage: Object.freeze({ formatting: false, localRead: false, construction: false, parse: false, localSetters: false, temporal: false, complete: false }),
    geolocation: "not_implemented", needsReload: document.readyState !== "loading", reasons: []
  };
  if (existing !== undefined) {
    report.needsReload = true;
    report.reasons.push("Документ содержит прежнюю версию. Перезагрузите страницу для применения изменений.");
  }
  else if (document.readyState !== "loading") report.reasons.push("Ранняя установка пропущена. Поздняя подмена не выполняется; перезагрузите документ.");
  else {
    try { installLanguageRuntime(snapshot.profile); report.languages = "installed"; }
    catch (error) { report.reasons.push(error instanceof Error ? error.message : "Ошибка языкового модуля."); }
    const time = installTimeRuntime(snapshot.profile);
    report.locale = time.locale; report.time = time.time; report.temporal = time.temporal;
    report.timeCoverage = time.timeCoverage; report.timeCompatibility = time.timeCompatibility;
    report.reasons.push(...time.reasons);
    const keyboard = installKeyboardRuntime(report.keyboardLayout);
    report.keyboard = keyboard.status;
    report.keyboardReason = keyboard.reason ?? null;
    if (keyboard.reason) report.reasons.push(keyboard.reason);
    if (snapshot.geolocationOneShot) {
      try {
        const result = installGeolocationRuntime(snapshot.profile.geolocation);
        report.geolocation = result.status;
        if (result.reason) report.reasons.push(result.reason);
      } catch (error) { report.geolocation = "error"; report.reasons.push(error instanceof Error ? error.message : "Ошибка геолокации."); }
    }
  }
  const frozen = createPageRuntimeReport(snapshot, report, globalThis.origin, nonce);
  if (existing !== undefined) { post({ type: PAGE_REPORT, report: frozen }, "*"); return frozen; }
  Object.defineProperty(root, key, { value: Object.freeze(() => frozen), configurable: false });
  const announce = (): void => post({ type: PAGE_REPORT, report: frozen }, "*");
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source === window && typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === PAGE_QUERY) announce();
  });
  announce();
  return frozen;
}
