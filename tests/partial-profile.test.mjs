import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { partialBrowser, partialApi } from "./helpers/partial-runtime.mjs";
import { optionsPage } from "./helpers/options-page.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const compiled = await build({ stdin: { contents: "export * from './src/ui/profile-form.ts'; export * from './src/config/format.ts';", resolveDir: root }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
const form = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));
const read = file => readFile(new URL(file, import.meta.url), "utf8");

test("only name is required; untouched inputs neither become overrides nor produce latitude errors", async t => {
  const ui = optionsPage({ language: null }); t.after(ui.close); await ui.flush();
  assert.deepEqual([...ui.document.querySelectorAll('#profile-form [required]')].map(field => field.name), ["name"]);
  for (const name of ["latitude", "longitude", "languages", "locale", "timeZone"]) assert.equal(ui.query(`[name="${name}"]`).value, "", name);
  for (const name of ["accuracy", "altitude", "altitudeAccuracy", "speed", "heading"]) assert.equal(ui.query(`[name="${name}"]`), null);
  ui.set("name", "123");
  assert.equal(ui.query("#profile-error-latitude").textContent, ""); assert.equal(ui.query("#profile-validation").textContent, "");
  ui.submit("#profile-form"); await ui.flush();
  const saved = ui.snapshot().regionalProfile;
  assert.equal(saved.name, "123"); assert.equal(saved.schemaVersion, 3); assert.deepEqual(saved.geolocation, {});
  for (const key of ["languages", "language", "locale", "timeZone"]) assert.equal(Object.hasOwn(saved, key), false, key);
});

test("every remaining input is independently optional; zero stays distinct from native", () => {
  const blank = form.profileToFields(null); blank.name = "123";
  assert.deepEqual(form.profileDraftFromFields(blank), { name: "123", geolocation: {}, keyboardLayout: "native" });
  for (const [name, value] of [["latitude", "0"], ["longitude", "0"], ["languages", "fr-FR, en"], ["locale", "fr-FR"], ["timeZone", "Asia/Tokyo"], ["keyboardLayout", "de-qwertz"]]) {
    const draft = form.profileDraftFromFields({ ...blank, [name]: value });
    if (["latitude", "longitude"].includes(name)) assert.deepEqual(draft.geolocation, { [name]: 0 });
    const roundTrip = form.profileToFields(draft); assert.equal(roundTrip[name], value);
    for (const other of ["languages", "locale", "timeZone"]) if (other !== name) assert.equal(Object.hasOwn(draft, other), false);
  }
});

test("native profile leaves all API functions and host values unchanged", () => {
  const page = partialBrowser({ name: "123" });
  assert.deepEqual(page.json("values()"), page.json("before"));
  assert.equal(page.run("Date===originalRefs.Date && Intl.DateTimeFormat===originalRefs.DateTimeFormat && Intl.NumberFormat===originalRefs.NumberFormat && Number.prototype.toLocaleString===originalRefs.number && String.prototype.localeCompare===originalRefs.string && navigator.geolocation.getCurrentPosition===originalRefs.geo && navigator.keyboard.getLayoutMap===originalRefs.keyboard && Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get===originalRefs.lang"), true);
  for (const key of ["languages", "locale", "time", "temporal", "geolocation", "keyboard"]) assert.equal(page.report[key], "native", key);
  assert.deepEqual(partialApi.compileNetworkRules(page.snapshot), []);
});

