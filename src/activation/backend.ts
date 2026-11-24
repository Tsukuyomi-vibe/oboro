import { BRIDGE_SCRIPT_ID, FRAME_CHANNEL, MAIN_SCRIPT_ID, type RuntimeSnapshot } from "../runtime/types";
import { compileActivation, ownsNetworkRule } from "../runtime/compiler";
import { resolveSite } from "../sites/policy";
import type { FrameRegistry } from "./frames";

export type ActivationPlan = ReturnType<typeof compileActivation>;
export interface OwnedInstallation {
  main: chrome.userScripts.RegisteredUserScript[];
  bridge: chrome.scripting.RegisteredContentScript[];
  rules: chrome.declarativeNetRequest.Rule[];
}
export interface ActivationBackend {
  readOwned(): Promise<OwnedInstallation>;
  install(plan: ActivationPlan): Promise<void>;
  restore(previous: OwnedInstallation): Promise<void>;
  clear(): Promise<void>;
  registrationsMatch(plan: ActivationPlan): Promise<boolean>;
  reloadSelected(snapshot: RuntimeSnapshot): Promise<{ targets: number[]; manualTabs: number[]; reasons: string[] }>;
  waitForDocuments(snapshot: RuntimeSnapshot, targets: readonly number[]): Promise<ReturnType<FrameRegistry["verification"]>>;
  resync?(snapshot: RuntimeSnapshot): Promise<number[]>;
}
function sameSet(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean { return JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort()); }

