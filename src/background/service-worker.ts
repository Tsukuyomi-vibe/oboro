import { initializePreferences, setMasterEnabled } from "../shared/preferences";
import { ProfileRepository } from "../profile/repository";
import { createProfileMessageListener } from "../profile/messages";
import { validateExpectedRevision } from "../profile/validation";
import { createControlListener, type ControlHandler } from "../control/protocol";
import { ConfigurationQueue } from "../control/queue";
import { SitePolicyRepository } from "../sites/repository";
import { ActivationCoordinator } from "../activation/coordinator";
import { ChromeActivationBackend } from "../activation/backend";
import { FrameRegistry } from "../activation/frames";
import { CAPABILITY_EVIDENCE_KEY, inspectProductCapabilities } from "../activation/capabilities";
import { FRAME_CHANNEL } from "../runtime/types";
import { httpUrl, resolveSite } from "../sites/policy";
import { ConfigurationService } from "../config/service";
import { ConfigurationError } from "../config/types";

const queue = new ConfigurationQueue();
const sessionStorage = chrome.storage.session ?? { get: async () => ({}), set: async () => { throw new Error("Session storage unavailable"); } };
const frames = new FrameRegistry(sessionStorage);
let coordinator: ActivationCoordinator;
const profiles = new ProfileRepository(chrome.storage.local, () => coordinator.invalidate("Региональный профиль изменён. Примените новую версию."));
const sites = new SitePolicyRepository(chrome.storage.local, () => coordinator.invalidate("Список сайтов изменён. Примените новую политику."));
coordinator = new ActivationCoordinator({
  storage: chrome.storage.local, frames, backend: new ChromeActivationBackend(frames),
  loadProfile: () => profiles.load(), loadPolicy: () => sites.load(),
  origins: async () => (await chrome.permissions.getAll()).origins ?? [],
  contains: (origins) => chrome.permissions.contains({ origins }),
  capabilities: inspectProductCapabilities, setEnabled: setMasterEnabled, id: () => crypto.randomUUID(), buildVersion: chrome.runtime.getManifest?.().version ?? "development"
});
const configurations = new ConfigurationService({
  storage: chrome.storage.local, loadProfile: () => profiles.load(), loadPolicy: () => sites.load(), disable: () => coordinator.disable(),
  origins: async () => (await chrome.permissions.getAll()).origins ?? [], contains: (origins) => chrome.permissions.contains({ origins }),
  id: () => crypto.randomUUID(), version: () => chrome.runtime.getManifest().version
});
let bootError: unknown = null;
const boot = queue.run(async () => { await coordinator.initialize(); await configurations.recover(); }).catch((error: unknown) => { bootError = error; });
const execute = <T>(action: () => Promise<T>): Promise<T> => queue.run(async () => {
  await boot;
  if (bootError) throw new Error("Не удалось прочитать состояние расширения. Перезагрузите расширение.");
  await configurations.recover();
  return action();
});
const wrap = (handler: ControlHandler): ControlHandler => (input) => execute(() => handler(input));
const configOperation = (fields: string[], handler: ControlHandler): ControlHandler => wrap((input) => {
  if (Object.keys(input).some((key) => !["channel", "operation", ...fields].includes(key))) throw new ConfigurationError("INVALID_REQUEST", "В конфигурации есть неизвестные поля.");
  return handler(input);
});

