import { setText } from "./i18n";
export function mountOptionsButton(): void {
  const button = document.querySelector<HTMLButtonElement>("#open-options");
  const feedback = document.getElementById("feedback");
  if (!button || !feedback) throw new Error("Не найдены элементы открытия настроек.");
  button.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage().catch(() => {
      setText(feedback, "Не удалось открыть настройки. Откройте их через меню расширений Chrome.");
      feedback.dataset.kind = "error";
    });
  });
}
