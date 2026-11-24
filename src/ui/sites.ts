import { setText, setPlainText } from "./i18n";
import { loadSitePolicy, saveSitePolicy } from "../control/client";
import { emptySitePolicy, normalizeSiteRule, policyToDraft, resolveSite, ruleOrigins, type SitePolicy, type SiteRule } from "../sites/policy";
import { performSiteAction } from "../sites/actions";
import { SITE_DRAFT_EVENT } from "./profile-events";

export function mountSites(): void {
  const form = document.querySelector<HTMLFormElement>("#site-form");
  const table = document.getElementById("site-list");
  const feedback = document.getElementById("site-feedback");
  if (!form || !table || !feedback) return;
  let policy: SitePolicy = emptySitePolicy();
  let origins: string[] = [];
  let loaded = false;
  let modeBusy = false;
  let pendingMode: SitePolicy["mode"] | null = null;
  const modeForm = document.querySelector<HTMLFormElement>("#site-mode-form");
  const modeSelect = document.querySelector<HTMLSelectElement>("#site-selection-mode");
  const modeSave = document.querySelector<HTMLButtonElement>("#save-site-mode");
  const updateMode = (): void => {
    if (modeSelect) { modeSelect.disabled = !loaded || modeBusy; modeSelect.value = pendingMode ?? policy.mode; }
    if (modeSave) modeSave.disabled = !loaded || modeBusy || !pendingMode || pendingMode === policy.mode;
    window.dispatchEvent(new CustomEvent(SITE_DRAFT_EVENT, { detail: { blocked: Boolean(pendingMode && pendingMode !== policy.mode) } }));
  };
  let refreshVersion = 0;
  const show = (text: string): void => { setText(feedback, text); };
  const refresh = async (): Promise<void> => {
    const version = ++refreshVersion;
    const [next, grants] = await Promise.all([loadSitePolicy(), chrome.permissions.getAll()]);
    const entries = await Promise.all((["include", "exclude"] as const).flatMap((kind) => next[kind].map(async (rule, index) => ({ kind, rule, index, granted: await chrome.permissions.contains({ origins: ruleOrigins(rule) }) }))));
    if (version !== refreshVersion) return;
    policy = next; origins = grants.origins ?? []; loaded = true;
    if (pendingMode === policy.mode) pendingMode = null;
    updateMode();
    const mode = document.getElementById("site-mode");
    if (mode) setText(mode, policy.mode === "all_granted_sites" ? "Режим: все адреса с выданным доступом, кроме исключений. Новое разрешение включает адрес в этом режиме." : "Режим: только явно выбранные сайты. Выданное разрешение само по себе не выбирает сайт.");
    const permissionChoice = form.querySelector<HTMLOptionElement>('option[value="permission"]');
    if (permissionChoice) setText(permissionChoice, policy.mode === "all_granted_sites" ? "Выдать доступ (адрес будет выбран в этом режиме)" : "Выдать только доступ");
    const includeChoice = form.querySelector<HTMLOptionElement>('option[value="include"]');
    if (includeChoice) setText(includeChoice, policy.mode === "all_granted_sites" ? "Сохранить сайт и выдать доступ" : "Выбрать сайт");
    setPlainText(table, "");
    for (const { kind, index, rule, granted } of entries) {
      const row = document.createElement("div"); row.className = "site-row";
      const summary = document.createElement("div");
      const label = document.createElement("strong"); setPlainText(label, `${rule.includeSubdomains ? "*." : ""}${rule.host}`);
      const state = resolveSite(`${rule.schemes[0]}://${rule.host}/`, policy, origins);
      const detail = document.createElement("p"); detail.className = "help";
      setText(detail, `${rule.schemes.join(" / ").toUpperCase()} · ${kind === "exclude" || state.selection === "excluded" ? "Исключён" : state.selection === "selected" ? "Выбран" : "Сохранён в списке"}${kind === "include" ? granted ? " · Доступ выдан" : " · Нужен доступ" : ""}`);
      summary.append(label, detail); row.append(summary);
      if (kind === "include" && !granted) {
        const grant = document.createElement("button"); grant.type = "button"; setText(grant, "Выдать доступ");
        grant.addEventListener("click", () => {
          const request = chrome.permissions.request({ origins: ruleOrigins(rule) });
          void request.then(async (allowed) => { show(allowed ? "Доступ выдан. Примените профиль." : "Доступ не выдан; сайт остаётся выбранным без доступа."); await refresh(); }).catch((error: unknown) => show(String(error)));
        }); row.append(grant);
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger-button"; setText(remove, "Удалить");
      remove.addEventListener("click", () => {
        const draft = policyToDraft(policy);
        void saveSitePolicy({ ...draft, [kind]: draft[kind].filter((_, item) => item !== index) }, policy.policyRevision)
          .then(async () => { show("Правило удалено. Выбор определяется текущим режимом и доступами. Открытым документам может понадобиться перезагрузка."); await refresh(); }).catch((error: unknown) => show(String(error)));
      }); row.append(remove); table.append(row);
    }
    if (!policy.include.length && !policy.exclude.length) setText(table, policy.mode === "all_granted_sites" ? "Отдельных правил нет. Выбраны адреса с выданными разрешениями." : "Список пуст. Ни один сайт не выбран.");
    const grantedList = document.getElementById("granted-sites");
    if (grantedList) {
      setPlainText(grantedList, "");
      for (const origin of origins.filter((value) => /^https?:\/\//.test(value) || value === "<all_urls>")) {
        const row = document.createElement("p"); row.className = "grant-row"; setPlainText(row, origin); grantedList.append(row);
      }
      if (!grantedList.childNodes.length) setText(grantedList, "Доступ к сайтам не выдан.");
    }
  };
  modeSelect?.addEventListener("change", () => {
    if (modeSelect.value === "selected_sites" || modeSelect.value === "all_granted_sites") pendingMode = modeSelect.value;
    updateMode();
  });
  modeForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loaded || modeBusy || !pendingMode) return;
    modeBusy = true; const mode = pendingMode; updateMode();
    void saveSitePolicy({ ...policyToDraft(policy), mode }, policy.policyRevision).then(async () => {
      pendingMode = null; show("Режим сохранён, исключения сохранены. Новые доступы не запрашивались. Примените изменения и перезагрузите страницы."); await refresh();
    }).catch((error: unknown) => show(error instanceof Error ? error.message : String(error))).finally(() => { modeBusy = false; updateMode(); });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loaded) { show("Дождитесь загрузки списка сайтов."); return; }
    try {
      const values = new FormData(form);
      const rule = normalizeSiteRule({ host: values.get("host"), includeSubdomains: values.has("subdomains"), schemes: [values.has("http") ? "http" : null, values.has("https") ? "https" : null].filter(Boolean) });
      const kind = values.get("kind");
      const action = performSiteAction(kind, rule, policy, { request: (origins) => chrome.permissions.request({ origins }), save: saveSitePolicy });
      void action.then(async ({ granted }) => {
        show(kind === "permission" ? granted ? policy.mode === "all_granted_sites" ? "Доступ выдан. Адрес выбран в режиме всех доступных сайтов, если не исключён." : "Доступ выдан. Сайт включается только отдельным правилом выбора." : "В доступе отказано. Список сайтов не изменён."
          : kind === "exclude" ? "Исключение сохранено." : granted ? "Сайт выбран, доступ выдан. Примените профиль." : "Сайт выбран, но доступ не выдан. Подмены на нём не включены.");
        await refresh();
      }).catch((error: unknown) => show(String(error)));
    } catch (error) { show(error instanceof Error ? error.message : String(error)); }
  });
  chrome.permissions.onAdded.addListener(() => { void refresh().catch((error: unknown) => show(String(error))); });
  chrome.permissions.onRemoved.addListener(() => { void refresh().catch((error: unknown) => show(String(error))); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.sitePolicy) void refresh().catch((error: unknown) => show(String(error))); });
  void refresh().catch((error: unknown) => show(String(error)));
}

