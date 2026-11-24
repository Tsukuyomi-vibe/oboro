import { controlRequest } from "../control/client";
import { CONFIG_UI_RESTORE_KEY, UI_RESTORE_EVENT, type UiPreferences } from "../config/types";
import { parseUiRestore } from "../config/format";

const ACK_KEY = "oboro.configImportId";
let mounted: Promise<boolean> | undefined;
let appliedToken: string | undefined;
let appliedSaved = false;

export function currentUiPreferences(): UiPreferences {
  const theme = document.documentElement.dataset.themePreference;
  return { language: document.documentElement.lang === "ru" ? "ru" : "en", theme: theme === "light" || theme === "dark" ? theme : "system" };
}

/** A durable worker record is consumed once per extension origin. Normal UI
 * changes after import remain authoritative in the existing localStorage. */
export async function restoreUiPreferences(): Promise<boolean> {
  const record = parseUiRestore(await controlRequest("config.uiRestore"));
  if (!record) return true;
  if (record.token === appliedToken) return appliedSaved;
  let saved = false;
  try {
    const storage = window.localStorage;
    if (storage.getItem(ACK_KEY) === record.token) {
      const theme = storage.getItem("oboro.theme");
      window.dispatchEvent(new CustomEvent(UI_RESTORE_EVENT, { detail: {
        language: storage.getItem("oboro.language") === "ru" ? "ru" : "en", theme: theme === "light" || theme === "dark" ? theme : "system"
      } }));
      appliedToken = record.token; appliedSaved = true;
      return true;
    }
    storage.setItem("oboro.language", record.ui.language);
    storage.setItem("oboro.theme", record.ui.theme);
    storage.setItem(ACK_KEY, record.token);
    saved = true;
  } catch { /* Apply in this window and leave the record unacknowledged to retry. */ }
  window.dispatchEvent(new CustomEvent(UI_RESTORE_EVENT, { detail: record.ui }));
  appliedToken = record.token; appliedSaved = saved;
  return saved;
}

export function mountUiPreferences(): Promise<boolean> {
  if (mounted) return mounted;
  let sequence = 0;
  const refresh = async (): Promise<boolean> => {
    const request = ++sequence;
    try {
      const saved = await restoreUiPreferences();
      if (request === sequence) window.dispatchEvent(new CustomEvent("oboro:ui-restored", { detail: { saved } }));
      return saved;
    } catch { return false; }
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes[CONFIG_UI_RESTORE_KEY]) void refresh(); });
  mounted = refresh();
  return mounted;
}
