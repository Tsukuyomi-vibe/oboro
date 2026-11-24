import { setText, setPlainText } from "./i18n";
import { controlRequest } from "../control/client";
import type { ActivationState } from "../activation/coordinator";
import type { FrameRecord } from "../activation/frames";
import { PROFILE_DRAFT_EVENT, type ProfileDraftState } from "./profile-events";
import { renderDocumentCoverage } from "./diagnostics";

const LABELS: Record<ActivationState["status"], string> = { OFF: "Выключено", PREPARING: "Применение…", READY: "Применено к документам", LIMITED: "Ограничено", ERROR: "Ошибка", NEEDS_RELOAD: "Нужна перезагрузка", OUT_OF_SCOPE: "Вне области действия" };
interface View { activation: ActivationState; frames: FrameRecord[]; hasProfile: boolean; savedProfile: { name: string; revision: number } | null; activeProfile: { name: string; revision: number } | null; capabilities: unknown; proofLoaded: boolean; currentSite: { selection: string; granted: boolean; origin: string | null } | null; }

export function mountActivationControls(): void {
  const toggle = document.querySelector<HTMLInputElement>("#master-enabled");
  const label = document.getElementById("master-label");
  const status = document.getElementById("status-label");
  const details = document.getElementById("activation-details");
  const feedback = document.getElementById("feedback");
  const version = document.getElementById("version");
  if (!toggle || !label || !status || !details || !feedback || !version) throw new Error("Отсутствуют элементы управления применением.");
  setPlainText(version, chrome.runtime.getManifest().version);
  const apply = document.querySelector<HTMLButtonElement>("#apply-profile");
  const inspect = document.querySelector<HTMLButtonElement>("#inspect-capabilities");
  const proof = document.querySelector<HTMLInputElement>("#capability-report");
  const diagnostic = document.getElementById("activation-diagnostics");
  const reloads = document.getElementById("reload-tabs");
  const active = document.getElementById("active-profile");
  const cleanup = document.querySelector<HTMLButtonElement>("#retry-cleanup");
  let busy = false; let available = false; let requestVersion = 0; let draftBlocked = false; let hasProfile = false;
  const updateControls = (): void => {
    toggle.disabled = busy || !available || !toggle.checked && (draftBlocked || !hasProfile);
    if (apply) apply.disabled = busy || !available || draftBlocked || !hasProfile;
    if (cleanup) cleanup.disabled = busy || !available;
  };

  const refresh = async (): Promise<void> => {
    const request = ++requestVersion;
    try {
      const raw = await controlRequest("activation.state");
      const data = raw as View;
      if (!data?.activation || !Object.hasOwn(LABELS, data.activation.status) || !Array.isArray(data.activation.reasons) || !Array.isArray(data.frames)) throw new Error("Некорректный статус применения.");
      if (request !== requestVersion) return;
      available = true;
      hasProfile = data.hasProfile;
      toggle.checked = data.activation.enabled;
      updateControls();
      setText(label, data.activation.enabled ? "Включён" : "Выключен");
      setText(status, !data.hasProfile && data.activation.status === "OFF" ? "Не настроено" : LABELS[data.activation.status]);
      status.closest(".status")?.setAttribute("data-state", data.activation.status);
      setText(details, data.activation.reasons.length ? data.activation.reasons.slice(0, document.body.classList.contains("popup") ? 2 : undefined).join("\n") : "Профиль применяется только к выбранным адресам с выданным доступом. Date, Intl и доступный Temporal.Now используют часовой пояс профиля по умолчанию. Явные зоны сохраняются.");
      if (active) {
        if (data.activeProfile) setText(active, "Активная конфигурация: «{0}», версия {1}.", data.activeProfile.name, data.activeProfile.revision);
        else if (data.savedProfile) setText(active, data.activation.status === "NEEDS_RELOAD"
          ? "Сохранён профиль «{0}», версия {1}. Активной конфигурации нет. Старые документы требуют перезагрузки."
          : "Сохранён профиль «{0}», версия {1}. Активной конфигурации нет.", data.savedProfile.name, data.savedProfile.revision);
        else setText(active, "Сохранённого профиля нет.");
      }
      if (document.body.classList.contains("popup") && data.hasProfile && data.currentSite) {
        if (data.currentSite.selection !== "selected") {
          setText(status, data.currentSite.selection === "excluded" ? "Сайт исключён" : "Вне области действия");
          setText(details, "Подмена API для этого документа не выбрана. Общий выключатель управляет всеми выбранными сайтами.");
        } else if (!data.currentSite.granted) {
          setText(status, "Нужен доступ"); setText(details, "Сайт выбран, но Chrome ещё не выдал необходимый доступ.");
        }
      }
      if (diagnostic) setPlainText(diagnostic, JSON.stringify(data, null, 2));
      renderDocumentCoverage(data.frames, data.activation);
      if (cleanup) cleanup.hidden = data.activation.status !== "ERROR";
      if (reloads) {
        reloads.replaceChildren();
        const tabs = new Set([...data.activation.reloadTabs, ...data.frames.filter((frame) => frame.status === "NEEDS_RELOAD").map((frame) => frame.tabId)]);
        for (const tabId of tabs) {
          const button = document.createElement("button"); button.type = "button";
          setText(button, "Перезагрузить вкладку {0}", data.frames.find((frame) => frame.tabId === tabId && frame.frameId === 0)?.origin ?? tabId);
          button.addEventListener("click", () => { void perform("activation.reloadTab", { tabId }); }); reloads.append(button);
        }
      }
    } catch (error) {
      if (request !== requestVersion) return;
      available = false; updateControls(); setText(status, "Ошибка чтения");
      setText(details, error instanceof Error ? error.message : String(error));
    }
  };
  const perform = async (operation: string, fields: Record<string, unknown> = {}): Promise<void> => {
    if (busy) return;
    if (operation === "activation.apply" && draftBlocked) { setText(feedback, "Сохраните профиль или загрузите сохранённые значения перед применением."); await refresh(); return; }
    busy = true; updateControls();
    setText(feedback, "Выполняется…");
    try {
      const result = await controlRequest(operation, fields);
      if (operation === "activation.inspect") setPlainText(feedback, JSON.stringify(result, null, 2));
      else setText(feedback, operation === "capability.import" ? "Отчёт Chrome принят. Примените профиль." : "Команда завершена; результат показан в состоянии расширения.");
      await refresh();
    } catch (error) { setText(feedback, error instanceof Error ? error.message : String(error)); await refresh(); }
    finally { busy = false; updateControls(); }
  };
  window.addEventListener(PROFILE_DRAFT_EVENT, (event) => {
    const detail = (event as CustomEvent<ProfileDraftState>).detail;
    if (typeof detail?.blocked === "boolean") { draftBlocked = detail.blocked; updateControls(); }
  });
  toggle.addEventListener("change", () => { void perform(toggle.checked ? "activation.apply" : "activation.disable"); });
  apply?.addEventListener("click", () => { void perform("activation.apply"); });
  inspect?.addEventListener("click", () => { void perform("activation.inspect"); });
  cleanup?.addEventListener("click", () => { void perform("activation.disable"); });
  proof?.addEventListener("change", () => {
    const file = proof.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) { setText(feedback, "Отчёт слишком велик: максимум 1,5 МБ."); return; }
    void file.text().then((text) => perform("capability.import", { report: JSON.parse(text) })).catch(() => { setText(feedback, "Не удалось прочитать JSON-отчёт."); });
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && (changes.activationState || changes.regionalProfile)) void refresh(); });
  window.setInterval(() => { if (!busy && document.visibilityState === "visible") void refresh(); }, 1500);
  void refresh();
}