export function mountCurrentSiteAction(): void {
  const button = document.querySelector<HTMLButtonElement>("#select-current-site");
  const feedback = document.getElementById("feedback");
  if (!button || !feedback) return;
  let rule: SiteRule | null = null;
  let policy: SitePolicy | null = null;
  void Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), loadSitePolicy()]).then(([tabs, current]) => {
    const url = new URL(tabs[0]?.url ?? "");
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("На этой странице подмены недоступны.");
    rule = normalizeSiteRule({ host: url.hostname, schemes: [url.protocol.slice(0, -1)], includeSubdomains: false });
    policy = current; button.disabled = false; setText(button, "Подменять на {0}", url.hostname);
  }).catch(() => { setText(button, "Этот тип страницы не поддерживается"); });
  button.addEventListener("click", () => {
    if (!rule || !policy) return;
    const target = rule; const current = policy;
    const request = performSiteAction("include", target, current, { request: (origins) => chrome.permissions.request({ origins }), save: saveSitePolicy });
    button.disabled = true;
    void request.then(({ granted: allowed, policy: next }) => {
      policy = next;
      const excluded = resolveSite(`${target.schemes[0]}://${target.host}/`, policy).selection === "excluded";
      setText(feedback, excluded ? "Сайт остаётся исключённым. Проверьте список исключений в настройках." : allowed ? "Сайт выбран. Примените профиль в настройках." : "Сайт выбран, но в доступе отказано. Подмены не включены.");
    }).catch((error: unknown) => { setText(feedback, String(error)); }).finally(() => { button.disabled = false; });
  });
}
