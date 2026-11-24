import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { optionsPage, exampleProfile, testSitePolicy } from "./helpers/options-page.mjs";

const script = await readFile(new URL("../src/ui/language.js", import.meta.url), "utf8");
const theme = await readFile(new URL("../src/ui/theme.js", import.meta.url), "utf8");
const pages = ["popup/popup.html", "options/options.html", "probe/probe.html"];
const html = await Promise.all(pages.map(path => readFile(new URL("../src/" + path, import.meta.url), "utf8")));
function page({ index = 1, stored, denied = false, writesDenied = false } = {}) {
  const dom = new JSDOM(html[index], { url: "https://oboro.test/" + pages[index], runScripts: "outside-only" });
  const { window } = dom;
  Object.defineProperty(window.navigator, "language", { value: "ru-RU" });
  if (stored !== undefined) window.localStorage.setItem("oboro.language", stored);
  if (denied) Object.defineProperty(window, "localStorage", { get() { throw Error("synthetic storage denial"); } });
  if (writesDenied) window.Storage.prototype.setItem = () => { throw Error("synthetic write denial"); };
  window.eval(theme);
  window.eval(script);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  const control = window.document.querySelector("[data-language-select]");
  return { window, document: window.document, control,
    change(value) { control.value = value; control.dispatchEvent(new window.Event("change")); },
    close() { window.close(); }
  };
}
function change(ui, language) {
  const control = ui.document.querySelector("[data-language-select]");
  control.value = language;
  control.dispatchEvent(new ui.window.Event("change"));
}

test("UI language defaults to English independently of browser/profile languages on every extension page", () => {
  for (const index of [0, 1, 2]) {
    const ui = page({ index });
    try {
      assert.equal(ui.document.documentElement.lang, "en");
      assert.equal(ui.control.value, "en");
      assert.equal(ui.window.localStorage.getItem("oboro.language"), null);
      for (const element of ui.document.querySelectorAll("[data-i18n], [data-i18n-placeholder]")) {
        const value = element.hasAttribute("data-i18n") ? element.textContent : element.getAttribute("placeholder");
        assert.doesNotMatch(value, /[А-Яа-яЁё]/, value);
      }
      assert.equal(ui.document.querySelectorAll("[data-language-select]").length, 1);
      assert.equal(ui.document.querySelector('script[src="../ui/language.js"]').type, "");
    } finally { ui.close(); }
  }
});

test("Russian/English selection persists and is restored across options, popup and diagnostics", () => {
  const ui = page();
  try {
    ui.change("ru");
    assert.equal(ui.window.localStorage.getItem("oboro.language"), "ru");
    assert.equal(ui.document.title, "Настройки — oboro");
    assert.equal(ui.document.querySelector("#save-profile").textContent, "Сохранить профиль");
    for (const index of [0, 1, 2]) {
      const reopened = page({ index, stored: ui.window.localStorage.getItem("oboro.language") });
      try { assert.equal(reopened.document.documentElement.lang, "ru"); assert.equal(reopened.control.value, "ru"); }
      finally { reopened.close(); }
    }
    ui.change("en");
    assert.equal(ui.window.localStorage.getItem("oboro.language"), "en");
    const reopened = page({ stored: ui.window.localStorage.getItem("oboro.language") });
    try { assert.equal(reopened.document.title, "Settings — oboro"); }
    finally { reopened.close(); }
  } finally { ui.close(); }
});

test("open UI pages synchronize language, ignore unrelated storage and return to English after clearing", () => {
  const ui = page();
  const dispatch = (value, key = "oboro.language", storageArea = ui.window.localStorage) => ui.window.dispatchEvent(new ui.window.StorageEvent("storage", { key, newValue: value, storageArea }));
  try {
    dispatch("ru", "oboro.theme"); dispatch("ru", "oboro.language", ui.window.sessionStorage);
    assert.equal(ui.control.value, "en");
    dispatch("ru");
    assert.equal(ui.control.value, "ru"); assert.equal(ui.document.title, "Настройки — oboro");
    dispatch(null, null);
    assert.equal(ui.control.value, "en"); assert.equal(ui.document.title, "Settings — oboro");
  } finally { ui.close(); }
});

test("invalid or denied storage keeps the language selector usable and reports failed persistence", () => {
  const invalid = page({ stored: "unsupported" });
  try { assert.equal(invalid.control.value, "en"); }
  finally { invalid.close(); }
  for (const settings of [{ denied: true }, { writesDenied: true }]) {
    const ui = page(settings);
    try {
      assert.equal(ui.control.value, "en");
      ui.change("ru");
      assert.equal(ui.document.documentElement.lang, "ru");
      assert.equal(ui.document.querySelector("[data-language-feedback]").hidden, false);
      assert.match(ui.document.querySelector("[data-language-feedback]").textContent, /Не удалось сохранить/);
      ui.change("en");
      assert.match(ui.document.querySelector("[data-language-feedback]").textContent, /could not be saved/);
    } finally { ui.close(); }
  }
});

