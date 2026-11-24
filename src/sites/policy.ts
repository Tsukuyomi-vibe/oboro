export const SITE_POLICY_KEY = "sitePolicy";
export const MAX_SITE_RULES = 100;
export type SiteScheme = "http" | "https";
export interface SiteRule {
  readonly host: string;
  readonly schemes: readonly SiteScheme[];
  readonly includeSubdomains: boolean;
}
export interface SitePolicyDraft {
  readonly mode: "selected_sites" | "all_granted_sites";
  readonly include: readonly SiteRule[];
  readonly exclude: readonly SiteRule[];
}
export interface SitePolicy extends SitePolicyDraft {
  readonly schemaVersion: 1;
  readonly policyRevision: number;
}
export interface HostScope { scheme: SiteScheme; host: string; includeSubdomains: boolean; }

export class SitePolicyError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "SitePolicyError"; }
}
function fail(message: string): never { throw new SitePolicyError("INVALID_SITE_POLICY", message); }
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("Ожидается объект правила или политики сайтов.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail("Неизвестное поле политики сайтов.");
}
export function isIpHost(host: string): boolean { return host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host); }

export function normalizeHost(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\s\u0000-\u001f\u007f/@?#\\*]/.test(value.trim())) fail("Укажите точный хост без схемы, пути, порта и wildcard.");
  const raw = value.trim();
  if (raw.startsWith("[") ? !raw.endsWith("]") : raw.includes(":")) fail("Порты не входят в правила сайтов.");
  let parsed: URL;
  try { parsed = new URL(`http://${value.trim()}`); } catch { return fail("Некорректный хост."); }
  if (parsed.port || parsed.username || parsed.password || parsed.pathname !== "/" || !parsed.hostname ||
      (!parsed.hostname.startsWith("[") && parsed.hostname.split(".").some((label, index, all) => !label && index !== all.length - 1))) fail("Некорректный хост или явно заданный порт.");
  // A trailing DNS dot remains significant, just as it is in URL origins/permissions.
  return parsed.hostname.toLowerCase();
}

export function normalizeSiteRule(value: unknown): SiteRule {
  const input = object(value); keys(input, ["host", "schemes", "includeSubdomains"]);
  const host = normalizeHost(input.host);
  if (typeof input.includeSubdomains !== "boolean") fail("Флажок поддоменов должен быть boolean.");
  if (input.includeSubdomains && isIpHost(host)) fail("Для IP-адреса поддомены не поддерживаются.");
  if (!Array.isArray(input.schemes) || input.schemes.length < 1 || input.schemes.length > 2 ||
      !input.schemes.every((scheme) => scheme === "http" || scheme === "https") || new Set(input.schemes).size !== input.schemes.length) fail("Выберите HTTP, HTTPS или обе схемы без повторов.");
  const schemes = (["http", "https"] as const).filter((scheme) => (input.schemes as unknown[]).includes(scheme));
  return Object.freeze({ host, schemes: Object.freeze(schemes), includeSubdomains: input.includeSubdomains });
}
function rules(value: unknown): readonly SiteRule[] {
  if (!Array.isArray(value) || value.length > MAX_SITE_RULES) fail(`Ожидается не более ${MAX_SITE_RULES} правил в списке.`);
  const result = value.map(normalizeSiteRule);
  if (new Set(result.map((rule) => JSON.stringify(rule))).size !== result.length) fail("Правило сайта повторяется.");
  return Object.freeze(result);
}
export function parseSitePolicyDraft(value: unknown): SitePolicyDraft {
  const input = object(value); keys(input, ["mode", "include", "exclude"]);
  if (input.mode !== "selected_sites" && input.mode !== "all_granted_sites") fail("Неизвестный режим выбора сайтов.");
  return Object.freeze({ mode: input.mode, include: rules(input.include), exclude: rules(input.exclude) });
}
export function createSitePolicy(value: unknown, policyRevision: number): SitePolicy {
  if (!Number.isSafeInteger(policyRevision) || policyRevision < 0) fail("Некорректная policyRevision.");
  return Object.freeze({ schemaVersion: 1, policyRevision, ...parseSitePolicyDraft(value) });
}
export function emptySitePolicy(): SitePolicy { return createSitePolicy({ mode: "selected_sites", include: [], exclude: [] }, 0); }
export function policyToDraft(policy: SitePolicy): SitePolicyDraft { return parseSitePolicyDraft({ mode: policy.mode, include: policy.include, exclude: policy.exclude }); }
export function parseSitePolicy(value: unknown): SitePolicy {
  const input = object(value); keys(input, ["schemaVersion", "policyRevision", "mode", "include", "exclude"]);
  if (input.schemaVersion !== 1 || typeof input.policyRevision !== "number") fail("Неподдерживаемая схема или версия политики.");
  return createSitePolicy({ mode: input.mode, include: input.include, exclude: input.exclude }, input.policyRevision);
}

