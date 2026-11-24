import { PROFILE_CHANNEL, type ProfileErrorDetail } from "./protocol";
import type { RegionalProfile } from "./types";
import { parseProfileDraft, parseRegionalProfile, validateExpectedRevision } from "./validation";

export class ProfileClientError extends Error {
  constructor(readonly detail: ProfileErrorDetail, options?: ErrorOptions) {
    super(detail.message, options);
    this.name = "ProfileClientError";
  }
}

async function request(message: Record<string, unknown>): Promise<RegionalProfile | null> {
  let response: unknown;
  try { response = await chrome.runtime.sendMessage(message); }
  catch (cause) {
    throw new ProfileClientError({ code: "TRANSPORT_ERROR", message: "Фоновый процесс не ответил. Повторно прочитайте профиль перед сохранением." }, { cause });
  }
  if (typeof response !== "object" || response === null || !("ok" in response)) {
    throw new ProfileClientError({ code: "INVALID_RESPONSE", message: "Получен некорректный ответ профиля." });
  }
  if (response.ok === true && "profile" in response) {
    try { return response.profile === null ? null : parseRegionalProfile(response.profile); }
    catch (cause) { throw new ProfileClientError({ code: "INVALID_RESPONSE", message: "Ответ содержит некорректный профиль." }, { cause }); }
  }
  if (response.ok === false && "error" in response && typeof response.error === "object" && response.error !== null &&
      "code" in response.error && typeof response.error.code === "string" && "message" in response.error && typeof response.error.message === "string") {
    throw new ProfileClientError(response.error as ProfileErrorDetail);
  }
  throw new ProfileClientError({ code: "INVALID_RESPONSE", message: "Получен некорректный ответ профиля." });
}

export function loadProfile(): Promise<RegionalProfile | null> {
  return request({ channel: PROFILE_CHANNEL, operation: "load" });
}

export async function saveProfile(value: unknown, expectedRevision: number): Promise<RegionalProfile> {
  // Chrome messages use JSON: validate NaN/Infinity before they can become null.
  const draft = parseProfileDraft(value);
  const expected = validateExpectedRevision(expectedRevision);
  const profile = await request({ channel: PROFILE_CHANNEL, operation: "save", draft, expectedRevision: expected });
  if (profile === null) throw new ProfileClientError({ code: "INVALID_RESPONSE", message: "Сохранение не вернуло профиль." });
  return profile;
}