test("language changes retain dirty inputs, focus, validation and theme without saving/activating a profile", async t => {
  const profile = exampleProfile();
  profile.name = "Ошибка";
  const ui = optionsPage({ profile, policy: testSitePolicy(), language: null, uiStorage: { "oboro.theme": "dark" } });
  t.after(ui.close); await ui.flush();
  // Production head controllers use separate keys for theme and language.
  ui.set("latitude", "91"); ui.set("name", "Мой черновик");
  const input = ui.query('[name="latitude"]'); input.focus();
  const before = ui.snapshot(), calls = [...ui.calls], messages = ui.messages.length;
  assert.match(ui.query("#profile-error-latitude").textContent, /outside the allowed range/);
  for (const language of ["ru", "en", "ru", "en"]) {
    change(ui, language);
    assert.equal(ui.document.activeElement, input);
    assert.equal(ui.query('[name="name"]').value, "Мой черновик");
    assert.equal(input.value, "91"); assert.equal(input.getAttribute("aria-invalid"), "true");
    assert.equal(ui.query('[name="languages"]').value, profile.languages.join(", "));
    assert.equal(ui.query('[name="locale"]').value, profile.locale);
    assert.equal(ui.query("#apply-profile").disabled, true);
    assert.equal(ui.document.documentElement.dataset.theme, "dark");
  }
  assert.match(ui.query("#profile-draft-state").textContent, /unsaved changes/);
  assert.equal(ui.query("#profile-title").textContent, "Ошибка");
  assert.deepEqual(ui.snapshot(), before); assert.deepEqual(ui.calls, calls); assert.equal(ui.messages.length, messages);
});

test("dynamic save results preserve user names and retranslate after language switching", async t => {
  const ui = optionsPage({ language: null }); t.after(ui.close); await ui.flush();
  ui.click("#profile-example");
  const name = 'Ошибка <img src=x onerror=alert(1)>';
  ui.set("name", name); ui.submit("#profile-form"); await ui.flush();
  assert.match(ui.query("#profile-save-feedback").textContent, /Profile “Ошибка <img/);
  change(ui, "ru");
  assert.match(ui.query("#profile-save-feedback").textContent, /Профиль «Ошибка <img/);
  change(ui, "en");
  assert.match(ui.query("#active-profile").textContent, /Saved profile: “Ошибка <img/);
  assert.equal(ui.query("#profile-title").textContent, name);
  assert.equal(ui.query("#profile-save-feedback img"), null);
  assert.equal(ui.snapshot().regionalProfile.name, name);
});

test("English runtime reasons retain the Chrome compatibility gate; switching localizes existing errors", async t => {
  const ui = optionsPage({ profile: exampleProfile(), policy: testSitePolicy(), origins: ["https://example.com/*"], language: null });
  t.after(ui.close); await ui.flush();
  ui.click("#apply-profile"); await ui.flush();
  assert.match(ui.query("#activation-details").textContent, /Import a full compatibility report/);
  assert.doesNotMatch(ui.query("#activation-details").textContent, /[А-Яа-яЁё]/);
  assert.equal(ui.installed().main.length, 0);
  change(ui, "ru");
  assert.match(ui.query("#activation-details").textContent, /Импортируйте полный отчёт/);
  change(ui, "en");
  assert.match(ui.query("#status-label").textContent, /Limited/);
  ui.query('#site-form [name="host"]').value = "https://invalid.example/path";
  ui.submit("#site-form");
  assert.match(ui.query("#site-feedback").textContent, /Enter an exact host/);
  change(ui, "ru"); assert.match(ui.query("#site-feedback").textContent, /Укажите точный хост/);

  const active = optionsPage({ profile: exampleProfile(), policy: testSitePolicy(), origins: ["https://example.com/*"], proof: true, language: null });
  t.after(active.close); await active.flush(); active.click("#apply-profile"); await active.flush();
  assert.equal(active.query("#status-label").textContent, "Applied to documents");
  assert.match(active.query("#document-coverage").textContent, /Profile: 1; expected 1/);
  assert.doesNotMatch(active.query("#document-coverage").textContent, /[А-Яа-яЁё]/);
  change(active, "ru"); assert.match(active.query("#document-coverage").textContent, /Установлено в документе/);
  change(active, "en"); assert.match(active.query("#document-coverage").textContent, /Installed in document/);
});

test("unmarked user content and raw JSON remain unchanged while new marked messages localize", async () => {
  const ui = page();
  try {
    const raw = ui.document.querySelector("#activation-diagnostics");
    ui.window.oboroI18n.setPlainText(raw, '{"name":"Ошибка","reason":"Нужен доступ"}');
    const message = ui.document.createElement("p"); message.dataset.i18n = "Сохранение…";
    ui.document.body.append(message); await new Promise(setImmediate);
    assert.equal(message.textContent, "Saving…");
    ui.change("ru"); assert.equal(message.textContent, "Сохранение…");
    ui.change("en"); assert.equal(message.textContent, "Saving…");
    assert.equal(raw.textContent, '{"name":"Ошибка","reason":"Нужен доступ"}');
    assert.equal(ui.window.oboroI18n.translate("Недоступен Изолированный диагностический канал."), "Unavailable: Isolated diagnostics channel.");
    assert.equal(ui.window.oboroI18n.translate("Untranslated message: {0}", "Ошибка"), "Untranslated message: Ошибка");
  } finally { ui.close(); }
});