for (const [field, replacement] of [["latitude", 52.52], ["longitude", -80]]) {
  test(`partial geolocation replaces only ${field} in each native response`, async () => {
    const page = partialBrowser({ name: "123", geolocation: { [field]: replacement } }, { longitude: 135, locale: "ja-JP", timeZone: "Asia/Tokyo" });
    assert.equal(page.run("nativeGeoCalls"), 0); assert.equal(page.report.geolocation, "installed");
    page.run("globalThis.requestOptions={maximumAge:123,timeout:456,enableHighAccuracy:true}; navigator.geolocation.getCurrentPosition(position=>received.push(position),error=>errors.push(error),requestOptions)"); await page.flush();
    const expected = { ...page.json("nativeCoords"), [field]: replacement };
    assert.deepEqual(page.json("received[0].coords"), expected); assert.equal(page.run("received[0].timestamp"), page.run("nativeTimestamp"));
    assert.equal(page.run("nativeOptions===requestOptions"), true); assert.equal(page.run("Object.isFrozen(received[0].coords)"), true);
    assert.deepEqual(page.json("received[0].toJSON().coords"), expected);
    assert.deepEqual(page.json("values()"), page.json("before"));
    assert.equal(page.run("Intl.NumberFormat===originalRefs.NumberFormat && Date===originalRefs.Date && navigator.keyboard.getLayoutMap===originalRefs.keyboard"), true);
  });
}

test("partial watches merge fresh native readings, preserve native errors and cancel cleanly", async () => {
  const page = partialBrowser({ name: "123", geolocation: { latitude: 52.52 } });
  page.run("globalThis.watch=navigator.geolocation.watchPosition(position=>received.push(position),error=>errors.push(error))"); await page.flush();
  page.run("nativeCoords.longitude=75; nativeCoords.altitude=77; nativeTimestamp++; emitNativePosition()"); await page.flush();
  assert.equal(page.run("received.length"), 2); assert.equal(page.run("received[1].coords.latitude"), 52.52); assert.equal(page.run("received[1].coords.longitude"), 75); assert.equal(page.run("received[1].coords.altitude"), 77);
  page.run("globalThis.converted=0;navigator.geolocation.clearWatch({valueOf(){converted++;return watch}});emitNativePosition()"); await page.flush();
  assert.equal(page.run("converted"), 1); assert.equal(page.run("received.length"), 2);
  page.run("navigator.geolocation.watchPosition(position=>received.push(position));emitWindow('pagehide')"); await page.flush();
  assert.equal(page.run("received.length"), 2);
  const denied = partialBrowser({ name: "123", geolocation: { latitude: 52.52 } }, { permission: "denied" });
  denied.run("navigator.geolocation.getCurrentPosition(position=>received.push(position),error=>errors.push(error))"); await denied.flush();
  assert.equal(denied.run("received.length"), 0); assert.equal(denied.run("errors[0]===nativeError"), true);
});

test("language, locale, time zone and keyboard can each be selected independently", async () => {
  const languages = partialBrowser({ name: "123", languages: ["de-DE", "en"] }, { locale: "fr-FR", timeZone: "Asia/Tokyo" });
  assert.equal(languages.run("navigator.language"), "de-DE"); assert.equal(languages.run("Intl.DateTimeFormat===originalRefs.DateTimeFormat && Date===originalRefs.Date && navigator.geolocation.getCurrentPosition===originalRefs.geo"), true);
  assert.equal(languages.report.locale, "native"); assert.equal(languages.report.time, "native"); assert.ok(partialApi.compileNetworkRules(languages.snapshot).some(rule => rule.action.type === "modifyHeaders"));
  const locale = partialBrowser({ name: "123", locale: "de-DE" }, { locale: "fr-FR", timeZone: "Asia/Tokyo" });
  assert.equal(locale.run("new Intl.NumberFormat().resolvedOptions().locale"), "de-DE"); assert.equal(locale.run("new Intl.DateTimeFormat().resolvedOptions().timeZone"), "Asia/Tokyo");
  assert.equal(locale.run("Date===originalRefs.Date && navigator.geolocation.getCurrentPosition===originalRefs.geo && Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get===originalRefs.lang"), true);
  assert.equal(locale.report.time, "native"); assert.equal(locale.report.temporal, "native"); assert.deepEqual(partialApi.compileNetworkRules(locale.snapshot), []);
  const zone = partialBrowser({ name: "123", timeZone: "Europe/Berlin" }, { locale: "fr-FR", timeZone: "Asia/Tokyo" });
  assert.equal(zone.run("new Intl.DateTimeFormat().resolvedOptions().timeZone"), "Europe/Berlin"); assert.equal(zone.run("new Intl.DateTimeFormat().resolvedOptions().locale"), "fr-FR");
  assert.equal(zone.run("Intl.NumberFormat===originalRefs.NumberFormat && String.prototype.localeCompare===originalRefs.string && navigator.geolocation.getCurrentPosition===originalRefs.geo"), true);
  assert.equal(zone.report.time, "installed"); assert.equal(zone.report.timeCompatibility.status, "passed"); assert.equal(zone.report.locale, "native");
  const keyboard = partialBrowser({ name: "123", keyboardLayout: "de-qwertz" });
  assert.equal(keyboard.report.keyboard, "installed"); assert.equal(keyboard.run("Date===originalRefs.Date && Intl.NumberFormat===originalRefs.NumberFormat && navigator.geolocation.getCurrentPosition===originalRefs.geo"), true);
  assert.equal(await keyboard.run("navigator.keyboard.getLayoutMap().then(map=>map.get('KeyY'))"), "z");
});