export function httpUrl(value: string): URL | null {
  try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url : null; } catch { return null; }
}
export function hostMatches(host: string, scope: Pick<HostScope, "host" | "includeSubdomains">): boolean {
  return scope.host === "*" || host === scope.host || (scope.includeSubdomains && !isIpHost(host) && host.endsWith(`.${scope.host}`));
}
export function ruleMatches(url: URL, rule: SiteRule): boolean {
  return rule.schemes.some((scheme) => `${scheme}:` === url.protocol) && hostMatches(url.hostname, rule);
}
export function ruleOrigins(rule: SiteRule): string[] {
  return rule.schemes.map((scheme) => `${scheme}://${rule.includeSubdomains ? "*." : ""}${rule.host}/*`);
}
export function grantedScopes(origins: readonly string[]): HostScope[] {
  const result: HostScope[] = [];
  for (const origin of origins) {
    if (origin === "<all_urls>") { result.push({ scheme: "http", host: "*", includeSubdomains: true }, { scheme: "https", host: "*", includeSubdomains: true }); continue; }
    const match = /^(http|https|\*):\/\/(\*|\*\.[^/]+|[^/]+)\/.*$/.exec(origin);
    if (!match) continue;
    const rawHost = match[2]!;
    let host: string;
    try { host = rawHost === "*" ? "*" : normalizeHost(rawHost.startsWith("*.") ? rawHost.slice(2) : rawHost); } catch { continue; }
    for (const scheme of match[1] === "*" ? ["http", "https"] as const : [match[1] as SiteScheme]) {
      result.push({ scheme, host, includeSubdomains: rawHost === "*" || rawHost.startsWith("*.") });
    }
  }
  return result;
}
export function hasHostPermission(value: string, origins: readonly string[]): boolean {
  const url = httpUrl(value);
  return url !== null && grantedScopes(origins).some((scope) => `${scope.scheme}:` === url.protocol && hostMatches(url.hostname, scope));
}
export function resolveSite(value: string, policy: SitePolicy, origins: readonly string[] = []) {
  const url = httpUrl(value);
  if (!url) return { selection: "unsupported" as const, granted: false };
  const granted = hasHostPermission(value, origins);
  if (policy.exclude.some((rule) => ruleMatches(url, rule))) return { selection: "excluded" as const, granted };
  const selected = policy.mode === "all_granted_sites" ? granted : policy.include.some((rule) => ruleMatches(url, rule));
  return { selection: selected ? "selected" as const : "not_selected" as const, granted };
}
export function isSiteSelected(value: string, policy: SitePolicy, origins: readonly string[] = []): boolean {
  return resolveSite(value, policy, origins).selection === "selected";
}
export function intersectScopes(left: HostScope, right: HostScope): HostScope | null {
  if (left.scheme !== right.scheme) return null;
  if (!left.includeSubdomains) return hostMatches(left.host, right) ? left : null;
  if (!right.includeSubdomains) return hostMatches(right.host, left) ? right : null;
  if (hostMatches(left.host, right)) return left;
  if (hostMatches(right.host, left)) return right;
  return null;
}
export function selectedScopes(policy: SitePolicy, origins: readonly string[]): HostScope[] {
  const permissions = grantedScopes(origins);
  const included = policy.mode === "all_granted_sites" ? permissions : policy.include.flatMap((rule) => rule.schemes.map((scheme) => ({ scheme, host: rule.host, includeSubdomains: rule.includeSubdomains })));
  const intersections = included.flatMap((scope) => permissions.map((permission) => intersectScopes(scope, permission)).filter((entry): entry is HostScope => entry !== null));
  return [...new Map(intersections.map((scope) => [scopePattern(scope), scope])).values()].sort((a, b) => scopePattern(a).localeCompare(scopePattern(b), "en"));
}
export function scopePattern(scope: HostScope): string { return `${scope.scheme}://${scope.host === "*" ? "*" : `${scope.includeSubdomains ? "*." : ""}${scope.host}`}/*`; }