chrome.runtime.onMessage.addListener(createProfileMessageListener(profiles, chrome.runtime.id, execute));
chrome.runtime.onMessage.addListener(createControlListener({
  "config.export": configOperation(["ui"], (input) => configurations.export(input.ui)),
  "config.preview": configOperation(["text", "ui"], (input) => configurations.preview(input.text, input.ui)),
  "config.import": configOperation(["previewId"], (input) => configurations.import(input.previewId)),
  "config.uiRestore": configOperation([], () => configurations.uiRestore()),
  "config.missingAccess": configOperation([], () => configurations.missingAccess()),
  "policy.load": wrap(() => sites.load()),
  "policy.save": wrap((message) => sites.save(message.draft, validateExpectedRevision(message.expectedRevision))),
  "activation.apply": wrap(() => coordinator.apply()),
  "activation.disable": wrap(() => coordinator.disable()),
  "capability.import": wrap((message) => coordinator.importEvidence(message.report)),
  "activation.inspect": wrap(inspectProductCapabilities),
  "activation.state": wrap(async () => {
    const capabilities = await inspectProductCapabilities();
    await coordinator.audit();
    const [profile, policy, grants, tabs, evidence] = await Promise.all([profiles.load(), sites.load(), chrome.permissions.getAll(), chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get(CAPABILITY_EVIDENCE_KEY)]);
    const currentUrl = tabs[0]?.url;
    const currentSite = currentUrl ? { ...resolveSite(currentUrl, policy, grants.origins ?? []), origin: httpUrl(currentUrl)?.origin ?? null } : null;
    const active = coordinator.activeSnapshot?.profile;
    return { activation: coordinator.view(), frames: frames.list(), hasProfile: profile !== null,
      savedProfile: profile ? { name: profile.name, revision: profile.revision } : null,
      activeProfile: active ? { name: active.name, revision: active.revision } : null,
      capabilities, currentSite, proofLoaded: Boolean(evidence[CAPABILITY_EVIDENCE_KEY]) };
  }),
  "activation.reloadTab": wrap(async (message) => {
    if (typeof message.tabId !== "number" || !Number.isInteger(message.tabId) || !frames.hasTab(message.tabId)) throw new Error("Вкладка не относится к обрабатываемым документам.");
    await chrome.tabs.reload(message.tabId); return coordinator.view();
  })
}, chrome.runtime.id));

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (typeof message !== "object" || message === null || !("channel" in message) || message.channel !== FRAME_CHANNEL) return false;
  const snapshot = coordinator.activeSnapshot;
  if ("operation" in message && message.operation === "context") {
    const accepted = "event" in message && typeof message.event === "string" && "persisted" in message && typeof message.persisted === "boolean" && frames.context(sender, message.event, message.persisted, snapshot, chrome.runtime.id);
    sendResponse({ recorded: accepted });
    if (accepted) void execute(() => coordinator.refreshCoverage()).catch(() => undefined);
    return false;
  }
  const accepted = snapshot !== null && "report" in message && frames.accept(sender, message.report, snapshot, chrome.runtime.id);
  sendResponse({ recorded: accepted });
  if (accepted) void execute(() => coordinator.refreshCoverage()).catch(() => undefined);
  return false;
});

chrome.webNavigation?.onCommitted.addListener((details) => {
  if (!coordinator.activeSnapshot && !frames.hasTab(details.tabId)) return;
  frames.observe({ ...details, documentId: details.documentId }, coordinator.activeSnapshot);
  void execute(async () => { await coordinator.audit(); await (details.frameId === 0 ? coordinator.rootNavigated(details.tabId, details.url) : coordinator.refreshCoverage()); }).catch(() => undefined);
});
chrome.webNavigation?.onCompleted.addListener((details) => {
  if (details.frameId === 0) frames.complete(details.tabId, details.documentId);
  if (frames.hasTab(details.tabId)) void execute(() => coordinator.refreshCoverage()).catch(() => undefined);
});
chrome.tabs?.onRemoved.addListener((tabId) => {
  if (frames.hasTab(tabId)) void execute(() => coordinator.removeTab(tabId)).catch(() => undefined);
});
for (const [event, label] of [[chrome.webNavigation?.onHistoryStateUpdated, "history"], [chrome.webNavigation?.onReferenceFragmentUpdated, "fragment"]] as const) event?.addListener((details) => {
  if (!coordinator.activeSnapshot && !frames.hasTab(details.tabId)) return;
  frames.observe(details, coordinator.activeSnapshot, false, label);
  void execute(() => coordinator.refreshCoverage()).catch(() => undefined);
});
chrome.webNavigation?.onErrorOccurred?.addListener((details) => {
  frames.navigationError(details.tabId, details.frameId, details.documentId);
  if (frames.hasTab(details.tabId)) void execute(() => coordinator.refreshCoverage()).catch(() => undefined);
});
chrome.webNavigation?.onTabReplaced?.addListener((details) => {
  void execute(async () => {
    await coordinator.removeTab(details.replacedTabId);
    if (coordinator.activeSnapshot) await coordinator.reconcileAfterUpdate();
  }).catch(() => undefined);
});
for (const event of [chrome.permissions?.onAdded, chrome.permissions?.onRemoved]) event?.addListener(() => {
  coordinator.environmentChanged();
  void execute(() => coordinator.invalidate("Доступы Chrome изменились. Примените профиль повторно.")).catch(() => undefined);
});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && (coordinator.activeSnapshot || coordinator.view().phase !== "idle") && (changes.regionalProfile || changes.sitePolicy)) {
    coordinator.environmentChanged();
    void execute(() => coordinator.invalidate("Профиль или политика изменены; требуется повторное применение.")).catch(() => undefined);
  }
});
chrome.runtime.onInstalled.addListener((details) => {
  void initializePreferences().catch(() => undefined);
  if (details?.reason === "update") void execute(() => coordinator.reconcileAfterUpdate()).catch(() => undefined);
});
chrome.runtime.onStartup?.addListener(() => { void boot; });
