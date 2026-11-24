import { readFile } from "node:fs/promises";
const config = JSON.parse(await readFile(new URL("../../fixtures/i02/config.json", import.meta.url), "utf8"));
export const SYNTHETIC_CHROME = "150.0.7000.1";
const clone = (value) => JSON.parse(JSON.stringify(value));
export function syntheticI02Evidence(version = SYNTHETIC_CHROME) {
  function run(phase, runId) {
    const requests = []; const observations = [];
    for (const host of config.hosts) for (const frame of ["top", "frame"]) {
      function request(target, kind) {
        const changed = phase === "armed" && target.selected;
        const origin = `http://${target.host}:8787`;
        const result = { id: `${runId}-${requests.length}`, runId, kind, host: target.host, origin,
          url: `${origin}/${kind === "fetch" ? "api/echo" : frame === "frame" ? "frame" : ""}?run=${runId}`,
          probeHeader: changed ? runId : null, acceptLanguage: changed ? config.acceptLanguage : "ru-RU,ru;q=0.9" };
        requests.push(result); return result;
      }
      const navigation = request(host, "document");
      observations.push({ firstRead: {
        requestId: navigation.id, runId, href: navigation.url, frame, readyState: "loading", secureContext: true,
        language: "ru-RU", languages: ["ru-RU", "ru"], locale: "ru-RU", timezone: "Europe/Moscow", timezoneOffset: -180,
        userAgent: "SYNTHETIC TEST FIXTURE, NOT A BROWSER OBSERVATION",
        marker: phase === "armed" && host.selected ? { runId, readyState: "loading", href: navigation.url } : null
      }, browser: { fullVersionList: [{ brand: "Google Chrome", version }] },
      echoes: config.hosts.map((target) => ({ host: target.host, ok: true, request: request(target, "fetch") })) });
    }
    return clone({ runId, truncated: false, requests, observations });
  }
  const inspection = (enabled) => ({ extensionId: "b".repeat(32), hostAccess: true, environment: { exactChromeVersion: version }, userScripts: { available: enabled }, dnr: { available: true }, toggleObservedByUser: enabled ? "on" : "off" });
  return { format: "region-i02-evidence-v1", status: "CONFIRMED",
    nativeBaseline: { runId: "synthetic-uninstalled", report: run("baseline", "synthetic-uninstalled") },
    session: { scheme: "http", baseline: "synthetic-baseline", armed: "synthetic-armed", off: "synthetic-off", inspections: [inspection(false), inspection(true)], cleanup: { scriptsCleared: true, rulesCleared: true, errors: [] } },
    serverReports: { baseline: run("baseline", "synthetic-baseline"), armed: run("armed", "synthetic-armed"), off: run("off", "synthetic-off") }
  };
}
