import { createProbeRules, createProbeScript, fixturePermissions, RULE_IDS, SCRIPT_ID, type FixtureScheme } from "./definition";

export interface ChromeEnvironment {
  userAgent: string;
  fullVersionList: { brand: string; version: string }[] | null;
  exactChromeVersion: string | null;
  majorVersion: number | null;
  requiredToggle: "Allow User Scripts" | "Developer mode" | "unknown";
  versionError: string | null;
}

interface NavigatorWithHints extends Navigator {
  userAgentData?: {
    getHighEntropyValues(hints: string[]): Promise<{ fullVersionList?: { brand: string; version: string }[] }>;
  };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readChromeEnvironment(): Promise<ChromeEnvironment> {
  const environment: ChromeEnvironment = {
    userAgent: navigator.userAgent, fullVersionList: null, exactChromeVersion: null,
    majorVersion: null, requiredToggle: "unknown", versionError: null
  };
  const match = /(?:Chrome|Chromium)\/(\d+)/.exec(navigator.userAgent);
  environment.majorVersion = match?.[1] ? Number(match[1]) : null;
  environment.requiredToggle = environment.majorVersion === null ? "unknown"
    : environment.majorVersion >= 138 ? "Allow User Scripts" : "Developer mode";
  try {
    const hints = await (navigator as NavigatorWithHints).userAgentData?.getHighEntropyValues(["fullVersionList"]);
    environment.fullVersionList = hints?.fullVersionList ?? null;
    environment.exactChromeVersion = environment.fullVersionList?.find((entry) => entry.brand === "Google Chrome")?.version ?? null;
  } catch (error) { environment.versionError = errorText(error); }
  return environment;
}

export async function inspectCapabilities() {
  const environment = await readChromeEnvironment();
  const hostAccess = await chrome.permissions.contains({ origins: fixturePermissions() });
  let scripts: { available: boolean; registrations: string[]; error: string | null };
  let dnr: { available: boolean; ruleIds: number[]; error: string | null };
  try {
    // A successful namespace lookup alone is insufficient: the actual call may throw.
    const registered = await chrome.userScripts.getScripts({ ids: [SCRIPT_ID] });
    scripts = { available: true, registrations: registered.map((entry) => entry.id), error: null };
  } catch (error) {
    scripts = { available: false, registrations: [], error: errorText(error) };
  }
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    dnr = { available: true, ruleIds: rules.filter((entry) => (RULE_IDS as readonly number[]).includes(entry.id)).map((entry) => entry.id), error: null };
  } catch (error) { dnr = { available: false, ruleIds: [], error: errorText(error) }; }
  return { checkedAt: new Date().toISOString(), extensionId: chrome.runtime.id, environment, hostAccess, userScripts: scripts, dnr };
}

export async function clearProbe() {
  const errors: string[] = [];
  let scriptsCleared = false;
  let rulesCleared = false;
  // Remove only this probe's IDs, even when another operation fails.
  try {
    const scripts = await chrome.userScripts.getScripts({ ids: [SCRIPT_ID] });
    if (scripts.length) await chrome.userScripts.unregister({ ids: [SCRIPT_ID] });
    scriptsCleared = (await chrome.userScripts.getScripts({ ids: [SCRIPT_ID] })).length === 0;
  } catch (error) { errors.push(`userScripts: ${errorText(error)}`); }
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [...RULE_IDS] });
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    rulesCleared = !rules.some((entry) => (RULE_IDS as readonly number[]).includes(entry.id));
  } catch (error) { errors.push(`DNR: ${errorText(error)}`); }
  return { scriptsCleared, rulesCleared, errors };
}

export async function armProbe(runId: string, scheme: FixtureScheme): Promise<void> {
  const capabilities = await inspectCapabilities();
  if (!capabilities.hostAccess || !capabilities.userScripts.available || !capabilities.dnr.available) {
    throw new Error("Запуск остановлен: нужны доступы к стенду, userScripts и DNR. Проверьте отчёт API и переключатель Chrome, затем обновите эту страницу.");
  }
  const cleanup = await clearProbe();
  if (!cleanup.scriptsCleared || !cleanup.rulesCleared) throw new Error(`Не удалось снять предыдущую пробу: ${cleanup.errors.join("; ")}`);
  try {
    await chrome.userScripts.register([createProbeScript(runId, scheme)]);
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: createProbeRules(runId, scheme) });
    const verified = await inspectCapabilities();
    if (!verified.userScripts.registrations.includes(SCRIPT_ID) || verified.dnr.ruleIds.length !== RULE_IDS.length) {
      throw new Error("Регистрации и сетевые правила не подтвердились после записи.");
    }
  } catch (error) {
    const rollback = await clearProbe();
    throw new Error(`${errorText(error)} Откат: ${JSON.stringify(rollback)}`);
  }
}