export class ChromeActivationBackend implements ActivationBackend {
  constructor(private readonly frames: FrameRegistry) {}
  async readOwned(): Promise<OwnedInstallation> {
    const [main, bridge, rules] = await Promise.all([
      chrome.userScripts.getScripts({ ids: [MAIN_SCRIPT_ID] }),
      chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_SCRIPT_ID] }),
      chrome.declarativeNetRequest.getDynamicRules()
    ]);
    return { main, bridge, rules: rules.filter((rule) => ownsNetworkRule(rule.id)) };
  }
  private async replace(next: OwnedInstallation): Promise<void> {
    const current = await this.readOwned();
    if (current.main.length) await chrome.userScripts.unregister({ ids: [MAIN_SCRIPT_ID] });
    if (next.main.length) await chrome.userScripts.register(next.main);
    if (current.bridge.length) await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] });
    if (next.bridge.length) await chrome.scripting.registerContentScripts(next.bridge);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: current.rules.map((entry) => entry.id), addRules: next.rules });
  }
  install(plan: ActivationPlan): Promise<void> { return this.replace({ main: plan.mainScript ? [plan.mainScript] : [], bridge: plan.bridgeScript ? [plan.bridgeScript] : [], rules: plan.networkRules }); }
  restore(previous: OwnedInstallation): Promise<void> { return this.replace(previous); }
  async clear(): Promise<void> {
    const results = await Promise.allSettled([
      (async () => { const scripts = await chrome.userScripts.getScripts({ ids: [MAIN_SCRIPT_ID] }); if (scripts.length) await chrome.userScripts.unregister({ ids: [MAIN_SCRIPT_ID] }); })(),
      (async () => { const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_SCRIPT_ID] }); if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_SCRIPT_ID] }); })(),
      (async () => { const rules = await chrome.declarativeNetRequest.getDynamicRules(); await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.filter((entry) => ownsNetworkRule(entry.id)).map((entry) => entry.id) }); })()
    ]);
    const errors = results.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
    if (errors.length) throw new Error(`Очистка не подтверждена полностью: ${errors.join("; ")}`);
    const remaining = await this.readOwned();
    if (remaining.main.length || remaining.bridge.length || remaining.rules.length) throw new Error("После очистки остались собственные регистрации или правила.");
  }
  async registrationsMatch(plan: ActivationPlan): Promise<boolean> {
    const current = await this.readOwned();
    const main = current.main[0]; const bridge = current.bridge[0];
    if (current.main.length !== (plan.mainScript ? 1 : 0) || current.bridge.length !== (plan.bridgeScript ? 1 : 0) || current.rules.length !== plan.networkRules.length) return false;
    if (plan.mainScript && (!main || main.world !== "MAIN" || main.runAt !== "document_start" || main.allFrames !== true || !sameSet(main.matches, plan.mainScript.matches) || !sameSet(main.excludeMatches, plan.mainScript.excludeMatches) || main.js?.[0]?.code !== plan.mainScript.js?.[0]?.code)) return false;
    if (plan.bridgeScript && (!bridge || bridge.world !== "ISOLATED" || bridge.runAt !== "document_start" || bridge.allFrames !== true || !sameSet(bridge.matches, plan.bridgeScript.matches) || !sameSet(bridge.excludeMatches, plan.bridgeScript.excludeMatches) || !sameSet(bridge.js, plan.bridgeScript.js))) return false;
    return plan.networkRules.every((rule) => {
      const found = current.rules.find((entry) => entry.id === rule.id);
      if (!found) return false;
      if (found.priority !== rule.priority || found.condition.regexFilter !== rule.condition.regexFilter || !sameSet(found.condition.resourceTypes, rule.condition.resourceTypes) || found.action.type !== rule.action.type || found.action.responseHeaders?.length) return false;
      if (rule.action.type === "allow") return !found.action.requestHeaders?.length;
      const actual = found.action.requestHeaders; const expected = rule.action.requestHeaders;
      return actual?.length === 1 && expected?.length === 1 && actual[0]?.header.toLowerCase() === expected[0]?.header.toLowerCase() && actual[0]?.operation === expected[0]?.operation && actual[0]?.value === expected[0]?.value;
    });
  }
  async reloadSelected(snapshot: RuntimeSnapshot) {
    const targets: number[] = []; const manualTabs: number[] = []; const reasons: string[] = [];
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      let frames: chrome.webNavigation.GetAllFrameResultDetails[] | null;
      try { frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }); }
      catch { if (tab.url && resolveSite(tab.url, snapshot.policy, snapshot.grantedOrigins).selection === "selected") { this.frames.persistenceLimited = true; reasons.push(`Не получены документы вкладки ${tab.id}.`); } continue; }
      const eligible = frames?.filter((frame) => { const selected = resolveSite(frame.url, snapshot.policy, snapshot.grantedOrigins); return selected.selection === "selected" && selected.granted; }) ?? [];
      if (!eligible.length) continue;
      for (const frame of [...(frames ?? [])].sort((a, b) => a.frameId - b.frameId)) {
        this.frames.observe({ ...frame, tabId: tab.id, documentId: frame.documentId ?? `unconfirmed-${frame.frameId}` }, snapshot, true);
      }
      if (eligible.some((frame) => frame.frameId === 0)) {
        targets.push(tab.id);
        await chrome.tabs.reload(tab.id);
      } else {
        manualTabs.push(tab.id);
        reasons.push("Выбранный iframe на другом сайте ожидает ручной перезагрузки страницы.");
      }
    }
    return { targets, manualTabs, reasons };
  }
  async waitForDocuments(snapshot: RuntimeSnapshot, targets: readonly number[]) {
    const deadline = Date.now() + 2500;
    let result = this.frames.verification(snapshot, targets);
    while (!result.complete && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 75));
      result = this.frames.verification(snapshot, targets);
    }
    return result;
  }
  async resync(snapshot: RuntimeSnapshot): Promise<number[]> {
    const targets: number[] = [];
    const tabs = await chrome.tabs.query({});
    this.frames.reconcileTabs(tabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]));
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }) ?? [];
        if (!this.frames.hasTab(tab.id) && !frames.some((frame) => { const scope = resolveSite(frame.url, snapshot.policy, snapshot.grantedOrigins); return scope.selection === "selected" && scope.granted; })) continue;
        for (const frame of [...frames].sort((a, b) => a.frameId - b.frameId)) this.frames.observe({ ...frame, tabId: tab.id, documentId: frame.documentId ?? `unconfirmed-${frame.frameId}` }, snapshot, true, "resync");
        this.frames.reconcileTabFrames(tab.id, frames.flatMap((frame) => frame.documentId ? [frame.documentId] : []));
        const root = frames.find((frame) => frame.frameId === 0);
        if (root && resolveSite(root.url, snapshot.policy, snapshot.grantedOrigins).selection === "selected") targets.push(tab.id);
        if (root?.documentId && tab.status === "complete") this.frames.complete(tab.id, root.documentId);
        await chrome.tabs.sendMessage(tab.id, { channel: FRAME_CHANNEL, operation: "ping" }).catch(() => undefined);
      } catch { this.frames.persistenceLimited = true; }
    }
    return targets;
  }
}
