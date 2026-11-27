import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { optionsPage, exampleProfile, testSitePolicy } from "./helpers/options-page.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/config/v1.json", import.meta.url), "utf8"));
const partialFixture = JSON.parse(await readFile(new URL("./fixtures/config/v2.json", import.meta.url), "utf8"));
const copy = value => JSON.parse(JSON.stringify(value));
async function selectFile(ui, value, { size } = {}) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const file = new ui.window.File([text], "config.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  Object.defineProperty(ui.query("#import-config-file"), "files", { configurable: true, value: [file] });
  ui.query("#import-config-file").dispatchEvent(new ui.window.Event("change"));
  await ui.flush();
}
function changeLanguage(ui, language) {
  const control = ui.query("[data-language-select]"); control.value = language; control.dispatchEvent(new ui.window.Event("change"));
}
function changeTheme(ui, theme) {
  const control = ui.query("[data-theme-select]"); control.value = theme; control.dispatchEvent(new ui.window.Event("change"));
}
const blobText = (ui, blob) => new Promise((resolve, reject) => { const reader = new ui.window.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(blob); });

test("configuration UI exports a real JSON download with manifest version, saved data and current UI preferences", async t => {
  const ui = optionsPage({ profile: exampleProfile(), policy: testSitePolicy(), language: null, uiStorage: { "oboro.theme": "dark" } });
  t.after(ui.close); await ui.flush();
  const captured = [];
  ui.window.URL.createObjectURL = blob => { captured.push({ blob }); return "blob:https://oboro.test/config"; };
  ui.window.URL.revokeObjectURL = () => {};
  ui.window.HTMLAnchorElement.prototype.click = function () { captured[0].name = this.download; };
  ui.set("name", "unsaved draft");
  const before = ui.snapshot(); ui.click("#export-config"); await ui.flush();
  assert.equal(captured.length, 1); assert.equal(captured[0].name, "oboro-config-" + ui.window.chrome.runtime.getManifest().version + ".json");
  assert.equal(captured[0].blob.type, "application/json");
  const file = JSON.parse(await blobText(ui, captured[0].blob));
  assert.equal(file.oboroVersion, ui.window.chrome.runtime.getManifest().version); assert.equal(file.schemaVersion, 2);
  assert.equal(file.config.profile.name, exampleProfile().name); assert.equal(file.config.ui.language, "en"); assert.equal(file.config.ui.theme, "dark");
  assert.equal("revision" in file.config.profile, false); assert.deepEqual(ui.snapshot(), before);
  assert.equal(ui.query('[name="name"]').value, "unsaved draft"); assert.equal(ui.calls.includes("permission.request"), false);
  assert.match(ui.query("#config-feedback").textContent, /Unsaved edits are not included/);
});

test("configuration UI previews exact changes safely and cancel preserves saved state", async t => {
  const ui = optionsPage({ profile: exampleProfile(), language: null }); t.after(ui.close); await ui.flush();
  const config = copy(fixture); config.config.profile.name = '<img src=x onerror=alert(1)>';
  const before = ui.snapshot(); await selectFile(ui, config);
  assert.equal(ui.query("#config-preview").hidden, false); assert.equal(ui.query("#import-config-confirm").disabled, false);
  assert.match(ui.query("#config-source").textContent, /File from oboro 0.3.1, format 1/);
  assert.ok(ui.query("#config-change-rows").textContent.includes(config.config.profile.name));
  assert.equal(ui.query("#config-preview img"), null);
  assert.deepEqual(ui.snapshot(), before); assert.equal(ui.calls.includes("permission.request"), false);
  changeLanguage(ui, "ru"); assert.match(ui.query("#config-source").textContent, /Файл oboro/);
  changeLanguage(ui, "en"); assert.match(ui.query("#config-source").textContent, /File from oboro/);
  ui.click("#import-config-cancel"); assert.equal(ui.query("#config-preview").hidden, true); assert.deepEqual(ui.snapshot(), before);
});

test("sparse JSON import clears old overrides, shows native values and applies without language header rules", async t => {
  const ui = optionsPage({ profile: exampleProfile(), policy: testSitePolicy(), origins: ["https://example.com/*"], proof: true, language: null });
  t.after(ui.close); await ui.flush();
  ui.click("#apply-profile"); await ui.flush(); assert.equal(ui.installed().rules.length, 1);
  await selectFile(ui, partialFixture);
  assert.match(ui.query("#config-source").textContent, /File from oboro 0.3.2, format 2/);
  assert.match(ui.query("#config-change-rows").textContent, /Browser value/);
  ui.click("#import-config-confirm"); await ui.flush();
  assert.deepEqual(ui.snapshot().regionalProfile.geolocation, { latitude: 52.52 });
  assert.equal(ui.snapshot().activationState.enabled, false);
  for (const name of ["longitude", "accuracy", "altitude", "altitudeAccuracy", "speed", "heading", "languages", "locale", "timeZone"]) {
    assert.equal(ui.query(`#profile-form [name="${name}"]`).value, "", name);
  }
  ui.set("name", "123 renamed"); ui.click("#save-profile"); await ui.flush();
  const saved = ui.snapshot().regionalProfile;
  for (const key of ["languages", "language", "locale", "timeZone"]) assert.equal(Object.hasOwn(saved, key), false, key);
  assert.deepEqual(saved.geolocation, { latitude: 52.52 });
  ui.click("#apply-profile"); await ui.flush();
  assert.equal(ui.snapshot().activationState.status, "READY");
  assert.equal(ui.installed().rules.length, 0);
  assert.equal(ui.calls.includes("permission.request"), false);
});

