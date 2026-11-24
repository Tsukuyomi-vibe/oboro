import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runtimeBundle } from "../scripts/runtime-build.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = await runtimeBundle(root);
const result = await build({ stdin: { contents: "export * from './src/runtime/compiler.ts'; export * from './src/sites/policy.ts'; export * from './src/profile/example.ts';", resolveDir: root }, bundle: true, write: false, format: "esm", platform: "browser", define: { __REGION_RUNTIME_BUNDLE__: JSON.stringify(source) }, logLevel: "silent" });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const rule = (host, includeSubdomains = false, schemes = ["http", "https"]) => ({ host, includeSubdomains, schemes });
const policy = (include = [rule("example.com", true)], exclude = [rule("blocked.example.com")], mode = "selected_sites") => api.createSitePolicy({ mode, include, exclude }, 3);
const snapshot = (current = policy(), grants = ["http://*.example.com/*", "https://*.example.com/*"]) => api.createRuntimeSnapshot(api.getExampleProfile(), current, grants, "activation-unit");

export function createPage(url, extra = "") {
  const messages = [];
  const listeners = new Map();
  const context = vm.createContext({ URL, setTimeout, clearTimeout, console, TextEncoder, crypto: globalThis.crypto,
    captureMessage: (message) => messages.push(JSON.parse(JSON.stringify(message))),
    addListener: (type, callback) => { const list = listeners.get(type) ?? []; list.push(callback); listeners.set(type, list); }
  });
  vm.runInContext(`
    class Navigator { get language() { if (this !== navigator) throw new TypeError('Illegal invocation'); return 'ru-RU'; }
      get languages() { if (this !== navigator) throw new TypeError('Illegal invocation'); return Object.freeze(['ru-RU','ru']); } }
    globalThis.Navigator = Navigator; globalThis.navigator = new Navigator();
    globalThis.window = globalThis; globalThis.location = new URL(${JSON.stringify(url)});
    globalThis.origin = location.origin;
    globalThis.document = { readyState: 'loading' };
    globalThis.postMessage = (message) => captureMessage(message);
    globalThis.addEventListener = (type, callback) => addListener(type, callback);
    ${extra}
  `, context);
  return { context, messages, listeners, run(code) { return vm.runInContext(code, context); } };
}

test("I06: первый скрипт выбранного документа видит языки; контрольный и исключённый — исходные", () => {
  const compiled = api.compileActivation(snapshot());
  for (const [url, expected] of [["https://example.com/", "de-DE"], ["https://app.example.com/", "de-DE"], ["https://blocked.example.com/", "ru-RU"], ["https://notexample.com/", "ru-RU"], ["https://example.com.evil.example/", "ru-RU"], ["about:blank", "ru-RU"]]) {
    const page = createPage(url);
    page.run(compiled.mainScript.js[0].code);
    assert.equal(page.run("navigator.language"), expected, url);
    if (expected === "de-DE") {
      assert.deepEqual(JSON.parse(page.run("JSON.stringify(navigator.languages)")), ["de-DE", "de", "en-US"]);
      assert.equal(page.messages[0].report.profileRevision, undefined);
      assert.equal(page.messages[0].report.policyRevision, undefined);
      assert.equal(page.messages[0].report.activationId, undefined);
      assert.match(page.messages[0].report.documentNonce, /^[a-f0-9]{32}$/);
    } else assert.equal(page.messages.length, 0);
  }
  assert.equal(compiled.mainScript.runAt, "document_start"); assert.equal(compiled.mainScript.world, "MAIN");
  assert.equal(compiled.mainScript.allFrames, true);
  assert.ok(!compiled.mainScript.js[0].code.includes("chrome.storage"));
});
test("I06: возвращаемые языки не меняют снимок, receiver проверяется, повтор не наслаивается", () => {
  const compiled = api.compileActivation(snapshot());
  const page = createPage("https://example.com/");
  page.run(compiled.mainScript.js[0].code);
  page.run("navigator.languages[0] = 'attacker'; globalThis.firstGetter = Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get;");
  assert.equal(page.run("navigator.language"), "de-DE");
  assert.equal(page.run("navigator.languages[0]"), "de-DE");
  assert.throws(() => page.run("Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get.call({})"), /Illegal invocation/);
  page.run(compiled.mainScript.js[0].code);
  assert.equal(page.run("firstGetter === Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get"), true);
  const next = api.createRuntimeSnapshot({ ...api.getExampleProfile(), revision: 2, language: "en-US", languages: ["en-US"] }, policy(), snapshot().grantedOrigins, "next");
  page.run(api.compileActivation(next).mainScript.js[0].code);
  assert.equal(page.run("navigator.language"), "de-DE"); assert.equal(page.messages.at(-1).report.needsReload, true);
});
test("I06: отсутствие доступа и невозможность патча не объявляются успешной установкой", () => {
  const data = snapshot(policy(), []);
  assert.equal(api.compileActivation(data).mainScript, null);
  const page = createPage("https://example.com/", "Object.defineProperty(Navigator.prototype,'languages',{configurable:false});");
  page.run(api.compileActivation(snapshot()).mainScript.js[0].code);
  assert.equal(page.run("navigator.language"), "ru-RU");
  assert.equal(page.messages[0].report.languages, "error");
});
test("I06: пропущенный document_start не заменяется поздней подменой", () => {
  const page = createPage("https://example.com/", "document.readyState = 'complete';");
  page.run(api.compileActivation(snapshot()).mainScript.js[0].code);
  assert.equal(page.run("navigator.language"), "ru-RU");
  assert.equal(page.messages[0].report.needsReload, true); assert.equal(page.messages[0].report.languages, "error");
});
test("I09: выбранный iframe обрабатывается по собственному адресу, внешний script не меняет scope", () => {
  const compiled = api.compileActivation(snapshot());
  const selectedFrame = createPage("https://app.example.com/frame");
  const foreignFrame = createPage("https://external.test/frame");
  const foreignParent = createPage("https://external.test/page");
  for (const page of [selectedFrame, foreignFrame, foreignParent]) page.run(compiled.mainScript.js[0].code);
  assert.equal(selectedFrame.run("navigator.language"), "de-DE");
  assert.equal(foreignFrame.run("navigator.language"), "ru-RU");
  assert.equal(foreignParent.run("navigator.language"), "ru-RU");
});

