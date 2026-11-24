import config from "../../fixtures/i02/config.json";

export { config };
export type FixtureScheme = "http" | "https";
export const SCRIPT_ID = "region-i02-main-start";
export const RULE_IDS = [92001, 92002] as const;
export const SESSION_KEY = "i02DiagnosticSession";

export function fixturePort(scheme: FixtureScheme): number {
  return scheme === "https" ? config.httpsPort : config.httpPort;
}

export function fixtureOrigin(host: string, scheme: FixtureScheme): string {
  return `${scheme}://${host}:${fixturePort(scheme)}`;
}

export function fixturePermissions(): string[] {
  return config.hosts.flatMap(({ host }) => [`http://${host}/*`, `https://${host}/*`]);
}

export function createProbeScript(runId: string, scheme: FixtureScheme): chrome.userScripts.RegisteredUserScript {
  const origins = config.hosts.filter((entry) => entry.selected).map(({ host }) => fixtureOrigin(host, scheme));
  return {
    id: SCRIPT_ID,
    matches: [`${scheme}://*.selected.localhost/*`],
    excludeMatches: [`${scheme}://excluded.selected.localhost/*`],
    allFrames: true,
    runAt: "document_start",
    world: "MAIN",
    js: [{ code: `(() => {
      if (!${JSON.stringify(origins)}.includes(location.origin)) return;
      if (location.pathname !== "/" && location.pathname !== "/frame") return;
      if (Object.prototype.hasOwnProperty.call(window, "__REGION_I02_PROBE__")) return;
      Object.defineProperty(window, "__REGION_I02_PROBE__", {
        value: Object.freeze({ runId: ${JSON.stringify(runId)}, readyState: document.readyState, href: location.href }),
        writable: false, configurable: false
      });
    })();` }]
  };
}

export function createProbeRules(runId: string, scheme: FixtureScheme): chrome.declarativeNetRequest.Rule[] {
  return config.hosts.filter((entry) => entry.selected).map(({ host }, index) => ({
    id: RULE_IDS[index]!,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
      requestHeaders: [
        { header: config.probeHeader, operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: runId },
        { header: "Accept-Language", operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: config.acceptLanguage }
      ]
    },
    condition: {
      // Fixed fixture destinations only, including an exact port and scheme.
      regexFilter: `^${scheme}://${host.replaceAll(".", "\\.")}:${fixturePort(scheme)}/`,
      resourceTypes: [
        chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
        chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
        chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST
      ]
    }
  }));
}