test("configuration UI restores all settings, stays OFF, persists language/theme and grants only on an explicit click", async t => {
  const ui = optionsPage({ language: null }); t.after(ui.close); await ui.flush();
  await selectFile(ui, fixture); ui.click("#import-config-confirm"); await ui.flush();
  const saved = ui.snapshot();
  assert.equal(saved.regionalProfile.name, fixture.config.profile.name); assert.equal(saved.regionalProfile.geolocation.altitude, 0);
  assert.deepEqual(saved.sitePolicy.include, fixture.config.sitePolicy.include);
  assert.equal(saved.activationState.enabled, false); assert.equal(saved.extensionPreferences.masterEnabled, false);
  assert.deepEqual(ui.installed(), { main: [], bridge: [], rules: [] }); assert.equal(ui.calls.includes("permission.request"), false);
  assert.equal(ui.document.documentElement.lang, "ru"); assert.equal(ui.document.documentElement.dataset.themePreference, "dark");
  assert.equal(ui.window.localStorage.getItem("oboro.language"), "ru"); assert.equal(ui.window.localStorage.getItem("oboro.theme"), "dark");
  assert.match(ui.query("#config-feedback").textContent, /Конфигурация восстановлена/);
  assert.equal(ui.query("#config-access").hidden, false);
  ui.click("#grant-config-access"); await ui.flush();
  assert.equal(ui.calls.filter(value => value === "permission.request").length, 1);
  assert.equal(ui.snapshot().activationState.enabled, false); assert.equal(ui.query("#config-access").hidden, true);
  // The existing mandatory Chrome evidence gate still applies after restoration.
  ui.click("#apply-profile"); await ui.flush();
  assert.equal(ui.installed().main.length, 0); assert.match(ui.query("#activation-details").textContent, /Импортируйте полный отчёт/);

  const reopened = optionsPage({ initial: saved, uiStorage: Object.fromEntries(Object.entries(ui.window.localStorage)), language: null }); t.after(reopened.close); await reopened.flush();
  assert.equal(reopened.document.documentElement.lang, "ru"); assert.equal(reopened.document.documentElement.dataset.themePreference, "dark");
  changeLanguage(reopened, "en"); changeTheme(reopened, "light");
  const again = optionsPage({ initial: reopened.snapshot(), uiStorage: Object.fromEntries(Object.entries(reopened.window.localStorage)), language: null }); t.after(again.close); await again.flush();
  assert.equal(again.document.documentElement.lang, "en"); assert.equal(again.document.documentElement.dataset.themePreference, "light");
});

test("a closed importing page still restores UI preferences when a new options page opens", async t => {
  const first = optionsPage({ language: null }); t.after(first.close); await first.flush();
  const response = await first.control("config.preview", { text: JSON.stringify(fixture), ui: { language: "en", theme: "system" } });
  assert.equal(response.ok, true);
  const restored = await first.control("config.import", { previewId: response.result.id }); assert.equal(restored.ok, true);
  // Reopen without any local UI cache/ack, just the durable worker storage.
  const reopened = optionsPage({ initial: first.snapshot(), language: null }); t.after(reopened.close); await reopened.flush();
  assert.equal(reopened.document.documentElement.lang, "ru"); assert.equal(reopened.query("[data-language-select]").value, "ru");
  assert.equal(reopened.document.documentElement.dataset.theme, "dark");
});

test("restoring an active configuration clears registrations and requires a separate apply", async t => {
  const ui = optionsPage({ profile: exampleProfile(), policy: testSitePolicy(), origins: ["https://example.com/*"], proof: true, language: null });
  t.after(ui.close); await ui.flush(); ui.click("#apply-profile"); await ui.flush();
  assert.equal(ui.query("#status-label").textContent, "Applied to documents"); assert.equal(ui.installed().main.length, 1);
  const reloads = ui.calls.filter(call => call.startsWith("reload:")).length;
  await selectFile(ui, fixture); ui.click("#import-config-confirm"); await ui.flush();
  assert.deepEqual(ui.installed(), { main: [], bridge: [], rules: [] }); assert.equal(ui.snapshot().activationState.enabled, false);
  assert.equal(ui.calls.filter(call => call.startsWith("reload:")).length, reloads);
  assert.match(ui.query("#config-feedback").textContent, /ранее обработанные страницы требуют перезагрузки/);
  ui.click("#apply-profile"); await ui.flush(); assert.equal(ui.installed().main.length, 1);
  assert.equal(ui.snapshot().activationState.status, "READY");
});

