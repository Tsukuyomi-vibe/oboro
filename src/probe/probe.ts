import { setText, setPlainText } from "../ui/i18n";
import { armProbe, clearProbe, errorText, inspectCapabilities } from "./capabilities";
import { config, fixtureOrigin, SESSION_KEY, type FixtureScheme } from "./definition";
import { assessEvidence, type Phase } from "./evidence";

interface Inspection extends Awaited<ReturnType<typeof inspectCapabilities>> {
  toggleObservedByUser: "not-recorded" | "on" | "off";
}
interface Session {
  scheme: FixtureScheme;
  baseline: string | null;
  armed: string | null;
  off: string | null;
  inspections: Inspection[];
  cleanup: Awaited<ReturnType<typeof clearProbe>> | null;
}
const emptySession = (): Session => ({ scheme: "http", baseline: null, armed: null, off: null, inspections: [], cleanup: null });
let session = emptySession();
const NATIVE_BASELINE_KEY = "i02NativeBaseline";
let nativeBaseline: { report: unknown; runId: string; fileName: string; importedAt: string } | null = null;
const reports: Record<Phase, unknown> = { baseline: null, armed: null, off: null };

function validInspection(value: unknown): value is Inspection {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<Inspection>;
  return typeof entry.hostAccess === "boolean" && typeof entry.userScripts?.available === "boolean" &&
    typeof entry.dnr?.available === "boolean" && typeof entry.environment === "object" && entry.environment !== null &&
    (entry.environment.exactChromeVersion === null || typeof entry.environment.exactChromeVersion === "string") &&
    ["not-recorded", "on", "off"].includes(entry.toggleObservedByUser ?? "");
}

function element<T extends HTMLElement>(id: string, constructor: { new (): T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof constructor)) throw new Error(`Отсутствует элемент ${id}`);
  return found;
}
const feedback = element("feedback", HTMLElement);
const output = element("output", HTMLElement);
const links = element("fixture-links", HTMLElement);
const scheme = element("scheme", HTMLSelectElement);
const toggle = element("toggle-observed", HTMLSelectElement);
const nativeFile = element("native-baseline", HTMLInputElement);
const allButtons = [...document.querySelectorAll<HTMLButtonElement>("button")];

