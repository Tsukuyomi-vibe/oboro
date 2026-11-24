import { PROFILE_CHANNEL, type ProfileErrorDetail, type ProfileResponse } from "./protocol";
import { ProfileRepositoryError, ProfileRevisionConflict, type ProfileRepository } from "./repository";
import { ProfileValidationError } from "./types";
import { validateExpectedRevision } from "./validation";

const UI_PATHS = new Set(["/popup/popup.html", "/options/options.html"]);

export function isTrustedProfileUi(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  if (sender.origin !== undefined && sender.origin !== `chrome-extension://${extensionId}`) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "chrome-extension:" && url.host === extensionId && !url.username && !url.password && UI_PATHS.has(url.pathname);
  } catch { return false; }
}

function errorResponse(error: unknown): ProfileResponse {
  let detail: ProfileErrorDetail;
  if (error instanceof ProfileValidationError) {
    detail = { code: "VALIDATION_ERROR", message: error.message, issues: error.issues };
  } else if (error instanceof ProfileRevisionConflict) {
    detail = { code: error.code, message: error.message, expectedRevision: error.expectedRevision, actualRevision: error.actualRevision };
  } else if (error instanceof ProfileRepositoryError) {
    detail = { code: error.code, message: error.message };
  } else {
    detail = { code: "INTERNAL_ERROR", message: "Не удалось обработать запрос профиля." };
  }
  return { ok: false, error: detail };
}

export function createProfileMessageListener(repository: ProfileRepository, extensionId: string, execute: <T>(action: () => Promise<T>) => Promise<T> = (action) => action()) {
  return (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: ProfileResponse) => void): boolean => {
    if (typeof message !== "object" || message === null || !("channel" in message) || message.channel !== PROFILE_CHANNEL) return false;
    if (!isTrustedProfileUi(sender, extensionId)) {
      sendResponse({ ok: false, error: { code: "FORBIDDEN", message: "Профиль доступен только интерфейсу этого расширения." } });
      return false;
    }
    const input = message as Record<string, unknown>;
    const respond = (response: ProfileResponse): void => {
      // The popup may close while storage finishes; that does not undo a completed save.
      try { sendResponse(response); } catch { /* The next load will read persisted state. */ }
    };
    const handle = async (): Promise<ProfileResponse> => {
      if (input.operation === "load" && Object.keys(input).every((key) => ["channel", "operation"].includes(key))) {
        return { ok: true, profile: await repository.load() };
      }
      if (input.operation === "save" && Object.keys(input).every((key) => ["channel", "operation", "draft", "expectedRevision"].includes(key))) {
        const expected = validateExpectedRevision(input.expectedRevision);
        return { ok: true, profile: await repository.save(input.draft, expected) };
      }
      return { ok: false, error: { code: "INVALID_REQUEST", message: "Неизвестная операция или поля запроса профиля." } };
    };
    void execute(handle).then(respond, (error: unknown) => respond(errorResponse(error)));
    // Chrome 120 compatibility: keep the response channel open with a literal true.
    return true;
  };
}
