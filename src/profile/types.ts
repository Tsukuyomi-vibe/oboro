export const PROFILE_SCHEMA_VERSION = 1 as const;
export const PROFILE_STORAGE_KEY = "regionalProfile";
export const PROFILE_REVISION_KEY = "regionalProfileRevision";
export const MAX_PROFILE_LANGUAGES = 10;

export interface RegionalGeolocation {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude: number | null;
  readonly altitudeAccuracy: number | null;
  readonly speed: number | null;
  readonly heading: number | null;
}

/** A normalized draft has no caller-controlled revision or derived language. */
export interface ProfileDraft {
  readonly name: string;
  readonly geolocation: RegionalGeolocation;
  readonly languages: readonly string[];
  readonly locale: string;
  readonly timeZone: string;
  readonly keyboardLayout: KeyboardLayoutId;
}

export interface RegionalProfile extends ProfileDraft {
  readonly schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  readonly revision: number;
  readonly language: string;
}

export interface CompiledRegionalProfile {
  readonly profile: RegionalProfile;
  readonly acceptLanguage: string;
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export class ProfileValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(path: string, code: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ProfileValidationError";
    this.issues = Object.freeze([Object.freeze({ path, code, message })]);
  }
}
import type { KeyboardLayoutId } from "../keyboard/layouts";
