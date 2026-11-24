import type { ProfileStorage } from "../profile/repository";
import { validateExpectedRevision } from "../profile/validation";
import { SITE_POLICY_KEY, SitePolicyError, createSitePolicy, emptySitePolicy, parseSitePolicy, parseSitePolicyDraft, policyToDraft, type SitePolicy } from "./policy";

export class SitePolicyRepository {
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly storage: ProfileStorage, private readonly beforeWrite?: () => Promise<void>) {}
  private enqueue<T>(action: () => Promise<T>): Promise<T> { const result = this.pending.then(action); this.pending = result.then(() => undefined, () => undefined); return result; }
  private async read(): Promise<SitePolicy> {
    const raw = (await this.storage.get(SITE_POLICY_KEY))[SITE_POLICY_KEY];
    return raw === undefined ? emptySitePolicy() : parseSitePolicy(raw);
  }
  load(): Promise<SitePolicy> { return this.enqueue(() => this.read()); }
  async save(input: unknown, expectedRevision: number): Promise<SitePolicy> {
    const draft = parseSitePolicyDraft(input); const expected = validateExpectedRevision(expectedRevision);
    return this.enqueue(async () => {
      const current = await this.read();
      if (current.policyRevision !== expected) throw new SitePolicyError("POLICY_CONFLICT", "Список сайтов изменился. Обновите его перед сохранением.");
      if (JSON.stringify(policyToDraft(current)) === JSON.stringify(draft)) return current;
      if (expected === Number.MAX_SAFE_INTEGER) throw new SitePolicyError("REVISION_LIMIT", "Достигнут предел версии политики.");
      const next = createSitePolicy(draft, expected + 1);
      await this.beforeWrite?.();
      await this.storage.set({ [SITE_POLICY_KEY]: next });
      return next;
    });
  }
}