test("an interface RPC failure after a verified import is reported without claiming the saved import failed", async t => {
  const ui = optionsPage({ language: null }); t.after(ui.close); await ui.flush(); await selectFile(ui, fixture);
  const send = ui.window.chrome.runtime.sendMessage;
  ui.window.chrome.runtime.sendMessage = message => message.operation === "config.uiRestore" ? Promise.reject(Error("synthetic transport failure")) : send(message);
  ui.click("#import-config-confirm"); await ui.flush();
  assert.equal(ui.snapshot().regionalProfile.name, fixture.config.profile.name);
  assert.match(ui.query("#config-feedback").textContent, /Configuration restored and overrides are off.*reopen settings/);
  const reopened = optionsPage({ initial: ui.snapshot(), language: null }); t.after(reopened.close); await reopened.flush();
  assert.equal(reopened.document.documentElement.lang, "ru"); assert.equal(reopened.document.documentElement.dataset.themePreference, "dark");
});

test("legacy profile import preserves site policy and chosen interface preferences", async t => {
  const policy = testSitePolicy("all_granted_sites");
  const ui = optionsPage({ policy, language: null, uiStorage: { "oboro.theme": "light" } }); t.after(ui.close); await ui.flush();
  await selectFile(ui, exampleProfile());
  assert.equal(ui.query("#config-all-granted-note").hidden, false);
  assert.match(ui.query("#config-source").textContent, /version is unknown; sites, language and theme will be kept/);
  ui.click("#import-config-confirm"); await ui.flush();
  assert.deepEqual(ui.snapshot().sitePolicy, policy); assert.equal(ui.document.documentElement.lang, "en");
  assert.equal(ui.document.documentElement.dataset.themePreference, "light"); assert.equal(ui.snapshot().regionalProfile.keyboardLayout, "native");
});

test("dirty profile/mode drafts block replacement and remain in their forms", async t => {
  const ui = optionsPage({ profile: exampleProfile(), policy: testSitePolicy(), language: null }); t.after(ui.close); await ui.flush();
  await selectFile(ui, fixture); ui.set("name", "keep my draft");
  assert.equal(ui.query("#import-config-confirm").disabled, true); assert.equal(ui.query("#config-draft-hint").hidden, false);
  const before = ui.snapshot(); ui.click("#import-config-confirm"); await ui.flush();
  assert.deepEqual(ui.snapshot(), before); assert.equal(ui.query('[name="name"]').value, "keep my draft");
  ui.click("#reload-profile"); await ui.flush(); assert.equal(ui.query("#import-config-confirm").disabled, false);
  ui.changeMode("all_granted_sites"); assert.equal(ui.query("#import-config-confirm").disabled, true);
  assert.equal(ui.query("#export-config").disabled, false);
});

test("invalid/future files and conflicting previews never overwrite settings", async t => {
  const ui = optionsPage({ profile: exampleProfile(), language: null }); t.after(ui.close); await ui.flush();
  const before = ui.snapshot(); const future = copy(fixture); future.schemaVersion = 3;
  await selectFile(ui, future); assert.match(ui.query("#config-feedback").textContent, /newer configuration format/);
  assert.equal(ui.query("#config-preview").hidden, true); assert.deepEqual(ui.snapshot(), before);
  await selectFile(ui, "{invalid"); assert.match(ui.query("#config-feedback").textContent, /Could not read/); assert.deepEqual(ui.snapshot(), before);
  await selectFile(ui, fixture, { size: 1_048_577 }); assert.match(ui.query("#config-feedback").textContent, /maximum 1 MiB/);
  await selectFile(ui, fixture);
  const changed = exampleProfile(); changed.name = "another editor"; changed.revision = 2;
  ui.externalProfileWithoutEvent(changed); ui.click("#import-config-confirm"); await ui.flush();
  assert.equal(ui.snapshot().regionalProfile.name, "another editor"); assert.match(ui.query("#config-feedback").textContent, /Settings changed after the preview/);
});

test("configuration RPC rejects unknown command fields and unreviewed import IDs", async t => {
  const ui = optionsPage({ language: null }); t.after(ui.close); await ui.flush();
  const before = ui.snapshot();
  const response = await ui.control("config.export", { ui: { language: "en", theme: "system" }, activationId: "not-allowed" });
  assert.equal(response.ok, false); assert.equal(response.error.code, "INVALID_REQUEST");
  const apply = await ui.control("config.import", { previewId: "not-reviewed" }); assert.equal(apply.ok, false); assert.equal(apply.error.code, "CONFIG_PREVIEW_EXPIRED");
  assert.deepEqual(ui.snapshot(), before);
});
