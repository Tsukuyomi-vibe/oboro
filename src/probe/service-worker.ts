import { clearProbe } from "./capabilities";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("probe/probe.html") });
});

// Session rules disappear on restart; remove the corresponding marker script too.
function resetProbe(): void {
  void clearProbe().then((result) => chrome.storage.local.set({ i02LastCleanup: result })).catch((error: unknown) => {
    console.warn("Не удалось записать результат очистки диагностической пробы oboro.", error);
  });
}
chrome.runtime.onInstalled.addListener(resetProbe);
chrome.runtime.onStartup.addListener(resetProbe);
