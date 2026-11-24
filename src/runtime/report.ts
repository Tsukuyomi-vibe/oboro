import { hmacSha256 } from "./sha256";
import type { PageRuntimeReport, RuntimeReport, RuntimeSnapshot } from "./types";

// Only document-local proof material and non-personal module diagnostics may
// cross the page boundary. IDs, revisions, profile names and host grants stay
// inside the registered script / extension worker.
export const PUBLIC_REPORT_FIELDS = ["implementation", "readyState", "languages", "locale", "time", "temporal", "keyboard", "keyboardLayout", "keyboardReason", "timeCompatibility", "timeCoverage", "geolocation", "needsReload", "reasons"] as const;
export const PAGE_REPORT_FIELDS = [...PUBLIC_REPORT_FIELDS, "documentNonce", "documentOrigin", "proof"] as const;
const stringify = JSON.stringify.bind(JSON);
const Encoder = globalThis.TextEncoder;
const encode = (text: string): Uint8Array => new Encoder().encode(text);
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
type Unsigned = Omit<PageRuntimeReport, "proof">;
const unsigned = (value: Record<string, unknown>): Unsigned => Object.fromEntries([...PUBLIC_REPORT_FIELDS, "documentNonce", "documentOrigin"].map((key) => [key, value[key]])) as unknown as Unsigned;
function proof(snapshot: Pick<RuntimeSnapshot, "activationId" | "signature">, value: Unsigned): string {
  const message = "oboro.runtime-report.v1\0" + snapshot.signature + "\0" + stringify(value);
  return hex(hmacSha256(encode(snapshot.activationId), encode(message)));
}
export function createDocumentNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return hex(bytes);
}
export function createPageRuntimeReport(snapshot: Pick<RuntimeSnapshot, "activationId" | "signature">, report: RuntimeReport, documentOrigin: string, documentNonce = createDocumentNonce()): PageRuntimeReport {
  const data = unsigned({ ...Object.fromEntries(PUBLIC_REPORT_FIELDS.map((key) => [key, report[key]])), documentOrigin, documentNonce });
  return Object.freeze({ ...data, reasons: Object.freeze([...data.reasons]) as unknown as string[], proof: proof(snapshot, data) });
}
export function readPageRuntimeReport(value: unknown): PageRuntimeReport | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !(PAGE_REPORT_FIELDS as readonly string[]).includes(key)) || !PAGE_REPORT_FIELDS.every((key) => Object.hasOwn(source, key))) return null;
  if (typeof source.documentNonce !== "string" || !/^[a-f0-9]{32}$/.test(source.documentNonce) || typeof source.proof !== "string" || !/^[a-f0-9]{64}$/.test(source.proof) || typeof source.documentOrigin !== "string" || source.documentOrigin.length > 2048) return null;
  try { if (stringify(source).length > 64_000) return null; } catch { return null; }
  return { ...unsigned(source), proof: source.proof };
}
export function authenticatePageRuntimeReport(value: unknown, snapshot: RuntimeSnapshot, origin: string): RuntimeReport | null {
  try {
    const page = readPageRuntimeReport(value);
    if (!page || page.documentOrigin !== origin) return null;
    const expected = proof(snapshot, unsigned(page as unknown as Record<string, unknown>));
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ page.proof.charCodeAt(i);
    if (difference) return null;
    const fields = Object.fromEntries(PUBLIC_REPORT_FIELDS.map((key) => [key, page[key]]));
    return { ...fields, activationId: snapshot.activationId, profileRevision: snapshot.profile.revision, policyRevision: snapshot.policy.policyRevision } as unknown as RuntimeReport;
  } catch { return null; }
}
