import { parseProfileDraft, parseLegacyProfileDraft, parseRegionalProfile, profileToDraft } from "../profile/validation";
import { normalizeHost, parseSitePolicyDraft } from "../sites/policy";
import {
  CONFIG_FORMAT, CONFIG_SCHEMA_VERSION, MAX_CONFIG_BYTES, ConfigurationError,
  type ConfigurationFile, type DecodedConfiguration, type PermissionHints, type UiPreferences, type UiRestoreRecord
} from "./types";

export function configObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
    throw new ConfigurationError("INVALID_CONFIG", "Ожидается объект конфигурации.");
  }
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !allowed.includes(key))) throw new ConfigurationError("INVALID_CONFIG", "В конфигурации есть неизвестные поля.");
  return object;
}
export function parseUiPreferences(value: unknown): UiPreferences {
  const ui = configObject(value, ["language", "theme"]);
  if (ui.language !== "en" && ui.language !== "ru" || ui.theme !== "system" && ui.theme !== "light" && ui.theme !== "dark") {
    throw new ConfigurationError("INVALID_CONFIG", "В конфигурации указан неподдерживаемый язык интерфейса или тема.");
  }
  return Object.freeze({ language: ui.language as UiPreferences["language"], theme: ui.theme as UiPreferences["theme"] });
}
export function normalizePermissionOrigin(value: unknown): string {
  if (typeof value !== "string" || value.length > 512) throw new ConfigurationError("INVALID_CONFIG", "Некорректная подсказка доступа к сайту.");
  const match = /^(https?):\/\/(\*|\*\.[^/]+|[^/]+)\/\*$/.exec(value);
  if (!match) throw new ConfigurationError("INVALID_CONFIG", "Подсказки доступа должны содержать только HTTP/HTTPS match patterns без пути и порта.");
  const host = match[2]!;
  if (host === "*") return `${match[1]}://*/*`;
  const subdomains = host.startsWith("*.");
  const normalized = normalizeHost(subdomains ? host.slice(2) : host);
  if (subdomains && (normalized.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(normalized))) {
    throw new ConfigurationError("INVALID_CONFIG", "Для IP-адреса поддомены не поддерживаются.");
  }
  return `${match[1]}://${subdomains ? "*." : ""}${normalized}/*`;
}
export function parsePermissionHints(value: unknown): PermissionHints {
  const input = configObject(value, ["origins"]);
  if (!Array.isArray(input.origins) || input.origins.length > 2000) throw new ConfigurationError("INVALID_CONFIG", "Допустимо не более 2000 подсказок доступа.");
  return Object.freeze({ origins: Object.freeze([...new Set(input.origins.map(normalizePermissionOrigin))].sort()) });
}
export function permissionHintsFromGrants(origins: readonly string[]): PermissionHints {
  return parsePermissionHints({ origins: origins.flatMap((origin) => origin === "<all_urls>"
    ? ["http://*/*", "https://*/*"] : /^https?:\/\//.test(origin) ? [origin] : []) });
}
export function parseUiRestore(value: unknown): UiRestoreRecord | null {
  if (value === undefined || value === null) return null;
  const record = configObject(value, ["schemaVersion", "token", "ui"]);
  if (record.schemaVersion !== 1 || typeof record.token !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(record.token)) {
    throw new ConfigurationError("INVALID_CONFIG", "Повреждена запись восстановления интерфейса.");
  }
  return Object.freeze({ schemaVersion: 1, token: record.token, ui: parseUiPreferences(record.ui) });
}
function readVersion(value: unknown, version: 1 | 2 | 3): ConfigurationFile {
  const root = configObject(value, ["format", "schemaVersion", "oboroVersion", "config", "permissionHints"]);
  if (root.format !== CONFIG_FORMAT || root.schemaVersion !== version || typeof root.oboroVersion !== "string" ||
      !/^\d{1,5}(?:\.\d{1,5}){1,3}$/.test(root.oboroVersion) || root.oboroVersion.split(".").some((part) => Number(part) > 65535)) {
    throw new ConfigurationError("INVALID_CONFIG", "В конфигурации отсутствует корректная версия oboro.");
  }
  const config = configObject(root.config, ["profile", "sitePolicy", "ui"]);
  return Object.freeze({
    format: CONFIG_FORMAT, schemaVersion: CONFIG_SCHEMA_VERSION, oboroVersion: root.oboroVersion,
    config: Object.freeze({ profile: config.profile === null ? null : version < 3 ? parseLegacyProfileDraft(config.profile, version as 1 | 2) : parseProfileDraft(config.profile), sitePolicy: parseSitePolicyDraft(config.sitePolicy), ui: parseUiPreferences(config.ui) }),
    permissionHints: parsePermissionHints(root.permissionHints)
  });
}

// Published readers are retained. Future schema changes add a pure migration
// into the current DTO; app-version comparisons never select a schema reader.
const READERS: Readonly<Record<number, (value: unknown) => ConfigurationFile>> = Object.freeze({
  1: (value) => readVersion(value, 1),
  2: (value) => readVersion(value, 2),
  3: (value) => readVersion(value, 3) // Only latitude and longitude can be overridden.
});
export function readConfigurationFile(value: unknown): ConfigurationFile {
  if (typeof value !== "object" || value === null || !("format" in value) || value.format !== CONFIG_FORMAT || !("schemaVersion" in value)) {
    throw new ConfigurationError("INVALID_CONFIG", "Это не файл конфигурации oboro.");
  }
  const version = value.schemaVersion;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) throw new ConfigurationError("INVALID_CONFIG", "Некорректная версия формата конфигурации.");
  if (version > CONFIG_SCHEMA_VERSION) throw new ConfigurationError("CONFIG_TOO_NEW", "Файл использует более новый формат конфигурации. Обновите oboro; настройки не изменены.");
  const reader = READERS[version];
  if (!reader) throw new ConfigurationError("UNSUPPORTED_CONFIG", "Версия формата конфигурации не поддерживается.");
  return reader(value);
}
export function decodeConfiguration(text: unknown): DecodedConfiguration {
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_CONFIG_BYTES) throw new ConfigurationError("CONFIG_TOO_LARGE", "Конфигурация слишком велика: максимум 1 МиБ.");
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new ConfigurationError("INVALID_CONFIG", "Не удалось прочитать JSON конфигурации."); }
  if (typeof value === "object" && value !== null && "format" in value) {
    const file = readConfigurationFile(value);
    const sourceSchemaVersion = "schemaVersion" in value && typeof value.schemaVersion === "number" ? value.schemaVersion : file.schemaVersion;
    return Object.freeze({ kind: "configuration", sourceOboroVersion: file.oboroVersion, sourceSchemaVersion, file });
  }
  // Standalone profile files never recorded an app version. Do not invent one
  // or overwrite unrelated settings when adapting that narrower format.
  const profile = parseRegionalProfile(value);
  const sourceSchemaVersion = typeof value === "object" && value !== null && "schemaVersion" in value && typeof value.schemaVersion === "number" ? value.schemaVersion : profile.schemaVersion;
  return Object.freeze({ kind: "profile", sourceOboroVersion: null, sourceSchemaVersion, profile: profileToDraft(profile) });
}
export function serializeConfiguration(value: unknown): string {
  const text = JSON.stringify(readConfigurationFile(value), null, 2) + "\n";
  if (new TextEncoder().encode(text).byteLength > MAX_CONFIG_BYTES) throw new ConfigurationError("CONFIG_TOO_LARGE", "Конфигурация слишком велика: максимум 1 МиБ.");
  return text;
}
