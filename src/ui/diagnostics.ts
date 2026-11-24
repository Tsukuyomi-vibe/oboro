import { setText, setPlainText } from "./i18n";
import type { FrameRecord } from "../activation/frames";
import type { ActivationState } from "../activation/coordinator";

const STATUS: Record<FrameRecord["status"], string> = {
  PENDING: "Нет подтверждения", INSTALLED: "Установлено в документе", NEEDS_RELOAD: "Нужна перезагрузка", OUT_OF_SCOPE: "Вне области действия", UNSUPPORTED: "Не поддержано", LIMITED: "Покрытие ограничено"
};
const LIFECYCLE: Record<FrameRecord["lifecycle"], string> = { active: "Активный", cached: "BFCache", unconfirmed: "Неактивный; кэш не подтверждён", prerender: "Пререндер" };
function moduleLabel(value: string | null | undefined): string {
  return value === "installed" ? "Установлен" : value === "native" ? "Системный, подмена не запрошена" : value === "absent" ? "API отсутствует" : value === "unsupported" ? "Не поддержан" : value === "error" ? "Ошибка" : value === "partial" ? "Частично" : "Нет подтверждения";
}
export function renderDocumentCoverage(frames: readonly FrameRecord[], activation: ActivationState): void {
  const container = document.getElementById("document-coverage");
  const recovery = document.getElementById("recovery-state");
  if (recovery) setText(recovery, activation.phase !== "idle" ? "Применение ещё не завершено: ожидается подтверждение документов или завершение очистки."
    : activation.recovery === "rebuilt" ? "Регистрации пересобраны после обновления; проверяйте версии открытых документов."
      : activation.recovery === "rolled_back" ? "Восстановлена предыдущая конфигурация; нужны проверка и перезагрузка." : "");
  if (!container) return;
  const digest = JSON.stringify(frames);
  if (container.dataset.snapshot === digest) return;
  container.dataset.snapshot = digest; setPlainText(container, "");
  if (!frames.length) { setText(container, "Наблюдавшихся документов нет. Это не подтверждает покрытие всех вкладок и контекстов."); return; }
  for (const frame of frames) {
    const card = document.createElement("article"); card.className = "document-card"; card.dataset.state = frame.status;
    const title = document.createElement("h3"); setText(title, "{0} · вкладка {1}, фрейм {2}", frame.origin, frame.tabId, frame.frameId);
    const status = document.createElement("p"); status.className = "document-status"; setText(status, (frame.lifecycle === "active" ? "" : "Последний снимок: ") + (STATUS[frame.status] ?? "Неизвестно"));
    const identity = document.createElement("p"); identity.className = "help"; setText(identity, "Документ " + frame.documentId + " · " + (LIFECYCLE[frame.lifecycle] ?? "Неизвестный lifecycle") + " · " + frame.lastEvent);
    const revisions = document.createElement("p"); revisions.className = "help";
    setText(revisions, "Профиль: " + (frame.profileRevision ?? "не подтверждён") + "; ожидается " + (frame.expectedProfileRevision ?? "—") + ". Политика: " + (frame.policyRevision ?? "не подтверждена") + "; ожидается " + (frame.expectedPolicyRevision ?? "—") + ".");
    const modules = document.createElement("dl"); modules.className = "module-coverage";
    for (const [label, value] of [["Языки", frame.languages], ["Геолокация", frame.geolocation], ["Форматы", frame.locale], ["Время", frame.time], ["Temporal", frame.temporal], ["Карта раскладки", frame.keyboard]]) {
      const term = document.createElement("dt"); setText(term, label!);
      const detail = document.createElement("dd"); setText(detail, moduleLabel(value)); detail.dataset.state = value ?? "unknown";
      modules.append(term, detail);
    }
    card.append(title, status, identity, revisions, modules);
    const reasons = document.createElement("ul"); reasons.className = "document-reasons";
    for (const reason of frame.reasons ?? []) { const item = document.createElement("li"); setText(item, reason); reasons.append(item); }
    if (frame.lifecycle === "cached" || frame.lifecycle === "unconfirmed") {
      const item = document.createElement("li"); setText(item, "Снимок неактивного документа не подтверждает новую версию. Для удаления прежних обёрток вернитесь к нему и перезагрузите либо закройте вкладку."); reasons.append(item);
    }
    if (reasons.childNodes.length) card.append(reasons);
    container.append(card);
  }
}
