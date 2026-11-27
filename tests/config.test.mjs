import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const compiled = await build({ stdin: { contents: `export * from './src/config/types.ts'; export * from './src/config/format.ts'; export * from './src/config/service.ts';
  export * from './src/profile/repository.ts'; export * from './src/profile/validation.ts'; export * from './src/sites/repository.ts'; export * from './src/sites/policy.ts';`, resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const fixture = JSON.parse(await readFile(new URL("./fixtures/config/v1.json", import.meta.url), "utf8"));
const partialFixture = JSON.parse(await readFile(new URL("./fixtures/config/v2.json", import.meta.url), "utf8"));
const legacy = JSON.parse(await readFile(new URL("../examples/berlin.regional-profile.json", import.meta.url), "utf8"));
const clone = value => JSON.parse(JSON.stringify(value));
const fresh = () => clone(fixture);
const ui = () => ({ language: "en", theme: "system" });
const code = expected => error => error?.code === expected;

function backend(initial = {}) {
  const data = clone(initial), writes = [], grants = [];
  const faults = { mode: null, remaining: 0, persistent: false, cleanup: false };
  let disabled = 0, serial = 0;
  const storage = {
    async get(key) { return Object.hasOwn(data, key) ? clone({ [key]: data[key] }) : {}; },
    async set(items) {
      writes.push(clone(items));
      const fail = Object.hasOwn(items, "regionalProfile") && (faults.remaining > 0 || faults.persistent);
      if (fail) {
        faults.remaining--;
        if (faults.mode === "after") Object.assign(data, clone(items));
        if (faults.mode === "partial") data.regionalProfile = clone(items.regionalProfile);
        if (faults.mode === "drop") { const incomplete = clone(items); delete incomplete.sitePolicy; Object.assign(data, incomplete); return; }
        throw Error("synthetic storage fault");
      }
      Object.assign(data, clone(items));
    }
  };
  const profiles = new api.ProfileRepository(storage), sites = new api.SitePolicyRepository(storage);
  const dependencies = {
    storage, loadProfile: () => profiles.load(), loadPolicy: () => sites.load(),
    async disable() { disabled++; return { enabled: false, status: faults.cleanup ? "ERROR" : "OFF", phase: "idle" }; },
    origins: async () => [...grants], contains: async requested => requested.every(origin => grants.includes(origin) || grants.includes("https://*/*") && origin.startsWith("https://")),
    id: () => `synthetic-config-${++serial}`, version: () => "0.3.1"
  };
  const create = () => new api.ConfigurationService(dependencies);
  return { data, writes, grants, faults, profiles, sites, service: create(), create, disabled: () => disabled };
}

test("configuration v1: migration to v2 preserves zero/null, languages, layout, scope and UI", () => {
  const value = api.decodeConfiguration(JSON.stringify(fixture));
  assert.equal(value.kind, "configuration");
  const migrated = { ...fixture, schemaVersion: 2 };
  assert.deepEqual(value.file, migrated);
  assert.equal(value.sourceSchemaVersion, 1);
  const serialized = api.serializeConfiguration(value.file);
  assert.deepEqual(JSON.parse(serialized), migrated);
  assert.equal(value.file.config.profile.geolocation.altitude, 0);
  assert.equal(value.file.config.profile.geolocation.altitudeAccuracy, null);
  assert.equal(value.file.config.profile.geolocation.heading, 0);
  assert.equal(value.sourceOboroVersion, "0.3.1");
});

test("configuration versions: app version is required provenance, newer app/same schema is accepted", () => {
  for (const version of ["0.1.0", "0.3.1", "15.0.0", "1.2.3.4"]) {
    const config = fresh(); config.oboroVersion = version;
    assert.equal(api.decodeConfiguration(JSON.stringify(config)).file.oboroVersion, version);
  }
  for (const version of [undefined, null, "", "unknown", "1.2.3-user", "999999.0", "70000.1"]) {
    const config = fresh(); config.oboroVersion = version;
    assert.throws(() => api.decodeConfiguration(JSON.stringify(config)), code("INVALID_CONFIG"));
  }
  const future = fresh(); future.schemaVersion = 3;
  assert.throws(() => api.decodeConfiguration(JSON.stringify(future)), code("CONFIG_TOO_NEW"));
});

test("configuration v2: sparse settings survive preview, restore and re-export without host defaults", async () => {
  const decoded = api.decodeConfiguration(JSON.stringify(partialFixture));
  assert.equal(decoded.sourceSchemaVersion, 2);
  assert.deepEqual(JSON.parse(api.serializeConfiguration(decoded.file)), partialFixture);
  const b = backend({ regionalProfile: clone(legacy) });
  const preview = await b.service.preview(JSON.stringify(partialFixture), ui());
  assert.deepEqual(preview.proposed.profile, partialFixture.config.profile);
  assert.deepEqual(b.data.regionalProfile, legacy);
  await b.service.import(preview.id);
  const saved = await b.profiles.load();
  assert.deepEqual(saved.geolocation, { latitude: 52.52 });
  assert.equal(saved.name, "123"); assert.equal(saved.schemaVersion, 2);
  for (const field of ["language", "languages", "locale", "timeZone"]) assert.equal(Object.hasOwn(saved, field), false, field);
  assert.deepEqual((await b.service.export(ui())).config.profile, partialFixture.config.profile);
  assert.deepEqual(b.grants, []);
  for (const [path, mutation] of [["languages", profile => profile.languages = []], ["locale", profile => profile.locale = ""], ["timeZone", profile => profile.timeZone = ""], ["geolocation.latitude", profile => profile.geolocation.latitude = null]]) {
    const invalid = clone(partialFixture); mutation(invalid.config.profile);
    assert.throws(() => api.decodeConfiguration(JSON.stringify(invalid)), error => error.issues?.[0]?.path === path);
  }
});

test("configuration decoder rejects malformed, oversized, non-finite and unknown behavior fields", () => {
  for (const text of ["", "{", "null", "[]", "42"]) assert.throws(() => api.decodeConfiguration(text));
  assert.throws(() => api.decodeConfiguration(" ".repeat(api.MAX_CONFIG_BYTES + 1)), code("CONFIG_TOO_LARGE"));
  assert.throws(() => api.decodeConfiguration("😀".repeat(api.MAX_CONFIG_BYTES / 4 + 1)), code("CONFIG_TOO_LARGE"));
  for (const mutate of [
    x => x.activationId = "unexpected",
    x => x.config.masterEnabled = true,
    x => x.config.profile.revision = 500,
    x => x.config.profile.geolocation.latitude = 91,
    x => x.config.profile.timeZone = "No/Such_Zone",
    x => x.config.profile.keyboardLayout = "future-layout",
    x => x.config.ui.language = "xx",
    x => x.config.ui.theme = "custom",
    x => x.config.ui.theme = { toString: "system" },
    x => x.config.sitePolicy.include[0].cookie = "unexpected",
    x => x.permissionHints.origins = ["file://*/*"],
    x => x.permissionHints.origins = ["https://example.com/private/path"],
    x => x.permissionHints.origins = ["https://example.com:8787/*"],
    x => x.permissionHints.origins = ["https://*.127.0.0.1/*"]
  ]) { const config = fresh(); mutate(config); assert.throws(() => api.decodeConfiguration(JSON.stringify(config))); }
  assert.throws(() => api.decodeConfiguration(JSON.stringify(fixture).replace('"latitude":52.52', '"latitude":1e999')));
  const injected = JSON.stringify(fixture).replace('"format":', '"__proto__":{"polluted":true},"format":');
  assert.throws(() => api.decodeConfiguration(injected), code("INVALID_CONFIG")); assert.equal({}.polluted, undefined);
});

test("legacy profile v1: unknown app version and documented native keyboard default", () => {
  const value = api.decodeConfiguration(JSON.stringify(legacy));
  assert.equal(value.kind, "profile"); assert.equal(value.sourceOboroVersion, null);
  assert.equal(value.profile.keyboardLayout, "native");
  assert.equal("revision" in value.profile, false); assert.equal("language" in value.profile, false);
});

test("saved export is read-only, always records actual exporter version and omits runtime/private state", async () => {
  const b = backend({ regionalProfile: clone(legacy), capabilityEvidence: { private: true }, activationState: { enabled: true }, activationSnapshot: { activationId: "private" }, frameRegistry: { secret: true } });
  b.grants.push("<all_urls>");
  const before = clone(b.data), exported = await b.service.export(ui());
  assert.equal(exported.oboroVersion, "0.3.1"); assert.equal(exported.schemaVersion, 2);
  assert.deepEqual(exported.permissionHints.origins, ["http://*/*", "https://*/*"]);
  assert.equal(exported.config.profile.name, legacy.name); assert.equal(exported.config.profile.keyboardLayout, "native");
  const text = api.serializeConfiguration(exported);
  for (const word of ["activationId", "capabilityEvidence", "frameRegistry", "profileRevision", "policyRevision", "masterEnabled", "exportedAt"]) assert.equal(text.includes('"' + word + '"'), false);
  assert.equal("revision" in exported.config.profile, false);
  assert.deepEqual(b.data, before); assert.equal(b.writes.length, 0); assert.equal(b.disabled(), 0);
});

test("import preview does not write, disable, grant or replace anything on invalid files", async () => {
  const b = backend(); const before = clone(b.data);
  const preview = await b.service.preview(JSON.stringify(fixture), ui());
  assert.equal(preview.kind, "configuration"); assert.equal(preview.current.profile, null);
  assert.equal(preview.proposed.profile.name, fixture.config.profile.name);
  const future = fresh(); future.schemaVersion = 3;
  await assert.rejects(b.service.preview(JSON.stringify(future), ui()), code("CONFIG_TOO_NEW"));
  assert.deepEqual(b.data, before); assert.equal(b.writes.length, 0); assert.equal(b.disabled(), 0); assert.deepEqual(b.grants, []);
});

test("full restore regenerates local revisions, remains disabled, preserves unrelated data and hints", async () => {
  const b = backend({ regionalProfile: clone(legacy), unrelated: { keep: true }, capabilityEvidence: { keep: true } });
  const preview = await b.service.preview(JSON.stringify(fixture), ui());
  const result = await b.service.import(preview.id);
  assert.equal(b.disabled(), 1); assert.equal(result.profileRevision, 2); assert.equal(result.policyRevision, 1);
  assert.equal(b.data.regionalProfile.revision, 2); assert.equal(b.data.regionalProfile.language, "de-DE");
  assert.deepEqual(b.data.unrelated, { keep: true }); assert.deepEqual(b.data.capabilityEvidence, { keep: true });
  assert.deepEqual(b.grants, []); assert.deepEqual(result.missingOrigins, ["https://example.com/*"]);
  assert.equal(b.data.configurationImportJournal, null);
  assert.deepEqual(b.data.configurationUiRestore.ui, fixture.config.ui);
  assert.deepEqual((await b.service.export(fixture.config.ui)).config, fixture.config);
  await assert.rejects(b.service.import(preview.id), code("CONFIG_PREVIEW_EXPIRED"));
});

test("legacy import replaces only profile and never adopts file revision or resets sites/UI/hints", async () => {
  const policy = api.createSitePolicy(fixture.config.sitePolicy, 20);
  const restored = { schemaVersion: 1, token: "previous-ui", ui: ui() };
  const b = backend({ sitePolicy: policy, regionalProfileRevision: 7, configurationUiRestore: restored, configurationPermissionHints: { origins: ["https://example.org/*"] } });
  const old = clone(legacy); old.revision = 999;
  const preview = await b.service.preview(JSON.stringify(old), ui());
  assert.equal(preview.sourceOboroVersion, null);
  await b.service.import(preview.id);
  assert.equal(b.data.regionalProfile.revision, 8); assert.deepEqual(b.data.sitePolicy, policy);
  assert.deepEqual(b.data.configurationUiRestore, restored);
  assert.deepEqual(b.data.configurationPermissionHints, { origins: ["https://example.org/*"] });
});

test("clearing/restoring an empty configuration keeps the profile revision clock monotonic", async () => {
  const b = backend({ regionalProfile: api.createRegionalProfile(fixture.config.profile, 9) });
  const empty = fresh(); empty.config.profile = null;
  const preview = await b.service.preview(JSON.stringify(empty), ui()); await b.service.import(preview.id);
  assert.equal(await b.profiles.load(), null); assert.equal(b.data.regionalProfileRevision, 9);
  const recreated = await b.profiles.save(fixture.config.profile, 0); assert.equal(recreated.revision, 10);
  await assert.rejects(b.profiles.save({ ...fixture.config.profile, name: "stale editor" }, 9), error => error.code === "REVISION_CONFLICT");
});

test("a changed saved configuration or a lost preview prevents overwriting concurrent edits", async () => {
  const b = backend({ regionalProfile: clone(legacy) });
  const preview = await b.service.preview(JSON.stringify(fixture), ui());
  await b.profiles.save({ ...api.profileToDraft(api.parseRegionalProfile(legacy)), name: "concurrent edit" }, 1);
  await assert.rejects(b.service.import(preview.id), code("CONFIG_CONFLICT"));
  assert.equal(b.data.regionalProfile.name, "concurrent edit"); assert.equal(b.disabled(), 0);
  await assert.rejects(b.create().import(preview.id), code("CONFIG_PREVIEW_EXPIRED"));
});

test("failed activation cleanup aborts before changing saved settings", async () => {
  const b = backend({ regionalProfile: clone(legacy) }); const before = clone(b.data);
  const preview = await b.service.preview(JSON.stringify(fixture), ui()); b.faults.cleanup = true;
  await assert.rejects(b.service.import(preview.id), code("CONFIG_CLEANUP_FAILED"));
  assert.deepEqual(b.data, before); assert.equal(b.writes.length, 0);
});

test("failed, ambiguous, partial and silently incomplete writes restore previous coherent settings", async () => {
  for (const mode of ["before", "after", "partial", "drop"]) {
    const b = backend({ regionalProfile: clone(legacy), sitePolicy: api.createSitePolicy({ mode: "selected_sites", include: [], exclude: [] }, 3) });
    const before = await b.service.export(ui()); const preview = await b.service.preview(JSON.stringify(fixture), ui());
    b.faults.mode = mode; b.faults.remaining = 1;
    await assert.rejects(b.service.import(preview.id), code("CONFIG_IMPORT_FAILED"));
    assert.deepEqual(await b.service.export(ui()), before, mode);
    assert.equal(b.data.regionalProfile.revision, 1); assert.equal(b.data.sitePolicy.policyRevision, 3);
    assert.equal(b.data.configurationImportJournal, null); assert.ok(b.disabled() >= 1);
  }
});

test("a fresh worker recovers an interrupted import; damaged journals are preserved without writes", async () => {
  const b = backend({ regionalProfile: clone(legacy) }); const before = await b.service.export(ui());
  const preview = await b.service.preview(JSON.stringify(fixture), ui());
  b.faults.mode = "partial"; b.faults.persistent = true;
  await assert.rejects(b.service.import(preview.id), code("CONFIG_RECOVERY_REQUIRED"));
  assert.ok(b.data.configurationImportJournal); b.faults.persistent = false;
  const nextWorker = b.create(); b.faults.cleanup = true;
  await assert.rejects(nextWorker.recover(), code("CONFIG_RECOVERY_REQUIRED")); assert.ok(b.data.configurationImportJournal);
  b.faults.cleanup = false; await nextWorker.recover();
  assert.deepEqual(await nextWorker.export(ui()), before); assert.equal(b.data.configurationImportJournal, null);
  const bad = backend({ configurationImportJournal: { schemaVersion: 99, previous: {} } });
  await assert.rejects(bad.service.recover()); assert.equal(bad.writes.length, 0);
  assert.equal(bad.data.configurationImportJournal.schemaVersion, 99);
});

test("all-granted mode preserves permission hints without selecting/granting them on restore", async () => {
  const b = backend(); const config = fresh(); config.config.sitePolicy.mode = "all_granted_sites"; config.config.sitePolicy.include = [];
  config.permissionHints.origins = ["https://*.example.org/*", "https://example.com/*"];
  const preview = await b.service.preview(JSON.stringify(config), ui()); await b.service.import(preview.id);
  assert.deepEqual(b.grants, []); assert.deepEqual(await b.service.missingAccess(), config.permissionHints.origins);
  assert.deepEqual((await b.service.export(config.config.ui)).permissionHints, config.permissionHints);
});
