import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(relativePath) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const definition = await loadModule("../src/probe/definition.ts");
const { assessEvidence } = await loadModule("../src/probe/evidence.ts");
const capabilities = await loadModule("../src/probe/capabilities.ts");
const { config, createProbeScript, createProbeRules, fixtureOrigin, RULE_IDS, SCRIPT_ID } = definition;

function fakeChrome({ scriptsBlocked = false, failRuleWrite = false } = {}) {
  const state = { scripts: [], rules: [{ id: 77 }], registrations: 0 };
  const api = {
    runtime: { id: "a".repeat(32) }, permissions: { contains: async () => true },
    userScripts: {
      getScripts: async () => { if (scriptsBlocked) throw new Error("User scripts toggle is off"); return [...state.scripts]; },
      register: async (scripts) => { state.registrations++; state.scripts.push(...scripts); },
      unregister: async ({ ids }) => { state.scripts = state.scripts.filter((entry) => !ids.includes(entry.id)); }
    },
    declarativeNetRequest: {
      RuleActionType: { MODIFY_HEADERS: "modifyHeaders" }, HeaderOperation: { SET: "set" },
      ResourceType: { MAIN_FRAME: "main_frame", SUB_FRAME: "sub_frame", XMLHTTPREQUEST: "xmlhttprequest" },
      getSessionRules: async () => [...state.rules],
      updateSessionRules: async ({ removeRuleIds = [], addRules = [] }) => {
        if (failRuleWrite && addRules.length) throw new Error("Synthetic DNR write failure");
        state.rules = state.rules.filter((entry) => !removeRuleIds.includes(entry.id));
        state.rules.push(...addRules);
      }
    }
  };
  globalThis.chrome = api;
  return state;
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
  userAgent: "Synthetic unit test Chrome/120.0.0.0",
  userAgentData: { getHighEntropyValues: async () => ({ fullVersionList: [{ brand: "Google Chrome", version: "120.0.6099.1" }] }) }
} });

test("DNR: точный хост, порт и схема; исключённый и посторонний не совпадают", () => {
  fakeChrome();
  for (const scheme of ["http", "https"]) {
    const rules = createProbeRules("unit-run", scheme);
    for (const { host, selected } of config.hosts) {
      const matched = rules.filter((rule) => new RegExp(rule.condition.regexFilter).test(`${fixtureOrigin(host, scheme)}/api/echo?run=unit-run`));
      assert.equal(matched.length, selected ? 1 : 0, host);
    }
    for (const url of [
      `${scheme}://selected.localhost.evil.example:8787/`,
      `${scheme}://notselected.localhost:8787/`,
      `${scheme}://extra.selected.localhost:8787/`,
      `${scheme}://selected.localhost:9999/`,
      `${scheme === "http" ? "https" : "http"}://selected.localhost:${scheme === "http" ? 8787 : 8788}/`
    ]) assert.ok(!rules.some((rule) => new RegExp(rule.condition.regexFilter).test(url)), url);
    assert.deepEqual(rules.map((rule) => rule.id), [...RULE_IDS]);
  }
});

test("MAIN bootstrap: ранний маркер, идемпотентность и синхронная проверка origin", () => {
  const registration = createProbeScript("unit-run", "http");
  assert.equal(registration.world, "MAIN");
  assert.equal(registration.runAt, "document_start");
  assert.equal(registration.allFrames, true);
  for (const { host, selected } of config.hosts) {
    const window = {};
    const navigator = { language: "native", languages: ["native"] };
    const context = vm.createContext({ window, navigator, location: new URL(`${fixtureOrigin(host, "http")}/`), document: { readyState: "loading" } });
    vm.runInContext(registration.js[0].code, context);
    assert.equal(Boolean(window.__REGION_I02_PROBE__), selected);
    if (selected) {
      const firstMarker = window.__REGION_I02_PROBE__;
      vm.runInContext(registration.js[0].code, context);
      assert.equal(window.__REGION_I02_PROBE__, firstMarker);
      assert.equal(firstMarker.runId, "unit-run");
      assert.ok(Object.isFrozen(firstMarker));
    }
    assert.equal(navigator.language, "native");
  }
  for (const url of ["http://selected.localhost:9999/", "http://selected.localhost:8787/other", "https://selected.localhost:8788/"]) {
    const window = {};
    vm.runInNewContext(registration.js[0].code, { window, location: new URL(url), document: { readyState: "loading" } });
    assert.equal(window.__REGION_I02_PROBE__, undefined);
  }
});

test("недоступный userScripts останавливает запуск без поздней инъекции", async () => {
  const state = fakeChrome({ scriptsBlocked: true });
  const inspection = await capabilities.inspectCapabilities();
  assert.equal(inspection.userScripts.available, false);
  assert.equal(inspection.dnr.available, true);
  await assert.rejects(capabilities.armProbe("unit-run", "http"), /Запуск остановлен/);
  assert.equal(state.registrations, 0);
  assert.deepEqual(state.rules, [{ id: 77 }]);
});

