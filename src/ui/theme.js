// @ts-check
// A classic, local script runs before styles and page modules to restore the
// chosen theme without flashing the system theme on extension pages.
(() => {
  /** @typedef {"system" | "light" | "dark"} ThemePreference */
  const key = "oboro.theme";
  const root = document.documentElement;
  /** @type {Storage | undefined} */
  let storage;
  /** @param {unknown} value @returns {ThemePreference} */
  const normalize = (value) => value === "light" || value === "dark" ? value : "system";
  /** @type {ThemePreference} */
  let preference = "system";
  try {
    storage = window.localStorage;
    preference = normalize(storage.getItem(key));
  } catch { /* The system theme still works when local storage is unavailable. */ }
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const controls = () => /** @type {NodeListOf<HTMLSelectElement>} */ (document.querySelectorAll("select[data-theme-select]"));
  const feedback = () => /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll("[data-theme-feedback]"));
  const apply = () => {
    root.dataset.themePreference = preference;
    root.dataset.theme = preference === "system" ? (media?.matches ? "dark" : "light") : preference;
    for (const control of controls()) control.value = preference;
  };
  apply();

  const mount = () => {
    apply();
    for (const control of controls()) control.addEventListener("change", () => {
      preference = normalize(control.value);
      apply();
      let saved = false;
      try { if (storage) { storage.setItem(key, preference); saved = true; } } catch { /* Keep the current window usable. */ }
      for (const message of feedback()) {
        if (saved) message.removeAttribute("data-i18n");
        else message.setAttribute("data-i18n", "Тема изменена для этого окна. Не удалось сохранить выбор.");
        message.textContent = saved ? "" : "Тема изменена для этого окна. Не удалось сохранить выбор.";
        message.hidden = saved;
      }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
  media?.addEventListener("change", () => { if (preference === "system") apply(); });
  window.addEventListener("oboro:restore-ui", (event) => {
    const detail = /** @type {CustomEvent<{theme?: unknown}>} */ (event).detail;
    if (!detail || !["system", "light", "dark"].includes(String(detail.theme))) return;
    preference = normalize(detail.theme); apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.storageArea !== storage || (event.key !== key && event.key !== null)) return;
    preference = normalize(event.newValue);
    apply();
    for (const message of feedback()) { message.hidden = true; message.removeAttribute("data-i18n"); message.textContent = ""; }
  });
})();