function resetReports(): void {
  for (const phase of ["baseline", "armed", "off"] as const) reports[phase] = null;
}
async function persist(): Promise<void> {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}
function renderLinks(): void {
  scheme.value = session.scheme;
  scheme.disabled = session.armed !== null && session.off === null;
  links.replaceChildren();
  for (const phase of ["baseline", "armed", "off"] as const) {
    const runId = session[phase];
    if (!runId) continue;
    const heading = document.createElement("h3");
    setPlainText(heading, `${phase} · ${runId}`);
    links.append(heading);
    const list = document.createElement("div");
    list.className = "fixture-list";
    for (const host of config.hosts) {
      const link = document.createElement("a");
      link.href = `${fixtureOrigin(host.host, session.scheme)}/?run=${runId}`;
      setText(link, host.label);
      link.target = "_blank";
      link.rel = "noopener";
      list.append(link);
    }
    links.append(list);
  }
}
function createReport() {
  const evidence = {
    uninstalled: assessEvidence(nativeBaseline?.report, "baseline", nativeBaseline?.runId ?? "", session.scheme),
    baseline: assessEvidence(reports.baseline, "baseline", session.baseline ?? "", session.scheme),
    armed: assessEvidence(reports.armed, "armed", session.armed ?? "", session.scheme, reports.baseline),
    off: assessEvidence(reports.off, "off", session.off ?? "", session.scheme, reports.baseline)
  };
  const observedOff = session.inspections.some((entry) => entry.toggleObservedByUser === "off" && !entry.userScripts.available && entry.hostAccess && entry.dnr.available);
  const observedOn = session.inspections.some((entry) => entry.toggleObservedByUser === "on" && entry.userScripts.available);
  const toggleVerified = observedOn && observedOff;
  const cleanupVerified = session.cleanup?.rulesCleared === true && session.cleanup.scriptsCleared;
  const allBuilds = new Set([
    ...Object.values(evidence).flatMap((entry) => entry.chromeVersions),
    ...session.inspections.flatMap((entry) => entry.environment.exactChromeVersion ? [entry.environment.exactChromeVersion] : [])
  ]);
  const sameChromeBuild = allBuilds.size === 1;
  const confirmed = Object.values(evidence).every((entry) => entry.status === "PASS") && toggleVerified && cleanupVerified && sameChromeBuild;
  return {
    format: "region-i02-evidence-v1", exportedAt: new Date().toISOString(),
    status: confirmed ? "CONFIRMED" : "NOT_CONFIRMED",
    note: "Регистрация API сама по себе не доказывает раннее выполнение или изменение заголовка. Решение опирается на снимки первого скрипта и серверные запросы.",
    toggleVerified, cleanupVerified, sameChromeBuild, nativeBaseline, session, evidence, serverReports: reports
  };
}
function renderReport(): void {
  setPlainText(output, JSON.stringify(createReport(), null, 2));
}
async function readReport(runId: string): Promise<unknown> {
  const origin = fixtureOrigin(config.hosts[0]!.host, session.scheme);
  const response = await fetch(`${origin}/api/report?run=${runId}`, { cache: "no-store", credentials: "omit" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Серверный отчёт: HTTP ${response.status}`);
  return response.json();
}
async function checkServer(selectedScheme: FixtureScheme): Promise<void> {
  const response = await fetch(`${fixtureOrigin(config.hosts[0]!.host, selectedScheme)}/health`, { cache: "no-store", credentials: "omit" });
  const health: unknown = await response.json();
  if (!response.ok || typeof health !== "object" || health === null || !("fixture" in health) || health.fixture !== "region-i02") {
    throw new Error("На локальном адресе не найден сервер Oboro Check. Запустите npm run fixture.");
  }
}

async function inspect(): Promise<void> {
  const selected = toggle.value;
  const toggleObservedByUser = selected === "on" || selected === "off" ? selected : "not-recorded";
  session.inspections.push({ ...await inspectCapabilities(), toggleObservedByUser });
  session.inspections = session.inspections.slice(-20);
  await persist();
  setText(feedback, "API проверены. Успешная регистрация и наблюдения страниц проверяются отдельно.");
}
async function baseline(): Promise<void> {
  const selectedScheme: FixtureScheme = scheme.value === "https" ? "https" : "http";
  await checkServer(selectedScheme);
  const cleanup = await clearProbe();
  if (!cleanup.rulesCleared) throw new Error(`Не удалось снять сетевые правила: ${cleanup.errors.join("; ")}`);
  session = { ...emptySession(), scheme: selectedScheme, baseline: crypto.randomUUID(), inspections: session.inspections, cleanup };
  resetReports();
  await persist();
  setText(feedback, "Исходный запуск подготовлен. Откройте все четыре ссылки baseline и дождитесь записи наблюдений на каждой странице. Если расширение ещё не установлено, исходный запуск можно открыть с обычной страницы стенда по инструкции.");
}
async function arm(): Promise<void> {
  if (!session.baseline) throw new Error("Сначала подготовьте исходный запуск и соберите наблюдения baseline.");
  reports.baseline = await readReport(session.baseline);
  const baselineEvidence = assessEvidence(reports.baseline, "baseline", session.baseline, session.scheme);
  if (baselineEvidence.status !== "PASS") throw new Error(`Исходный запуск: ${baselineEvidence.status}. Откройте все страницы baseline и соберите отчёт.`);
  const runId = crypto.randomUUID();
  await armProbe(runId, session.scheme);
  try {
    session.armed = runId;
    session.off = null;
    session.cleanup = null;
    reports.armed = null;
    reports.off = null;
    await persist();
  } catch (error) { await clearProbe(); throw error; }
  setText(feedback, "Проба зарегистрирована до навигации. Откройте все четыре ссылки armed. Доступность API ещё не означает, что проверка пройдена.");
}
async function stop(): Promise<void> {
  session.cleanup = await clearProbe();
  session.off = crypto.randomUUID();
  reports.off = null;
  await persist();
  setText(feedback, session.cleanup.errors.length
    ? `Очистка не подтверждена полностью: ${session.cleanup.errors.join("; ")}. Проверьте ссылки off после перезагрузки страниц.`
    : "Регистрации и правила сняты. Откройте четыре ссылки off: уже открытые документы требуют новой загрузки.");
}
async function collect(): Promise<void> {
  const phases = ["baseline", "armed", "off"] as const;
  const results = await Promise.allSettled(phases.map(async (phase) => {
    const runId = session[phase];
    reports[phase] = null;
    reports[phase] = runId ? await readReport(runId) : null;
  }));
  const failures = results.filter((entry) => entry.status === "rejected");
  if (failures.length) throw new Error(failures.map((entry) => errorText(entry.reason)).join("; "));
  setText(feedback, `Результат: ${createReport().status}. Подробности и недостающие проверки приведены ниже.`);
}
function exportReport(): void {
  const blob = new Blob([JSON.stringify(createReport(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `region-i02-${new Date().toISOString().replaceAll(":", "-")}.json`;
  anchor.click();
  setText(feedback, "JSON сформирован и передан браузеру для скачивания.");
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
async function perform(action: () => Promise<void> | void): Promise<void> {
  for (const button of allButtons) button.disabled = true;
  nativeFile.disabled = true;
  setText(feedback, "Выполняется…");
  delete feedback.dataset.kind;
  try { await action(); }
  catch (error) { setText(feedback, errorText(error)); feedback.dataset.kind = "error"; }
  finally {
    renderLinks();
    renderReport();
    for (const button of allButtons) button.disabled = false;
    nativeFile.disabled = false;
  }
}
nativeFile.addEventListener("change", () => { void perform(async () => {
  const file = nativeFile.files?.[0];
  if (!file) return;
  if (file.size > 512_000) throw new Error("Исходный отчёт слишком велик: максимум 512 КБ.");
  const report: unknown = JSON.parse(await file.text());
  if (typeof report !== "object" || report === null || !("runId" in report) || typeof report.runId !== "string") throw new Error("В исходном отчёте нет runId.");
  const evidence = assessEvidence(report, "baseline", report.runId, session.scheme);
  if (evidence.status !== "PASS") throw new Error(`Исходный отчёт без расширения: ${evidence.status}. Нужны все четыре хоста, iframe и точная версия Chrome.`);
  nativeBaseline = { report, runId: report.runId, fileName: file.name, importedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [NATIVE_BASELINE_KEY]: nativeBaseline });
  setText(feedback, "Исходный отчёт, указанный вами как снятый без диагностической сборки, добавлен в результаты.");
}); });
const actions = { inspect, baseline, arm, stop, collect, export: exportReport };
for (const [id, action] of Object.entries(actions)) {
  element(id, HTMLButtonElement).addEventListener("click", () => { void perform(action); });
}

void perform(async () => {
  const stored = await chrome.storage.local.get([SESSION_KEY, NATIVE_BASELINE_KEY]);
  const native: unknown = stored[NATIVE_BASELINE_KEY];
  if (typeof native === "object" && native !== null && "report" in native && "runId" in native && typeof native.runId === "string" && "fileName" in native && typeof native.fileName === "string" && "importedAt" in native && typeof native.importedAt === "string") {
    nativeBaseline = { report: native.report, runId: native.runId, fileName: native.fileName, importedAt: native.importedAt };
  }
  const candidate: unknown = stored[SESSION_KEY];
  if (typeof candidate === "object" && candidate !== null && "scheme" in candidate && "inspections" in candidate && Array.isArray(candidate.inspections)) {
    const value = candidate as Session;
    if ((value.scheme === "http" || value.scheme === "https") && value.inspections.every(validInspection) && [value.baseline, value.armed, value.off].every((run) => run === null || (typeof run === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(run)))) session = value;
  }
  await inspect();
  setText(feedback, "API проверены вызовами из установленного расширения. Прочитайте результат, затем подготовьте исходный запуск.");
});
