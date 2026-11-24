import { normalizeSiteRule, policyToDraft, ruleOrigins, type SitePolicy, type SitePolicyDraft, type SiteRule } from "./policy";

export interface SiteActionDependencies {
  request(origins: string[]): Promise<boolean>;
  save(draft: SitePolicyDraft, revision: number): Promise<SitePolicy>;
}
/** Called synchronously in the click/submit so Chrome retains the user gesture. */
export function performSiteAction(kind: unknown, value: SiteRule, policy: SitePolicy, dependencies: SiteActionDependencies) {
  if (kind !== "include" && kind !== "exclude" && kind !== "permission") throw new Error("Неизвестное действие с сайтом.");
  const rule = normalizeSiteRule(value);
  const permission = kind === "exclude" ? Promise.resolve(true) : dependencies.request(ruleOrigins(rule));
  return permission.then(async (granted) => {
    if (kind === "permission") return { policy, granted };
    const draft = policyToDraft(policy);
    const others = draft[kind].filter((entry) => JSON.stringify(entry) !== JSON.stringify(rule));
    const saved = await dependencies.save({ ...draft, [kind]: [...others, rule] }, policy.policyRevision);
    return { policy: saved, granted };
  });
}
