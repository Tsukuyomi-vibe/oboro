import { PROFILE_STORAGE_KEY, PROFILE_REVISION_KEY, type ProfileDraft, type RegionalProfile } from "./types";
import { createRegionalProfile, parseProfileDraft, parseRegionalProfile, profileToDraft, validateExpectedRevision } from "./validation";

export interface ProfileStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class ProfileRepositoryError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProfileRepositoryError";
  }
}

export class ProfileRevisionConflict extends ProfileRepositoryError {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super("REVISION_CONFLICT", "Профиль уже изменился. Прочитайте актуальную версию перед сохранением.");
    this.name = "ProfileRevisionConflict";
  }
}

// Keep a monotonic clock even when an imported empty configuration clears the
// profile, so stale editors cannot match a reused revision after recreation.
export async function readProfileRevision(storage: ProfileStorage, minimum: number): Promise<number> {
  const value = (await storage.get(PROFILE_REVISION_KEY))[PROFILE_REVISION_KEY];
  if (value === undefined || value === null) return minimum;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ProfileRepositoryError("INVALID_STORED_PROFILE", "Повреждён счётчик версий профиля.");
  return Math.max(minimum, value);
}

/** One instance in the service worker owns all profile writes. UI uses the client API. */
export class ProfileRepository {
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly storage: ProfileStorage, private readonly beforeWrite?: () => Promise<void>) {}

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async readStored(): Promise<RegionalProfile | null> {
    let values: Record<string, unknown>;
    try { values = await this.storage.get(PROFILE_STORAGE_KEY); }
    catch (cause) { throw new ProfileRepositoryError("STORAGE_READ_FAILED", "Не удалось прочитать сохранённый профиль.", { cause }); }
    const value = values[PROFILE_STORAGE_KEY];
    if (value === undefined) return null;
    if (value === null) {
      const clock = (await this.storage.get(PROFILE_REVISION_KEY))[PROFILE_REVISION_KEY];
      if (typeof clock === "number" && Number.isSafeInteger(clock) && clock >= 0) return null;
      throw new ProfileRepositoryError("INVALID_STORED_PROFILE", "Сохранённый профиль повреждён или использует неподдерживаемую схему. Данные оставлены без изменений.");
    }
    try { return parseRegionalProfile(value); }
    catch (cause) { throw new ProfileRepositoryError("INVALID_STORED_PROFILE", "Сохранённый профиль повреждён или использует неподдерживаемую схему. Данные оставлены без изменений.", { cause }); }
  }

  load(): Promise<RegionalProfile | null> {
    return this.enqueue(() => this.readStored());
  }

  async save(value: unknown, expectedRevision: number): Promise<RegionalProfile> {
    // Snapshot and validate before queueing the write or serializing storage values.
    const draft: ProfileDraft = parseProfileDraft(value);
    const expected = validateExpectedRevision(expectedRevision);
    return this.enqueue(async () => {
      const previous = await this.readStored();
      const actual = previous?.revision ?? 0;
      if (actual !== expected) throw new ProfileRevisionConflict(expected, actual);
      if (previous && JSON.stringify(profileToDraft(previous)) === JSON.stringify(draft)) return previous;
      const clock = await readProfileRevision(this.storage, actual);
      if (clock === Number.MAX_SAFE_INTEGER) throw new ProfileRepositoryError("REVISION_LIMIT", "Достигнут предел revision; профиль не изменён.");
      const next = createRegionalProfile(draft, clock + 1);
      await this.beforeWrite?.();
      try { await this.storage.set({ [PROFILE_STORAGE_KEY]: next, [PROFILE_REVISION_KEY]: next.revision }); }
      catch (cause) { throw new ProfileRepositoryError("STORAGE_WRITE_FAILED", "Не удалось сохранить профиль. Результат записи нужно проверить повторным чтением.", { cause }); }
      return next;
    });
  }
}
