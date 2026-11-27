import { controlRequest } from "../control/client";
import { CONFIG_PERMISSION_HINTS_KEY, MAX_CONFIG_BYTES, type ConfigurationFile, type ConfigurationImportResult, type ConfigurationPreview, type SavedConfiguration } from "../config/types";
import { serializeConfiguration } from "../config/format";
import { keyboardLayout } from "../keyboard/layouts";
import { PROFILE_FIELD_LABELS } from "./profile-form";
import { PROFILE_DRAFT_EVENT, SITE_DRAFT_EVENT, type ProfileDraftState } from "./profile-events";
import { currentUiPreferences, mountUiPreferences, restoreUiPreferences } from "./config-preferences";
import { setPlainText, setText } from "./i18n";

interface Cell { value: string; localized?: boolean; }
interface Row { label: string; cell: Cell; }
const plain = (value: string): Cell => ({ value });
const localized = (value: string): Cell => ({ value, localized: true });
function configurationRows(config: SavedConfiguration): Row[] {
  const profile = config.profile;
  const rows: Row[] = [{ label: "Название профиля", cell: profile ? plain(profile.name) : localized("Сохранённого профиля нет.") }];
  for (const name of ["latitude", "longitude"] as const) {
    const value = profile?.geolocation[name];
    rows.push({ label: PROFILE_FIELD_LABELS[name], cell: value === undefined ? localized("Значение браузера") : plain(String(value)) });
  }
  rows.push(
    { label: "Языки", cell: profile?.languages ? plain(profile.languages.join(", ")) : localized("Значение браузера") },
    { label: "Локаль форматов", cell: profile?.locale ? plain(profile.locale) : localized("Значение браузера") },
    { label: "Часовой пояс", cell: profile?.timeZone ? plain(profile.timeZone) : localized("Значение браузера") },
    { label: "Карта раскладки", cell: profile ? localized(keyboardLayout(profile.keyboardLayout).label) : plain("—") },
    { label: "Выбор сайтов", cell: localized(config.sitePolicy.mode === "selected_sites" ? "Только выбранные сайты" : "Все сайты с уже выданным доступом") },
    { label: "Выбранные сайты", cell: plain(config.sitePolicy.include.map((rule) => `${rule.schemes.join(" / ")}://${rule.includeSubdomains ? "*." : ""}${rule.host}`).join("\n") || "—") },
    { label: "Исключения сайтов", cell: plain(config.sitePolicy.exclude.map((rule) => `${rule.schemes.join(" / ")}://${rule.includeSubdomains ? "*." : ""}${rule.host}`).join("\n") || "—") },
    { label: "Язык интерфейса", cell: plain(config.ui.language === "en" ? "English" : "Русский") },
    { label: "Тема", cell: localized(config.ui.theme === "system" ? "Как в системе" : config.ui.theme === "light" ? "Светлая" : "Тёмная") }
  );
  return rows;
}
function showCell(element: Element, cell: Cell): void { if (cell.localized) setText(element, cell.value); else setPlainText(element, cell.value); }

