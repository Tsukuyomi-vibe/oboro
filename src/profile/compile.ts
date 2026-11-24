import type { CompiledRegionalProfile, RegionalProfile } from "./types";
import { normalizeLanguages, parseRegionalProfile } from "./validation";

export function compileAcceptLanguage(value: unknown): string {
  const languages = normalizeLanguages(value);
  // Integer tenths avoid floating point artifacts and never generate q=0.
  return languages.map((tag, index) => index === 0 ? tag : `${tag};q=0.${10 - index}`).join(",");
}

export function compileRegionalProfile(value: RegionalProfile): CompiledRegionalProfile {
  const profile = parseRegionalProfile(value);
  return Object.freeze({ profile, acceptLanguage: compileAcceptLanguage(profile.languages) });
}
