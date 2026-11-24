import { config, fixtureOrigin, type FixtureScheme } from "./definition";

type RecordValue = Record<string, unknown>;
export interface EvidenceCheck { name: string; result: "pass" | "fail" | "missing"; }
export interface EvidenceResult {
  status: "NOT_RUN" | "PASS" | "FAIL" | "INCOMPLETE";
  checks: EvidenceCheck[];
  chromeVersions: string[];
}
export type Phase = "baseline" | "armed" | "off";

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function records(value: unknown): RecordValue[] | null {
  return Array.isArray(value) && value.every(isRecord) ? value : null;
}

export function assessEvidence(
  value: unknown,
  phase: Phase,
  runId: string,
  scheme: FixtureScheme,
  baseline?: unknown
): EvidenceResult {
  const checks: EvidenceCheck[] = [];
  const versions = new Set<string>();
  const add = (name: string, pass: boolean, missing = false): void => {
    checks.push({ name, result: missing ? "missing" : pass ? "pass" : "fail" });
  };
  const finish = (): EvidenceResult => ({
    status: checks.some((entry) => entry.result === "fail") ? "FAIL"
      : checks.some((entry) => entry.result === "missing") ? "INCOMPLETE" : "PASS",
    checks, chromeVersions: [...versions]
  });
  if (value === null || value === undefined) return { status: "NOT_RUN", checks: [], chromeVersions: [] };
  if (!isRecord(value) || !records(value.requests) || !records(value.observations)) {
    add("Структура серверного отчёта", false);
    return finish();
  }
  const requests = records(value.requests)!;
  const observations = records(value.observations)!;
  add("Идентификатор запуска", value.runId === runId);
  add("Журнал не обрезан", value.truncated === false, value.truncated === true);
  add("Получены наблюдения страниц", observations.length > 0, observations.length === 0);
  const nativeRequests = isRecord(baseline) ? records(baseline.requests) ?? [] : [];

  function checkHeaders(request: RecordValue, name: string): void {
    const host = config.hosts.find((entry) => entry.host === request.host);
    if (!host) { add(`${name}: известный адресат`, false); return; }
    const expectedOrigin = fixtureOrigin(host.host, scheme);
    add(`${name}: origin стенда`, request.origin === expectedOrigin && typeof request.url === "string" && request.url.startsWith(`${expectedOrigin}/`));
    add(`${name}: run`, request.runId === runId);
    const modified = phase === "armed" && host.selected;
    add(`${name}: диагностический заголовок`, request.probeHeader === (modified ? runId : null));
    if (modified) {
      add(`${name}: Accept-Language`, request.acceptLanguage === config.acceptLanguage);
    } else if (phase !== "baseline") {
      const reference = nativeRequests.filter((entry) => entry.host === host.host && entry.kind === request.kind);
      add(`${name}: исходный Accept-Language`, reference.some((entry) => entry.acceptLanguage === request.acceptLanguage), reference.length === 0);
    }
  }

  const seen = new Set<string>();
  const requestIds = new Set<unknown>();
  for (const request of requests) {
    add("Уникальный идентификатор серверного запроса", typeof request.id === "string" && !requestIds.has(request.id));
    requestIds.add(request.id);
    add("Известный вид серверного запроса", request.kind === "document" || request.kind === "fetch");
    checkHeaders(request, `${String(request.host)} ${String(request.kind)}`);
  }
  const observedIds = new Set<unknown>();
  for (const observation of observations) {
    if (!isRecord(observation.firstRead)) { add("Снимок первого скрипта", false); continue; }
    const first = observation.firstRead;
    const documentRequest = requests.find((entry) => entry.id === first.requestId && entry.kind === "document");
    if (!documentRequest) { add("Первый скрипт связан с первым запросом документа", false); continue; }
    const host = config.hosts.find((entry) => entry.host === documentRequest.host);
    if (!host) { add("Известный хост документа", false); continue; }
    const name = `${host.host} (${String(first.frame)})`;
    add(`${name}: одно наблюдение на документ`, !observedIds.has(first.requestId));
    observedIds.add(first.requestId);
    add(`${name}: ранний снимок`, first.readyState === "loading");
    add(`${name}: secure context`, first.secureContext === true);
    add(`${name}: адрес и запуск`, first.href === documentRequest.url && first.runId === runId);
    add(`${name}: исходные региональные значения записаны`,
      typeof first.language === "string" && Array.isArray(first.languages) && first.languages.length > 0 && first.languages.every((language) => typeof language === "string") &&
      typeof first.locale === "string" && typeof first.timezone === "string" && typeof first.timezoneOffset === "number" && Number.isFinite(first.timezoneOffset) && typeof first.userAgent === "string");
    add(`${name}: контекст`, first.frame === "top" || first.frame === "frame");
    seen.add(`${host.host}|${String(first.frame)}`);
    if (phase === "armed" && host.selected) {
      const marker = isRecord(first.marker) ? first.marker : null;
      add(`${name}: MAIN до первого скрипта`, marker?.runId === runId && marker.readyState === "loading" && marker.href === first.href);
    } else {
      add(`${name}: отсутствие MAIN-маркера`, first.marker === null);
    }

    const browser = isRecord(observation.browser) ? observation.browser : null;
    const fullVersions = browser ? records(browser.fullVersionList) : null;
    const chrome = fullVersions?.find((entry) => entry.brand === "Google Chrome");
    const exact = typeof chrome?.version === "string" && /^\d+\.\d+\.\d+\.\d+$/.test(chrome.version) && !chrome.version.endsWith(".0.0.0");
    add(`${name}: точная версия Google Chrome`, exact, !exact);
    if (exact) versions.add(chrome!.version as string);

    const echoes = records(observation.echoes) ?? [];
    for (const target of config.hosts) {
      const echo = echoes.find((entry) => entry.host === target.host);
      const echoRequest = echo && isRecord(echo.request) ? echo.request : null;
      const received = echoRequest ? requests.find((entry) => entry.id === echoRequest.id && entry.kind === "fetch" && entry.host === target.host) : null;
      add(`${name}: fetch → ${target.host}`, echo?.ok === true && received !== undefined && received !== null, echo === undefined);
    }
  }
  for (const host of config.hosts) {
    for (const context of ["top", "frame"]) {
      add(`${host.host}: проверен ${context}`, seen.has(`${host.host}|${context}`), !seen.has(`${host.host}|${context}`));
    }
  }
  add("Один Chrome build для всего запуска", versions.size === 1, versions.size === 0);
  return finish();
}