export function mountConfigurationTransfer(): void {
  const download = document.querySelector<HTMLButtonElement>("#export-config");
  const file = document.querySelector<HTMLInputElement>("#import-config-file");
  const commit = document.querySelector<HTMLButtonElement>("#import-config-confirm");
  const cancel = document.querySelector<HTMLButtonElement>("#import-config-cancel");
  const preview = document.getElementById("config-preview");
  const rows = document.getElementById("config-change-rows");
  const source = document.getElementById("config-source");
  const hints = document.getElementById("config-preview-hints");
  const unchanged = document.getElementById("config-no-changes");
  const allGrantedNote = document.getElementById("config-all-granted-note");
  const feedback = document.getElementById("config-feedback");
  const draftHint = document.getElementById("config-draft-hint");
  const access = document.getElementById("config-access");
  const accessList = document.getElementById("config-access-list");
  const grant = document.querySelector<HTMLButtonElement>("#grant-config-access");
  if (!download || !file || !commit || !cancel || !preview || !rows || !source || !hints || !unchanged || !allGrantedNote || !feedback || !draftHint || !access || !accessList || !grant) return;
  let ready = false; let busy = false; let importing = false; let profileBlocked = true; let sitesBlocked = false;
  let pending: ConfigurationPreview | null = null; let missingOrigins: string[] = []; let accessSequence = 0;
  const update = (): void => {
    download.disabled = !ready || busy; file.disabled = !ready || busy;
    commit.disabled = !ready || busy || !pending || profileBlocked || sitesBlocked;
    cancel.disabled = busy; grant.disabled = !ready || busy || !missingOrigins.length;
    draftHint.hidden = !profileBlocked && !sitesBlocked;
    for (const id of ["profile-form", "site-form", "site-mode-form"]) { const element = document.getElementById(id); if (element) element.inert = importing; }
    const controls = document.getElementById("control-title")?.closest("section"); if (controls) controls.inert = importing;
  };
  const clearPreview = (): void => { pending = null; preview.hidden = true; file.value = ""; setPlainText(rows, ""); setPlainText(hints, ""); update(); };
  const showPreview = (value: ConfigurationPreview): void => {
    pending = value; preview.hidden = false; setPlainText(rows, ""); setPlainText(hints, "");
    setText(source, value.kind === "profile" ? "Старый файл профиля. Версия oboro неизвестна; сайты, язык и тема сохранятся."
      : "Файл oboro {0}, формат {1}. Будут заменены сохранённые настройки.", value.sourceOboroVersion ?? "", value.sourceSchemaVersion);
    const previous = configurationRows(value.current), incoming = configurationRows(value.proposed);
    let count = 0;
    for (const [index, row] of incoming.entries()) {
      const before = previous[index]!;
      if (JSON.stringify(before.cell) === JSON.stringify(row.cell)) continue;
      count++;
      const tr = document.createElement("tr"), label = document.createElement("th"), oldValue = document.createElement("td"), newValue = document.createElement("td");
      label.scope = "row"; setText(label, row.label); showCell(oldValue, before.cell); showCell(newValue, row.cell); tr.append(label, oldValue, newValue); rows.append(tr);
    }
    unchanged.hidden = count !== 0;
    allGrantedNote.hidden = value.proposed.sitePolicy.mode !== "all_granted_sites";
    for (const origin of value.permissionHints.origins) { const item = document.createElement("li"); setPlainText(item, origin); hints.append(item); }
    const legacy = value.sourceSchemaVersion < 3 && value.proposed.profile !== null;
    if (legacy) {
      const item = document.createElement("li");
      setText(item, "Файл старого формата. Из геопараметров импортируются только широта и долгота; остальные настройки геолокации удалены."); hints.append(item);
    }
    hints.hidden = value.permissionHints.origins.length === 0 && !legacy;
    update();
  };
  const refreshAccess = async (): Promise<void> => {
    const request = ++accessSequence;
    try {
      const value = await controlRequest("config.missingAccess");
      if (request !== accessSequence) return;
      if (!Array.isArray(value) || !value.every((origin) => typeof origin === "string")) throw new Error("Некорректный ответ фонового процесса.");
      missingOrigins = value; access.hidden = !value.length; setPlainText(accessList, "");
      for (const origin of value) { const item = document.createElement("li"); setPlainText(item, origin); accessList.append(item); }
      update();
    } catch {
      if (request === accessSequence) {
        missingOrigins = []; access.hidden = false; setPlainText(accessList, "");
        const error = document.createElement("li"); setText(error, "Не удалось проверить доступы. Откройте настройки заново и проверьте разрешения Chrome."); accessList.append(error); grant.disabled = true;
      }
    }
  };
  const perform = async (action: () => Promise<void>, isImport = false): Promise<void> => {
    if (busy) return;
    busy = true; importing = isImport; update(); setText(feedback, "Выполняется…"); delete feedback.dataset.kind;
    try { await action(); }
    catch (error) { setText(feedback, error instanceof Error ? error.message : String(error)); feedback.dataset.kind = "error"; if (isImport) clearPreview(); }
    finally { busy = false; importing = false; update(); }
  };
  download.addEventListener("click", () => { void perform(async () => {
    await restoreUiPreferences();
    const config = await controlRequest("config.export", { ui: currentUiPreferences() }) as ConfigurationFile;
    const blob = new Blob([serializeConfiguration(config)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    try { const anchor = document.createElement("a"); anchor.href = url; anchor.download = `oboro-config-${config.oboroVersion}.json`; anchor.click(); }
    finally { window.setTimeout(() => URL.revokeObjectURL(url), 10_000); }
    setText(feedback, "Сохранённая конфигурация передана браузеру для скачивания. Несохранённые правки не включены.");
  }); });
  file.addEventListener("change", () => {
    const selected = file.files?.[0]; if (!selected) return;
    void perform(async () => {
      pending = null; preview.hidden = true;
      if (selected.size > MAX_CONFIG_BYTES) throw new Error("Конфигурация слишком велика: максимум 1 МиБ.");
      const text = await selected.text();
      const result = await controlRequest("config.preview", { text, ui: currentUiPreferences() }) as ConfigurationPreview;
      showPreview(result); setText(feedback, "Проверьте изменения перед импортом. Данные ещё не изменены.");
    });
  });
  cancel.addEventListener("click", () => { clearPreview(); setText(feedback, "Импорт отменён. Настройки не изменены."); });
  commit.addEventListener("click", () => {
    if (!pending || profileBlocked || sitesBlocked) return;
    const previewId = pending.id;
    void perform(async () => {
      await controlRequest("config.import", { previewId }) as ConfigurationImportResult;
      let uiSaved: boolean | null = null;
      try { uiSaved = await restoreUiPreferences(); } catch { /* The worker has already verified the saved configuration. */ }
      clearPreview();
      setText(feedback, uiSaved === null ? "Конфигурация восстановлена, подмены выключены. Не удалось восстановить интерфейс в этом окне; откройте настройки заново."
        : uiSaved ? "Конфигурация восстановлена. Подмены выключены. Проверьте доступы и отдельно примените профиль; ранее обработанные страницы требуют перезагрузки."
          : "Конфигурация восстановлена, подмены выключены. Язык и тема применены для этого окна; не удалось сохранить выбор интерфейса.");
      await refreshAccess();
    }, true);
  });
  grant.addEventListener("click", () => {
    if (busy || !missingOrigins.length) return;
    // Preserve the user gesture: request before the first await/RPC.
    const request = chrome.permissions.request({ origins: [...missingOrigins] });
    void perform(async () => {
      const allowed = await request;
      setText(feedback, allowed ? "Доступы выданы. Примените профиль отдельно." : "Доступы не выданы. Конфигурация сохранена, подмены не включены.");
      await refreshAccess();
    });
  });
  window.addEventListener(PROFILE_DRAFT_EVENT, (event) => { profileBlocked = (event as CustomEvent<ProfileDraftState>).detail.blocked; update(); });
  window.addEventListener(SITE_DRAFT_EVENT, (event) => { sitesBlocked = (event as CustomEvent<{ blocked: boolean }>).detail.blocked; update(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.sitePolicy || changes[CONFIG_PERMISSION_HINTS_KEY])) void refreshAccess(); });
  chrome.permissions.onAdded.addListener(() => { void refreshAccess(); });
  chrome.permissions.onRemoved.addListener(() => { void refreshAccess(); });
  void mountUiPreferences().then((saved) => { ready = true; update(); if (!saved) setText(feedback, "Не удалось полностью восстановить настройки интерфейса. Проверьте язык и тему."); void refreshAccess(); });
  update();
}
