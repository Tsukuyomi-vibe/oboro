import { compileAcceptLanguage } from "../profile/compile";
import { intersectScopes, policyToDraft, ruleOrigins, scopePattern, selectedScopes, type HostScope } from "../sites/policy";
import { BRIDGE_SCRIPT_ID, MAIN_SCRIPT_ID, RUNTIME_IMPLEMENTATION, type RuntimeSnapshot } from "./types";

declare const __REGION_RUNTIME_BUNDLE__: string;
export const RULE_BASE = 1800000;
export const MAX_OWN_RULES = 800;
export function ownsNetworkRule(id: number): boolean { return id >= RULE_BASE && id < RULE_BASE + MAX_OWN_RULES; }
const RESOURCE_TYPES: chrome.declarativeNetRequest.ResourceType[] = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"
] as chrome.declarativeNetRequest.ResourceType[];

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export function scopeRegex(scope: HostScope): string {
  const host = scope.host === "*" ? "(?:\\[[0-9a-fA-F:]+\\]|[^/:@]+)" : `${scope.includeSubdomains ? "(?:[^./:@]+\\.)*" : ""}${escapeRegex(scope.host)}`;
  return `^${scope.scheme}://(?:[^/@]+@)?${host}(?::[0-9]+)?/`;
}
export function compileNetworkRules(snapshot: RuntimeSnapshot): chrome.declarativeNetRequest.Rule[] {
  const included = selectedScopes(snapshot.policy, snapshot.grantedOrigins);
  if (!included.length) return [];
  const exclusions = snapshot.policy.exclude.flatMap((rule) => rule.schemes.map((scheme) => ({ scheme, host: rule.host, includeSubdomains: rule.includeSubdomains })));
  const excludedScopes = exclusions.flatMap((scope) => included.map((target) => intersectScopes(scope, target)).filter((entry): entry is HostScope => entry !== null));
  const excludes = [...new Map(excludedScopes.map((scope) => [scopePattern(scope), scope])).values()];
  const count = included.length + excludes.length;
  if (count > MAX_OWN_RULES) throw new Error("Слишком много пересечений правил и доступов; сократите список сайтов.");
  const header = compileAcceptLanguage(snapshot.profile.languages);
  const rules: chrome.declarativeNetRequest.Rule[] = included.map((scope, index) => ({
    id: RULE_BASE + index, priority: 10,
    action: { type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType, requestHeaders: [{ header: "Accept-Language", operation: "set" as chrome.declarativeNetRequest.HeaderOperation, value: header }] },
    condition: { regexFilter: scopeRegex(scope), resourceTypes: RESOURCE_TYPES }
  }));
  for (const [index, scope] of excludes.entries()) rules.push({
    id: RULE_BASE + included.length + index, priority: 100,
    action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
    condition: { regexFilter: scopeRegex(scope), resourceTypes: RESOURCE_TYPES }
  });
  return rules;
}

export function createRuntimeSnapshot(profile: RuntimeSnapshot["profile"], policy: RuntimeSnapshot["policy"], grantedOrigins: readonly string[], activationId: string, geolocationOneShot = false): RuntimeSnapshot {
  const grants = Object.freeze([...new Set(grantedOrigins)].sort());
  const signature = JSON.stringify({ implementation: RUNTIME_IMPLEMENTATION, profileRevision: profile.revision, policyRevision: policy.policyRevision, grants, geolocationOneShot });
  return Object.freeze({ profile, policy, grantedOrigins: grants, activationId, signature, geolocationOneShot });
}

export function compileActivation(snapshot: RuntimeSnapshot, source = __REGION_RUNTIME_BUNDLE__) {
  const matches = selectedScopes(snapshot.policy, snapshot.grantedOrigins).map(scopePattern);
  const excludeMatches = snapshot.policy.exclude.flatMap(ruleOrigins);
  const code = `(() => { ${source}\n RegionRuntime.installMainRuntime(${JSON.stringify(snapshot)}); })();`;
  return {
    snapshot, matches, networkRules: compileNetworkRules(snapshot),
    mainScript: matches.length ? {
      id: MAIN_SCRIPT_ID, matches, excludeMatches, runAt: "document_start", allFrames: true, world: "MAIN", js: [{ code }]
    } as chrome.userScripts.RegisteredUserScript : null,
    bridgeScript: matches.length ? {
      id: BRIDGE_SCRIPT_ID, matches, excludeMatches, runAt: "document_start", allFrames: true, world: "ISOLATED", js: ["runtime/bridge.js"], persistAcrossSessions: true
    } as chrome.scripting.RegisteredContentScript : null,
    policyDraft: policyToDraft(snapshot.policy)
  };
}
