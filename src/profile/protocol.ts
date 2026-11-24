import type { RegionalProfile, ValidationIssue } from "./types";

export const PROFILE_CHANNEL = "regional-profile:v1";

export interface ProfileErrorDetail {
  code: string;
  message: string;
  issues?: readonly ValidationIssue[];
  expectedRevision?: number;
  actualRevision?: number;
}

export type ProfileResponse =
  | { ok: true; profile: RegionalProfile | null }
  | { ok: false; error: ProfileErrorDetail };
