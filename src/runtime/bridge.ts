import { FRAME_CHANNEL, PAGE_QUERY, PAGE_REPORT } from "./types";
import { readPageRuntimeReport } from "./report";

// Diagnostics only: no settings, cookies, permissions or executable payloads.
let lastReport: unknown = null;
const send = (event = "report", persisted = false): void => {
  void chrome.runtime.sendMessage({ channel: FRAME_CHANNEL, operation: "context", event, persisted }).catch(() => undefined);
  if (lastReport !== null) void chrome.runtime.sendMessage({ channel: FRAME_CHANNEL, report: lastReport }).catch(() => undefined);
};
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || typeof event.data !== "object" || event.data === null || !("type" in event.data) || event.data.type !== PAGE_REPORT || !("report" in event.data)) return;
  const normalized = readPageRuntimeReport(event.data.report);
  if (!normalized) return;
  lastReport = normalized;
  void chrome.runtime.sendMessage({ channel: FRAME_CHANNEL, report: lastReport }).catch(() => undefined);
});
send("initial");
window.postMessage({ type: PAGE_QUERY }, "*");
window.addEventListener("pageshow", (event: PageTransitionEvent) => {
  if (!event.isTrusted) return;
  send("pageshow", event.persisted); window.postMessage({ type: PAGE_QUERY }, "*");
});
window.addEventListener("pagehide", (event: PageTransitionEvent) => {
  if (event.isTrusted) void chrome.runtime.sendMessage({ channel: FRAME_CHANNEL, operation: "context", event: "pagehide", persisted: event.persisted }).catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (sender.id === chrome.runtime.id && typeof message === "object" && message !== null && "channel" in message && message.channel === FRAME_CHANNEL && "operation" in message && message.operation === "ping") {
    send("ping"); window.postMessage({ type: PAGE_QUERY }, "*");
  }
  return false;
});
