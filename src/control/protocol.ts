import { isTrustedProfileUi } from "../profile/messages";

export const CONTROL_CHANNEL = "regional-control:v1";
export type ControlHandler = (input: Record<string, unknown>) => Promise<unknown>;
export function createControlListener(handlers: Record<string, ControlHandler>, extensionId: string) {
  return (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void): boolean => {
    if (typeof message !== "object" || message === null || !("channel" in message) || message.channel !== CONTROL_CHANNEL) return false;
    if (!isTrustedProfileUi(sender, extensionId)) { sendResponse({ ok: false, error: { code: "FORBIDDEN", message: "Команда доступна только интерфейсу расширения." } }); return false; }
    const input = message as Record<string, unknown>;
    const handler = typeof input.operation === "string" && Object.hasOwn(handlers, input.operation) ? handlers[input.operation] : undefined;
    const respond = (value: unknown): void => { try { sendResponse(value); } catch { /* Closed UI. */ } };
    if (!handler) { respond({ ok: false, error: { code: "INVALID_REQUEST", message: "Неизвестная команда." } }); return false; }
    void Promise.resolve().then(() => handler(input)).then((result) => respond({ ok: true, result }), (error: unknown) => {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "CONTROL_ERROR";
      respond({ ok: false, error: { code, message: error instanceof Error ? error.message : "Не удалось выполнить команду." } });
    });
    return true;
  };
}
