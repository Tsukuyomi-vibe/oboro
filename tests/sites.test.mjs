import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const bundle = await build({ stdin: { contents: "export * from './src/sites/policy.ts'; export * from './src/sites/repository.ts'; export * from './src/sites/actions.ts'; export * from './src/control/protocol.ts';", resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const rule = (host, includeSubdomains = false, schemes = ["http", "https"]) => ({ host, includeSubdomains, schemes });
const policy = (include = [], exclude = [], mode = "selected_sites") => api.createSitePolicy({ mode, include, exclude }, 1);

test("I04: точный хост и граница поддомена", () => {
  for (const [host, exact, subdomains] of [["example.com", true, true], ["app.example.com", false, true], ["notexample.com", false, false], ["example.com.evil.example", false, false]]) {
    assert.equal(api.isSiteSelected(`https://${host}/path:123?x=1`, policy([rule("example.com")])), exact);
    assert.equal(api.isSiteSelected(`https://${host}/`, policy([rule("example.com", true)])), subdomains);
  }
  assert.equal(api.isSiteSelected("https://example.com:8443/any", policy([rule("example.com")])), true);
});
test("I04: исключения важнее включений; схемы независимы; пустой список пуст", () => {
  const current = policy([rule("example.com", true)], [rule("app.example.com", false, ["https"])]);
  assert.equal(api.resolveSite("https://app.example.com/", current).selection, "excluded");
  assert.equal(api.isSiteSelected("http://app.example.com/", current), true);
  assert.equal(api.isSiteSelected("https://deep.app.example.com/", current), true);
  assert.equal(api.isSiteSelected("http://example.com", policy([rule("example.com", false, ["https"])])), false);
  assert.equal(api.isSiteSelected("https://example.com/", api.emptySitePolicy(), ["https://*/*"]), false);
  for (const url of ["about:blank", "chrome://extensions", "data:text/html,hello", "blob:https://example.com/id", "broken"]) assert.equal(api.resolveSite(url, current).selection, "unsupported");
});
test("I04: IDNA, регистр, IPv4/IPv6 и явные ошибки ввода", () => {
  assert.equal(api.normalizeHost(" ПРИМЕР.РФ "), "xn--e1afmkfd.xn--p1ai");
  assert.equal(api.isSiteSelected("https://пример.рф/", policy([rule("XN--E1AFMKFD.XN--P1AI")])), true);
  assert.equal(api.normalizeHost("127.1"), "127.0.0.1");
  assert.equal(api.normalizeHost("[0:0:0:0:0:0:0:1]"), "[::1]");
  assert.equal(api.isSiteSelected("http://[::1]:8787/", policy([rule("[::1]")])), true);
  assert.equal(api.isSiteSelected("https://example.com./", policy([rule("example.com")])), false);
  for (const host of ["", "https://example.com", "example.com/path", "example.com:8787", "example.com:80", "[::1]:80", "u@localhost", "*.example.com", "example..com", "example.com\nattacker"]) assert.throws(() => api.normalizeHost(host));
  assert.throws(() => api.normalizeSiteRule(rule("127.0.0.1", true)));
});
test("I05: permission начинается до await; отказ сохраняет выбор без ложного успеха", async () => {
  const events = [];
  const result = api.performSiteAction("include", rule("example.com"), api.emptySitePolicy(), {
    request: async (origins) => { events.push(["request", origins]); return false; },
    save: async (draft, revision) => { events.push(["save", revision]); return api.createSitePolicy(draft, revision + 1); }
  });
  assert.equal(events[0][0], "request"); assert.equal(events.length, 1);
  const saved = await result;
  assert.equal(saved.granted, false); assert.equal(saved.policy.include[0].host, "example.com");
  assert.deepEqual(api.resolveSite("https://example.com/", saved.policy), { selection: "selected", granted: false });
});
test("I05: исключение не запрашивает доступ; permission-only не выбирает сайт", async () => {
  let requests = 0; let saves = 0;
  const dependencies = { request: async () => { requests++; return true; }, save: async (draft, revision) => { saves++; return api.createSitePolicy(draft, revision + 1); } };
  const excluded = await api.performSiteAction("exclude", rule("example.com"), api.emptySitePolicy(), dependencies);
  assert.equal(requests, 0); assert.equal(saves, 1); assert.equal(excluded.policy.exclude.length, 1);
  const onlyPermission = await api.performSiteAction("permission", rule("other.com"), api.emptySitePolicy(), dependencies);
  assert.equal(requests, 1); assert.equal(saves, 1); assert.equal(onlyPermission.policy.include.length, 0);
  await assert.rejects(api.performSiteAction("include", rule("example.com"), api.emptySitePolicy(), { ...dependencies, request: async () => { throw new Error("permission failed"); } }), /permission failed/);
});
test("I05: команды с сайта и неизвестные каналы не меняют политику", async () => {
  let calls = 0; const id = "a".repeat(32);
  const listener = api.createControlListener({ "policy.save": async () => { calls++; } }, id);
  let answer;
  assert.equal(listener({ channel: api.CONTROL_CHANNEL, operation: "policy.save" }, { id, url: "https://example.com" }, (response) => { answer = response; }), false);
  assert.equal(answer.error.code, "FORBIDDEN"); assert.equal(calls, 0);
  assert.equal(listener({ channel: "other" }, {}, () => { throw new Error("unexpected"); }), false);
});
test("I04: разрешение не выбирает сайт; all_granted_sites требует явного режима", () => {
  const grants = ["https://*.example.com/*"];
  assert.equal(api.resolveSite("https://app.example.com/", policy(), grants).selection, "not_selected");
  assert.deepEqual(api.resolveSite("https://example.com/", policy([rule("example.com")]), []), { selection: "selected", granted: false });
  const all = policy([], [rule("blocked.example.com", true)], "all_granted_sites");
  assert.equal(api.resolveSite("https://app.example.com/", all, grants).selection, "selected");
  assert.equal(api.resolveSite("http://app.example.com/", all, grants).selection, "not_selected");
  assert.equal(api.resolveSite("https://blocked.example.com/", all, grants).selection, "excluded");
});
test("I04: пересечение разрешений не расширяет matches за выданный доступ", () => {
  const scopes = api.selectedScopes(policy([rule("example.com", true)]), ["https://app.example.com/*", "https://other.com/*"]);
  assert.deepEqual(scopes.map(api.scopePattern), ["https://app.example.com/*"]);
  assert.deepEqual(api.selectedScopes(policy(), ["<all_urls>"]), []);
  assert.equal(api.hasHostPermission("https://example.com.evil/", ["https://*.example.com/*"]), false);
  assert.equal(api.hasHostPermission("http://example.com/", ["https://example.com/*"]), false);
});
test("I04: сохранение policyRevision, конфликт и изоляция от профиля", async () => {
  let data = { regionalProfile: { keep: true } }; let writes = 0;
  const storage = { get: async (key) => JSON.parse(JSON.stringify({ [key]: data[key] })), set: async (items) => { data = JSON.parse(JSON.stringify({ ...data, ...items })); writes++; } };
  const repository = new api.SitePolicyRepository(storage);
  assert.equal((await repository.load()).policyRevision, 0);
  const draft = { mode: "selected_sites", include: [rule("example.com")], exclude: [] };
  assert.equal((await repository.save(draft, 0)).policyRevision, 1);
  assert.equal((await new api.SitePolicyRepository(storage).load()).include[0].host, "example.com");
  assert.equal((await repository.save(draft, 1)).policyRevision, 1);
  await assert.rejects(repository.save({ ...draft, exclude: [rule("example.com")] }, 0), (error) => error.code === "POLICY_CONFLICT");
  assert.equal(writes, 1); assert.deepEqual(data.regionalProfile, { keep: true });
});
