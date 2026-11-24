import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { renderDocument } from "../fixtures/i02/server.mjs";

const script = await readFile(new URL("../src/ui/theme.js", import.meta.url), "utf8");
const sample = '<label>Тема<select data-theme-select><option value="system">Как в системе</option><option value="light">Светлая</option><option value="dark">Тёмная</option></select></label><p data-theme-feedback hidden></p>';
function page({ dark = false, stored, denied = false, html = sample, path = "options/options.html" } = {}) {
  const dom = new JSDOM(html, { url: `https://oboro.test/${path}`, runScripts: "outside-only" });
  const { window } = dom;
  const media = new window.EventTarget();
  media.matches = dark;
  window.matchMedia = () => media;
  if (stored !== undefined) window.localStorage.setItem("oboro.theme", stored);
  if (denied) Object.defineProperty(window, "localStorage", { get() { throw new Error("synthetic denied storage"); } });
  window.eval(script);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  const control = window.document.querySelector("[data-theme-select]");
  return {
    window, control, root: window.document.documentElement,
    change(value) { control.value = value; control.dispatchEvent(new window.Event("change")); },
    system(value) { media.matches = value; media.dispatchEvent(new window.Event("change")); },
    storage(value, key = "oboro.theme", storageArea = window.localStorage) { window.dispatchEvent(new window.StorageEvent("storage", { key, newValue: value, storageArea })); },
    close() { window.close(); }
  };
}

test("oboro: системная тема применяется сразу и следует за настройкой ОС", () => {
  const ui = page({ dark: true });
  try {
    assert.equal(ui.root.dataset.theme, "dark");
    assert.equal(ui.root.dataset.themePreference, "system");
    assert.equal(ui.control.value, "system");
    ui.system(false);
    assert.equal(ui.root.dataset.theme, "light");
    ui.system(true);
    assert.equal(ui.root.dataset.theme, "dark");
  } finally { ui.close(); }
});

test("oboro: явный выбор важнее ОС, сохраняется и восстанавливается при открытии", () => {
  const ui = page({ dark: true });
  try {
    ui.change("light");
    assert.equal(ui.window.localStorage.getItem("oboro.theme"), "light");
    ui.system(false); ui.system(true);
    assert.equal(ui.root.dataset.theme, "light");
    const reopened = page({ dark: true, stored: ui.window.localStorage.getItem("oboro.theme") });
    try { assert.equal(reopened.root.dataset.theme, "light"); assert.equal(reopened.control.value, "light"); }
    finally { reopened.close(); }
    ui.change("dark"); ui.system(false);
    assert.equal(ui.root.dataset.theme, "dark");
    ui.change("system");
    assert.equal(ui.root.dataset.theme, "light");
    assert.equal(ui.window.localStorage.getItem("oboro.theme"), "system");
  } finally { ui.close(); }
});

test("oboro: открытые страницы синхронизируют тему и не реагируют на постороннее хранилище", () => {
  const ui = page({ dark: true, stored: "light" });
  try {
    ui.storage("dark", "another-setting");
    ui.storage("dark", "oboro.theme", ui.window.sessionStorage);
    assert.equal(ui.root.dataset.theme, "light");
    ui.storage("dark");
    assert.equal(ui.root.dataset.theme, "dark"); assert.equal(ui.control.value, "dark");
    ui.storage("system"); ui.system(false);
    assert.equal(ui.root.dataset.theme, "light"); assert.equal(ui.control.value, "system");
    ui.storage("light"); ui.system(true);
    ui.storage(null, null);
    assert.equal(ui.root.dataset.theme, "dark"); assert.equal(ui.root.dataset.themePreference, "system");
  } finally { ui.close(); }
});

test("oboro: повреждённый выбор и отказ хранилища сохраняют работоспособность темы", () => {
  const invalid = page({ dark: true, stored: "unexpected-value" });
  try { assert.equal(invalid.root.dataset.theme, "dark"); assert.equal(invalid.control.value, "system"); }
  finally { invalid.close(); }
  const denied = page({ dark: true, denied: true });
  try {
    assert.equal(denied.root.dataset.theme, "dark");
    denied.change("light");
    assert.equal(denied.root.dataset.theme, "light");
    const feedback = denied.window.document.querySelector("[data-theme-feedback]");
    assert.equal(feedback.hidden, false); assert.match(feedback.textContent, /Не удалось сохранить/);
  } finally { denied.close(); }
});

test("oboro: popup, настройки, диагностика и Oboro Check подключают общий переключатель", async () => {
  const pages = [
    ["src/popup/popup.html", "popup/popup.html"],
    ["src/options/options.html", "options/options.html"],
    ["src/probe/probe.html", "probe/probe.html"]
  ];
  for (const [file, path] of pages) {
    const html = await readFile(new URL("../" + file, import.meta.url), "utf8");
    const ui = page({ html, path, stored: "dark" });
    try {
      assert.equal(ui.root.dataset.theme, "dark");
      assert.equal(ui.control.value, "dark");
      assert.equal(ui.window.document.querySelector("script").getAttribute("src"), "../ui/theme.js");
      assert.doesNotMatch(ui.window.document.body.textContent, /\b(?:I02|M0)\b/);
      ui.change("light"); assert.equal(ui.root.dataset.theme, "light");
    } finally { ui.close(); }
  }
  const html = renderDocument({ network: { id: "theme-document" }, runId: "theme-test", origin: "http://selected.localhost:8787", frame: false, port: 8787, protocol: "http:" });
  const ui = page({ html, stored: "dark" });
  try {
    assert.equal(ui.window.document.title, "Oboro Check — Выбранный сайт");
    assert.ok(ui.window.document.querySelector("script").hasAttribute("data-request-id"), "Снимок окружения остаётся первым скриптом стенда");
    assert.ok(ui.window.document.querySelector('script[src="/theme.js"]'));
    assert.equal(ui.control.value, "dark");
    ui.change("light"); assert.equal(ui.root.dataset.theme, "light");
  } finally { ui.close(); }
});