function networkHeader(data, value, initiator, type = "xmlhttprequest") {
  const url = new URL(value).href;
  if (!api.hasHostPermission(url, data.grantedOrigins) || (!['main_frame','sub_frame'].includes(type) && !api.hasHostPermission(initiator, data.grantedOrigins))) return "native";
  const matched = api.compileNetworkRules(data).filter((entry) => entry.condition.resourceTypes.includes(type) && new RegExp(entry.condition.regexFilter).test(url)).sort((a, b) => b.priority - a.priority);
  if (matched[0]?.action.type === "allow") return "native";
  return matched.find((entry) => entry.action.type === "modifyHeaders")?.action.requestHeaders[0].value ?? "native";
}
test("I07: заголовок относится к адресату; exact/subdomain, схема и исключения согласованы с resolver", () => {
  const data = snapshot(policy([rule("example.com", true)], [rule("blocked.example.com", false, ["https"])]), ["http://*.example.com/*", "https://*.example.com/*", "https://control.test/*"]);
  for (const url of ["https://example.com/", "https://app.example.com/", "https://blocked.example.com/", "https://deep.blocked.example.com/", "http://blocked.example.com/", "https://notexample.com/", "https://example.com.evil.example/", "https://example.com:8443/path"]) {
    const expected = api.isSiteSelected(url, data.policy, data.grantedOrigins) && api.hasHostPermission(url, data.grantedOrigins) ? "de-DE,de;q=0.9,en-US;q=0.8" : "native";
    assert.equal(networkHeader(data, url, "https://control.test/"), expected, url);
  }
  assert.equal(networkHeader(data, "https://control.test/", "https://example.com/"), "native");
  assert.equal(networkHeader(data, "https://example.com/", "https://ungranted.test/"), "native");
  assert.equal(networkHeader(data, "https://example.com/", "https://ungranted.test/", "main_frame"), "de-DE,de;q=0.9,en-US;q=0.8");
});
test("I07: первый запрос, переходы и редиректы оцениваются отдельно; пустой allowlist даёт пустые правила", () => {
  const data = snapshot(policy([rule("example.com")], []));
  assert.equal(networkHeader(data, "https://example.com/start", "https://outside.test/", "main_frame"), "de-DE,de;q=0.9,en-US;q=0.8");
  assert.equal(networkHeader(data, "https://outside.test/redirect", "https://example.com/", "main_frame"), "native");
  assert.equal(networkHeader(data, "https://app.example.com/end", "https://outside.test/", "main_frame"), "native");
  assert.deepEqual(api.compileNetworkRules(snapshot(api.emptySitePolicy())), []);
  const rules = api.compileNetworkRules(data);
  assert.ok(rules.every((entry) => api.ownsNetworkRule(entry.id)));
  assert.ok(rules.every((entry) => entry.action.type !== "modifyHeaders" || (entry.action.requestHeaders.length === 1 && entry.action.requestHeaders[0].operation === "set")));
});
test("I07: wildcard и IP границы не превращаются в произвольный regex", () => {
  const exact = snapshot(policy([rule("127.0.0.1"), rule("[::1]")], []), ["http://127.0.0.1/*", "http://[::1]/*"]);
  assert.equal(networkHeader(exact, "http://127.0.0.1:8787/", "http://127.0.0.1/"), "de-DE,de;q=0.9,en-US;q=0.8");
  assert.equal(networkHeader(exact, "http://[::1]:8787/", "http://127.0.0.1/"), "de-DE,de;q=0.9,en-US;q=0.8");
  assert.equal(networkHeader(exact, "http://127x0x0x1/", "http://127.0.0.1/"), "native");
  const all = snapshot(policy([], [rule("blocked.test")], "all_granted_sites"), ["https://*/*"]);
  assert.equal(networkHeader(all, "https://allowed.test/", "https://initiator.test/"), "de-DE,de;q=0.9,en-US;q=0.8");
  assert.equal(networkHeader(all, "https://blocked.test/", "https://initiator.test/"), "native");
});
