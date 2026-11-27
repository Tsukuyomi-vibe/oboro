import { setText, setPlainText } from "./i18n";
import { loadProfile } from "../profile/client";
import { PROFILE_STORAGE_KEY } from "../profile/types";
import { keyboardLayout } from "../keyboard/layouts";

export function mountProfileSummary(): void {
  const title = document.getElementById("profile-title");
  const description = document.getElementById("profile-description");
  const summary = document.getElementById("profile-summary");
  if (!title || !description || !summary) throw new Error("Не найден блок регионального профиля.");
  let requestVersion = 0;

  const refresh = async (): Promise<void> => {
    const version = ++requestVersion;
    try {
      const profile = await loadProfile();
      if (version !== requestVersion) return;
      summary.replaceChildren();
      delete description.dataset.kind;
      summary.hidden = profile === null;
      if (!profile) {
        setText(title, "Профиль ещё не сохранён");
        setText(description, "Заполните форму ниже или подставьте пример. До сохранения и применения подмены не включаются.");
        return;
      }
      setPlainText(title, profile.name);
      setText(description, "Сохранённая версия: {0}. Изменения вступают в силу после применения и перезагрузки выбранных страниц.", profile.revision);
      const native = "Значение браузера";
      const rows = [
        ["Языки", profile.languages?.join(", ") ?? native], ["Форматы", profile.locale ?? native], ["Часовой пояс", profile.timeZone ?? native],
        ...(["latitude", "longitude", "accuracy", "altitude", "altitudeAccuracy", "speed", "heading"] as const).map((key, index) => {
          const value = profile.geolocation[key];
          return [["Широта", "Долгота", "Точность", "Высота", "Точность высоты", "Скорость", "Направление"][index]!, value === undefined ? native : value === null ? "Неизвестно" : String(value)];
        }),
        ["Карта раскладки", keyboardLayout(profile.keyboardLayout).label]
      ];
      for (const [label, value] of rows) {
        const term = document.createElement("dt");
        const detail = document.createElement("dd");
        setText(term, label!);
        if (value === native || value === "Неизвестно" || label === "Карта раскладки") setText(detail, value!);
        else setPlainText(detail, value!);
        summary.append(term, detail);
      }
    } catch {
      if (version !== requestVersion) return;
      setText(title, "Не удалось прочитать профиль");
      setText(description, "Откройте настройки ещё раз. Сохранённые данные оставлены без изменений.");
      description.dataset.kind = "error";
      summary.hidden = true;
      summary.replaceChildren();
    }
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PROFILE_STORAGE_KEY] !== undefined) void refresh();
  });
  window.addEventListener("pageshow", () => { void refresh(); });
  void refresh();
}
