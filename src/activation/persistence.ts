import { parseRegionalProfile } from "../profile/validation";
import { grantedScopes, parseSitePolicy } from "../sites/policy";
import { createRuntimeSnapshot } from "../runtime/compiler";
import type { RuntimeSnapshot } from "../runtime/types";

export const ACTIVATION_SNAPSHOT_KEY = "activationSnapshot";
export const ACTIVATION_JOURNAL_KEY = "activationJournal";
export interface ActivationVersion { activationId: string; profileRevision: number; policyRevision: number; }
export interface ActivationJournal {
  schemaVersion: 1;
  kind: "apply" | "clear";
  phase: "prepared" | "awaiting_documents";
  target: RuntimeSnapshot | null;
  previous: RuntimeSnapshot | null;
  enabledAfter: boolean;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректная запись восстановления.");
  return value as Record<string, unknown>;
}
export function parseActivationVersion(value: unknown): ActivationVersion | null {
  if (value === null || value === undefined) return null;
  const source = object(value);
  if (typeof source.activationId !== "string" || !source.activationId.length || source.activationId.length > 100 ||
      !Number.isSafeInteger(source.profileRevision) || (source.profileRevision as number) < 1 ||
      !Number.isSafeInteger(source.policyRevision) || (source.policyRevision as number) < 0) throw new Error("Повреждена версия применения.");
  return { activationId: source.activationId, profileRevision: source.profileRevision as number, policyRevision: source.policyRevision as number };
}
export function snapshotVersion(snapshot: RuntimeSnapshot): ActivationVersion {
  return { activationId: snapshot.activationId, profileRevision: snapshot.profile.revision, policyRevision: snapshot.policy.policyRevision };
}
export function sameVersion(snapshot: RuntimeSnapshot, version: ActivationVersion | null): boolean {
  return version !== null && snapshot.activationId === version.activationId && snapshot.profile.revision === version.profileRevision && snapshot.policy.policyRevision === version.policyRevision;
}
export function parseActivationSnapshot(value: unknown): RuntimeSnapshot | null {
  if (value === null || value === undefined) return null;
  const source = object(value);
  if (typeof source.activationId !== "string" || !source.activationId.length || source.activationId.length > 100 || typeof source.geolocationOneShot !== "boolean" ||
      !Array.isArray(source.grantedOrigins) || source.grantedOrigins.length > 2000 || source.grantedOrigins.some((entry) => typeof entry !== "string" || entry.length > 512 || grantedScopes([entry]).length === 0)) throw new Error("Повреждён снимок применения.");
  // Persist data only. Executable scripts are always compiled from this package.
  return createRuntimeSnapshot(parseRegionalProfile(source.profile), parseSitePolicy(source.policy), source.grantedOrigins as string[], source.activationId, source.geolocationOneShot);
}
export function parseActivationJournal(value: unknown): ActivationJournal | null {
  if (value === null || value === undefined) return null;
  const source = object(value);
  if (source.schemaVersion !== 1 || !["apply", "clear"].includes(String(source.kind)) || !["prepared", "awaiting_documents"].includes(String(source.phase)) || typeof source.enabledAfter !== "boolean") throw new Error("Повреждён журнал применения.");
  const target = parseActivationSnapshot(source.target); const previous = parseActivationSnapshot(source.previous);
  if (source.kind === "apply" && (!target || !source.enabledAfter) || source.kind === "clear" && (target !== null || source.phase !== "prepared")) throw new Error("Несогласованный журнал применения.");
  return { schemaVersion: 1, kind: source.kind as ActivationJournal["kind"], phase: source.phase as ActivationJournal["phase"], target, previous, enabledAfter: source.enabledAfter };
}