test("v1 backups migrate to v3 and drop retired geolocation settings", async () => {
  const old = JSON.parse(await read("./fixtures/config/v1.json")); const migrated = form.decodeConfiguration(JSON.stringify(old));
  assert.equal(migrated.sourceSchemaVersion, 1); assert.equal(migrated.file.schemaVersion, 3);
  assert.deepEqual(migrated.file.config, { ...old.config, profile: { ...old.config.profile, geolocation: { latitude: 52.52, longitude: 13.405 } } });
  const fields = form.profileToFields(migrated.file.config.profile); for (const key of ["accuracy", "altitude", "altitudeAccuracy", "speed", "heading"]) assert.equal(Object.hasOwn(fields, key), false);
  const invalid = structuredClone(old); delete invalid.config.profile.geolocation.latitude;
  assert.throws(() => form.decodeConfiguration(JSON.stringify(invalid)));
});

test("the same latitude-only JSON keeps distinct native locale, zone, keyboard and longitude on two PCs", () => {
  const file = { format: "oboro-config", schemaVersion: 3, oboroVersion: "0.3.3", config: { profile: { name: "123", geolocation: { latitude: 52.52 } }, sitePolicy: { mode: "selected_sites", include: [], exclude: [] }, ui: { language: "en", theme: "system" } }, permissionHints: { origins: [] } };
  const text = form.serializeConfiguration(file);
  const driver = `import {readFileSync} from 'node:fs';const {partialBrowser}=await import(process.argv[1]);const {file,pc}=JSON.parse(readFileSync(0,'utf8'));const page=partialBrowser(file.config.profile,pc);page.run("navigator.geolocation.getCurrentPosition(position=>received.push(position))");await page.flush();console.log(JSON.stringify({before:page.json('before'),after:page.json('values()'),coords:page.json('received[0].coords'),keyboard:await page.run("navigator.keyboard.getLayoutMap().then(map=>map.get('KeyY'))"),profile:page.snapshot.profile}));`;
  const results = [];
  for (const pc of [{ locale: "en-US", timeZone: "America/New_York", language: "en-US", longitude: -74, keyboard: "pc-one-y" }, { locale: "fr-FR", timeZone: "Asia/Tokyo", language: "fr-FR", longitude: 139, keyboard: "pc-two-y" }]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", driver, new URL("./helpers/partial-runtime.mjs", import.meta.url).href], { input: JSON.stringify({ file: JSON.parse(text), pc }), env: { ...process.env, TZ: pc.timeZone }, encoding: "utf8", maxBuffer: 2_000_000 });
    assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout); results.push(result);
    assert.deepEqual(result.after, result.before); assert.equal(result.coords.latitude, 52.52); assert.equal(result.coords.longitude, pc.longitude); assert.equal(result.keyboard, pc.keyboard);
    assert.equal(result.after.locale, pc.locale); assert.equal(Object.hasOwn(result.profile, "locale"), false); assert.equal(Object.hasOwn(result.profile, "timeZone"), false); assert.equal(Object.hasOwn(result.profile, "languages"), false);
  }
  assert.notEqual(results[0].after.hours, results[1].after.hours); assert.notEqual(results[0].after.locale, results[1].after.locale);
});
