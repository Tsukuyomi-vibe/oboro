import { assessEvidence } from "../probe/evidence";
import { readChromeEnvironment } from "../probe/capabilities";

export const CAPABILITY_EVIDENCE_KEY = "capabilityEvidence";
export interface CapabilityCertificate { schemaVersion: 1; chromeVersion: string; verifiedAt: string; sourceExtensionId: string; }
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function validateCapabilityEvidence(value: unknown, chromeVersion: string | null): CapabilityCertificate {
  const report = record(value); const session = record(report?.session); const baseline = record(report?.nativeBaseline);
  const server = record(report?.serverReports);
  if (!chromeVersion || report?.format !== "region-i02-evidence-v1" || !session || !baseline || !server || (session.scheme !== "http" && session.scheme !== "https")) throw new Error("Нужен полный JSON-отчёт проверки совместимости Oboro Check и точная версия текущего Chrome.");
  if (typeof baseline.runId !== "string") throw new Error("В отчёте нет исходного запуска без расширения.");
  const results = [assessEvidence(baseline.report, "baseline", baseline.runId, session.scheme)];
  for (const phase of ["baseline", "armed", "off"] as const) {
    if (typeof session[phase] !== "string") throw new Error(`В отчёте отсутствует запуск ${phase}.`);
    results.push(assessEvidence(server[phase], phase, session[phase], session.scheme, server.baseline));
  }
  if (results.some((result) => result.status !== "PASS" || result.chromeVersions.length !== 1 || result.chromeVersions[0] !== chromeVersion)) throw new Error("Проверки совместимости неполны, не пройдены или относятся к другой версии Chrome.");
  const inspections = Array.isArray(session.inspections) ? session.inspections.map(record).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
  const usable = inspections.filter((entry) => record(entry.environment)?.exactChromeVersion === chromeVersion && entry.hostAccess === true && record(entry.dnr)?.available === true && typeof entry.extensionId === "string" && /^[a-p]{32}$/.test(entry.extensionId));
  const enabled = usable.find((entry) => entry.toggleObservedByUser === "on" && record(entry.userScripts)?.available === true);
  const disabled = usable.find((entry) => entry.toggleObservedByUser === "off" && record(entry.userScripts)?.available === false && entry.extensionId === enabled?.extensionId);
  const cleanup = record(session.cleanup);
  if (!enabled || !disabled || cleanup?.scriptsCleared !== true || cleanup.rulesCleared !== true || !Array.isArray(cleanup.errors) || cleanup.errors.length) throw new Error("Нет подтверждения переключателя Allow User Scripts или завершённой очистки диагностической пробы.");
  return Object.freeze({ schemaVersion: 1, chromeVersion, verifiedAt: new Date().toISOString(), sourceExtensionId: enabled.extensionId as string });
}

export async function inspectProductCapabilities() {
  const environment = await readChromeEnvironment();
  const reasons: string[] = [];
  for (const [label, test] of [
    ["userScripts / Allow User Scripts", () => chrome.userScripts.getScripts()],
    ["DNR", () => chrome.declarativeNetRequest.getDynamicRules()],
    ["Изолированный диагностический канал", () => chrome.scripting.getRegisteredContentScripts()],
    ["Реестр документов", () => { if (!chrome.webNavigation?.getAllFrames) throw new Error("webNavigation unavailable"); return Promise.resolve(); }]
  ] as const) {
    try { await test(); } catch { reasons.push(`Недоступен ${label}.`); }
  }
  if (!environment.exactChromeVersion) reasons.push("Не получена точная версия Google Chrome.");
  return { environment, available: reasons.length === 0, reasons };
}
