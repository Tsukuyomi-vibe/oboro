import type { ProfileDraft } from "../profile/types";
import type { SitePolicyDraft } from "../sites/policy";

export const CONFIG_FORMAT = "oboro-config";
export const CONFIG_SCHEMA_VERSION = 2 as const;
export const MAX_CONFIG_BYTES = 1_048_576;
export const CONFIG_UI_RESTORE_KEY = "configurationUiRestore";
export const CONFIG_PERMISSION_HINTS_KEY = "configurationPermissionHints";
export const CONFIG_IMPORT_JOURNAL_KEY = "configurationImportJournal";
export const UI_RESTORE_EVENT = "oboro:restore-ui";

export interface UiPreferences {
  readonly language: "en" | "ru";
  readonly theme: "system" | "light" | "dark";
}
export interface SavedConfiguration {
  readonly profile: ProfileDraft | null;
  readonly sitePolicy: SitePolicyDraft;
  readonly ui: UiPreferences;
}
export interface PermissionHints { readonly origins: readonly string[]; }
export interface ConfigurationFile {
  readonly format: typeof CONFIG_FORMAT;
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  /** Version of the exporter, independent of the portable schema/storage revisions. */
  readonly oboroVersion: string;
  readonly config: SavedConfiguration;
  readonly permissionHints: PermissionHints;
}
export type DecodedConfiguration =
  | { readonly kind: "configuration"; readonly sourceOboroVersion: string; readonly sourceSchemaVersion: number; readonly file: ConfigurationFile }
  | { readonly kind: "profile"; readonly sourceOboroVersion: null; readonly sourceSchemaVersion: number; readonly profile: ProfileDraft };
export interface UiRestoreRecord {
  readonly schemaVersion: 1;
  readonly token: string;
  readonly ui: UiPreferences;
}
export interface ConfigurationPreview {
  readonly id: string;
  readonly kind: DecodedConfiguration["kind"];
  readonly sourceOboroVersion: string | null;
  readonly sourceSchemaVersion: number;
  readonly current: SavedConfiguration;
  readonly proposed: SavedConfiguration;
  readonly permissionHints: PermissionHints;
}
export interface ConfigurationImportResult {
  readonly profileRevision: number;
  readonly policyRevision: number;
  readonly missingOrigins: readonly string[];
}
export class ConfigurationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ConfigurationError"; }
}