test("ошибка DNR после регистрации откатывает только собственные изменения", async () => {
  const state = fakeChrome({ failRuleWrite: true });
  await assert.rejects(capabilities.armProbe("unit-run", "http"), /Synthetic DNR write failure/);
  assert.equal(state.scripts.length, 0);
  assert.deepEqual(state.rules, [{ id: 77 }]);
});

test("повторный запуск и очистка не создают дубликаты; отрицательная очистка видна", async () => {
  let state = fakeChrome();
  await capabilities.armProbe("first", "http");
  await capabilities.armProbe("second", "http");
  assert.deepEqual(state.scripts.map((entry) => entry.id), [SCRIPT_ID]);
  assert.equal(state.rules.length, 3);
  const cleared = await capabilities.clearProbe();
  assert.equal(cleared.scriptsCleared, true);
  assert.equal(cleared.rulesCleared, true);
  assert.deepEqual(state.rules, [{ id: 77 }]);
  state = fakeChrome({ scriptsBlocked: true });
  state.rules.push({ id: RULE_IDS[0] });
  const limited = await capabilities.clearProbe();
  assert.equal(limited.scriptsCleared, false);
  assert.equal(limited.rulesCleared, true);
  assert.equal(limited.errors.length, 1);
  assert.deepEqual(state.rules, [{ id: 77 }]);
});

function syntheticEvidence(phase, runId) {
  const requests = [];
  const observations = [];
  for (const host of config.hosts) {
    for (const frame of ["top", "frame"]) {
      const makeRequest = (target, kind) => {
        const modified = phase === "armed" && target.selected;
        const request = {
          id: `synthetic-${requests.length}`, runId, kind, origin: fixtureOrigin(target.host, "http"), host: target.host,
          url: `${fixtureOrigin(target.host, "http")}/${kind === "fetch" ? "api/echo" : frame === "frame" ? "frame" : ""}?run=${runId}`,
          probeHeader: modified ? runId : null, acceptLanguage: modified ? config.acceptLanguage : "ru-RU,ru;q=0.9"
        };
        requests.push(request);
        return request;
      };
      const document = makeRequest(host, "document");
      observations.push({
        firstRead: {
          requestId: document.id, runId, href: document.url, frame, readyState: "loading", secureContext: true,
          language: "ru-RU", languages: ["ru-RU", "ru"], locale: "ru-RU", timezone: "Europe/Moscow", timezoneOffset: -180,
          userAgent: "Synthetic evidence, not an observed Chrome run",
          marker: phase === "armed" && host.selected ? { runId, readyState: "loading", href: document.url } : null
        },
        browser: { fullVersionList: [{ brand: "Google Chrome", version: "120.0.6099.1" }] },
        echoes: config.hosts.map((target) => ({ host: target.host, ok: true, request: { ...makeRequest(target, "fetch") } }))
      });
    }
  }
  return { runId, truncated: false, requests, observations };
}

test("оценка доказательств не принимает регистрацию API вместо наблюдения страницы", () => {
  const baseline = syntheticEvidence("baseline", "baseline");
  const armed = syntheticEvidence("armed", "armed");
  const off = syntheticEvidence("off", "off");
  assert.equal(assessEvidence(null, "armed", "armed", "http", baseline).status, "NOT_RUN");
  assert.equal(assessEvidence({}, "armed", "armed", "http", baseline).status, "FAIL");
  assert.equal(assessEvidence(baseline, "baseline", "baseline", "http").status, "PASS");
  assert.equal(assessEvidence(armed, "armed", "armed", "http", baseline).status, "PASS");
  assert.equal(assessEvidence(off, "off", "off", "http", baseline).status, "PASS");
  const late = structuredClone(armed);
  late.observations[0].firstRead.marker = null;
  assert.equal(assessEvidence(late, "armed", "armed", "http", baseline).status, "FAIL");
  const headerMiss = structuredClone(armed);
  headerMiss.requests[0].acceptLanguage = "ru-RU";
  assert.equal(assessEvidence(headerMiss, "armed", "armed", "http", baseline).status, "FAIL");
  const excluded = structuredClone(armed);
  excluded.requests.find((entry) => entry.host === "excluded.selected.localhost").probeHeader = "armed";
  assert.equal(assessEvidence(excluded, "armed", "armed", "http", baseline).status, "FAIL");
  const missing = structuredClone(armed);
  missing.observations = missing.observations.filter((entry) => entry.firstRead.frame === "top");
  assert.equal(assessEvidence(missing, "armed", "armed", "http", baseline).status, "INCOMPLETE");
  const reduced = structuredClone(armed);
  reduced.observations[0].browser.fullVersionList[0].version = "120.0.0.0";
  assert.equal(assessEvidence(reduced, "armed", "armed", "http", baseline).status, "INCOMPLETE");
  const truncated = structuredClone(armed);
  truncated.truncated = true;
  assert.equal(assessEvidence(truncated, "armed", "armed", "http", baseline).status, "INCOMPLETE");
  const fakeEcho = structuredClone(armed);
  fakeEcho.observations[0].echoes[0].request.id = "not-received-by-server";
  assert.equal(assessEvidence(fakeEcho, "armed", "armed", "http", baseline).status, "FAIL");
});
