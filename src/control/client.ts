import { CONTROL_CHANNEL } from "./protocol";
import { parseSitePolicy, type SitePolicy, type SitePolicyDraft } from "../sites/policy";

export async function controlRequest(operation: string, fields: Record<string, unknown> = {}): Promise<unknown> {
  const response: unknown = await chrome.runtime.sendMessage({ channel: CONTROL_CHANNEL, operation, ...fields });
  if (typeof response !== "object" || response === null || !("ok" in response)) throw new Error("Фоновый процесс не вернул ответ.");
  if (response.ok === true && "result" in response) return response.result;
  if ("error" in response && typeof response.error === "object" && response.error !== null && "message" in response.error && typeof response.error.message === "string") throw new Error(response.error.message);
  throw new Error("Некорректный ответ фонового процесса.");
}
export async function loadSitePolicy(): Promise<SitePolicy> { return parseSitePolicy(await controlRequest("policy.load")); }
export async function saveSitePolicy(draft: SitePolicyDraft, expectedRevision: number): Promise<SitePolicy> {
  return parseSitePolicy(await controlRequest("policy.save", { draft, expectedRevision }));
}
