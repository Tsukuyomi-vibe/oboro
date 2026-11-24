import type { RegionalProfile } from "../profile/types";
import type { SitePolicy } from "../sites/policy";
import type { KeyboardLayoutId } from "../keyboard/layouts";

export const MAIN_SCRIPT_ID = "regional-main-v1";
export const BRIDGE_SCRIPT_ID = "regional-bridge-v1";
export const PAGE_REPORT = "regional-runtime:v1";
export const PAGE_QUERY = "regional-runtime-query:v1";
export const FRAME_CHANNEL = "regional-frame:v1";
export const RUNTIME_IMPLEMENTATION = 7;
export const TIME_RUNTIME_COMPLETE = true;
export const TIME_RUNTIME_LIMITATIONS: readonly string[] = Object.freeze([]);
export type TemporalStatus = "installed" | "absent" | "unsupported" | "error" | "not_checked";
export type KeyboardStatus = "native" | "installed" | "unsupported" | "error" | "not_checked";
export interface TimeCompatibility {
  status: "passed" | "failed" | "not_run";
  structuredClone: "passed" | "absent" | "failed" | "not_run";
  checks: readonly string[];
  failures: readonly string[];
}
export interface TimeCoverage {
  formatting: boolean; localRead: boolean; construction: boolean; parse: boolean; localSetters: boolean; temporal: boolean; complete: boolean;
}
export interface RuntimeSnapshot {
  readonly activationId: string;
  readonly signature: string;
  readonly profile: RegionalProfile;
  readonly policy: SitePolicy;
  readonly grantedOrigins: readonly string[];
  readonly geolocationOneShot: boolean;
}
export interface RuntimeReport {
  implementation: number;
  activationId: string;
  profileRevision: number;
  policyRevision: number;
  readyState: DocumentReadyState;
  languages: "installed" | "error";
  locale: "installed" | "error";
  time: "installed" | "partial" | "error";
  temporal: TemporalStatus;
  keyboard: KeyboardStatus;
  keyboardLayout: KeyboardLayoutId;
  keyboardReason: string | null;
  timeCompatibility: Readonly<TimeCompatibility>;
  timeCoverage: Readonly<TimeCoverage>;
  geolocation: "not_implemented" | "installed" | "unsupported" | "error";
  needsReload: boolean;
  reasons: string[];
}

export interface PageRuntimeReport extends Omit<RuntimeReport, "activationId" | "profileRevision" | "policyRevision"> {
  readonly documentNonce: string;
  readonly documentOrigin: string;
  readonly proof: string;
}
