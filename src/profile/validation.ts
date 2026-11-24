import {
  MAX_PROFILE_LANGUAGES, PROFILE_SCHEMA_VERSION, ProfileValidationError,
  type ProfileDraft, type RegionalGeolocation, type RegionalProfile
} from "./types";
import { isKeyboardLayoutId, type KeyboardLayoutId } from "../keyboard/layouts";

const DRAFT_KEYS = ["name", "geolocation", "languages", "locale", "timeZone", "keyboardLayout"];
const GEO_KEYS = ["latitude", "longitude", "accuracy", "altitude", "altitudeAccuracy", "speed", "heading"];
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function invalid(path: string, code: string, message: string): never {
  throw new ProfileValidationError(path, code, message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "type", "ожидается объект.");
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path, "type", "ожидается обычный объект данных.");
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) invalid(`${path}.${key}`, "unknown_field", "неизвестное поле.");
  }
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) invalid(path, "type", "ожидается непустая строка без управляющих символов.");
  const trimmed = value.trim();
  if (!trimmed) invalid(path, "empty", "значение не должно быть пустым.");
  return trimmed;
}

function finiteNumber(value: unknown, path: string, min: number, max: number, exclusiveMax = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(path, "finite_number", "ожидается конечное число без преобразования из строки.");
  if (value < min || (exclusiveMax ? value >= max : value > max)) invalid(path, "range", `число вне допустимого диапазона ${min}…${max}${exclusiveMax ? " (верхняя граница не включена)" : ""}.`);
  return value === 0 ? 0 : value;
}

function nullableNumber(value: unknown, path: string, min: number, max = Number.POSITIVE_INFINITY, exclusiveMax = false): number | null {
  if (value === undefined || value === null) return null;
  return finiteNumber(value, path, min, max, exclusiveMax);
}

function languageTag(value: unknown, path: string): string {
  const tag = text(value, path);
  try {
    const canonical = Intl.getCanonicalLocales(tag)[0];
    if (canonical) return canonical;
  } catch { /* Report a field error instead of leaking an Intl implementation error. */ }
  return invalid(path, "language_tag", "нужен языковой тег, поддерживаемый Intl, например de-DE или sr-Latn-RS.");
}

export function normalizeLanguages(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PROFILE_LANGUAGES) {
    invalid("languages", "length", `нужен список из 1–${MAX_PROFILE_LANGUAGES} языковых тегов.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const canonical = languageTag(value[index], `languages[${index}]`);
    if (seen.has(canonical)) invalid(`languages[${index}]`, "duplicate", "язык повторяется после нормализации.");
    seen.add(canonical);
    result.push(canonical);
  }
  return Object.freeze(result);
}

function geolocation(value: unknown): RegionalGeolocation {
  const source = object(value, "geolocation");
  knownKeys(source, GEO_KEYS, "geolocation");
  return Object.freeze({
    latitude: finiteNumber(source.latitude, "geolocation.latitude", -90, 90),
    longitude: finiteNumber(source.longitude, "geolocation.longitude", -180, 180),
    accuracy: finiteNumber(source.accuracy, "geolocation.accuracy", 0, Number.POSITIVE_INFINITY),
    altitude: nullableNumber(source.altitude, "geolocation.altitude", Number.NEGATIVE_INFINITY),
    altitudeAccuracy: nullableNumber(source.altitudeAccuracy, "geolocation.altitudeAccuracy", 0),
    speed: nullableNumber(source.speed, "geolocation.speed", 0),
    heading: nullableNumber(source.heading, "geolocation.heading", 0, 360, true)
  });
}

function locale(value: unknown): string {
  const canonical = languageTag(value, "locale");
  if (!Intl.DateTimeFormat.supportedLocalesOf([canonical], { localeMatcher: "lookup" }).length ||
      !Intl.NumberFormat.supportedLocalesOf([canonical], { localeMatcher: "lookup" }).length) {
    invalid("locale", "unsupported_locale", "локаль не поддерживается форматированием дат или чисел в текущем окружении.");
  }
  return canonical;
}

function timeZone(value: unknown): string {
  const identifier = text(value, "timeZone");
  // Intl in newer engines also accepts numeric offsets: this model requires a named zone.
  if (!/^[A-Za-z][A-Za-z0-9._+-]*(?:\/[A-Za-z0-9._+-]+)*$/.test(identifier)) {
    invalid("timeZone", "named_time_zone", "нужен именованный timezone ID, например Europe/Berlin или UTC.");
  }
  try { new Intl.DateTimeFormat("en-US", { timeZone: identifier }); }
  catch { invalid("timeZone", "unsupported_time_zone", "timezone ID не поддерживается текущим Intl."); }
  // Preserve a supported named ID instead of persisting a computed UTC offset.
  return identifier;
}

export function parseProfileDraft(value: unknown): ProfileDraft {
  const source = object(value, "profile");
  knownKeys(source, DRAFT_KEYS, "profile");
  const name = text(source.name, "name");
  if (name.length > 80) invalid("name", "length", "длина имени не должна превышать 80 символов.");
  return Object.freeze({
    name, geolocation: geolocation(source.geolocation), languages: normalizeLanguages(source.languages),
    locale: locale(source.locale), timeZone: timeZone(source.timeZone), keyboardLayout: parseKeyboardLayout(source.keyboardLayout)
  });
}

function parseKeyboardLayout(value: unknown): KeyboardLayoutId {
  // Schema v1 profiles saved before I19 retain native behavior without a write.
  if (value === undefined) return "native";
  if (!isKeyboardLayoutId(value)) invalid("keyboardLayout", "keyboard_layout", "выберите карту из каталога или системную карту без подмены.");
  return value;
}

export function validateExpectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid("expectedRevision", "revision", "ожидается целое безопасное число от 0; 0 означает отсутствие профиля.");
  }
  return value;
}

export function profileToDraft(profile: RegionalProfile): ProfileDraft {
  return parseProfileDraft({
    name: profile.name, geolocation: profile.geolocation, languages: profile.languages,
    locale: profile.locale, timeZone: profile.timeZone, keyboardLayout: profile.keyboardLayout
  });
}

export function createRegionalProfile(draft: unknown, revision: number): RegionalProfile {
  const normalized = parseProfileDraft(draft);
  if (!Number.isSafeInteger(revision) || revision < 1) invalid("revision", "revision", "ожидается положительное безопасное целое число.");
  return Object.freeze({
    schemaVersion: PROFILE_SCHEMA_VERSION, revision, ...normalized, language: normalized.languages[0]!
  });
}

export function parseRegionalProfile(value: unknown): RegionalProfile {
  const source = object(value, "profile");
  knownKeys(source, [...DRAFT_KEYS, "schemaVersion", "revision", "language"], "profile");
  if (source.schemaVersion !== PROFILE_SCHEMA_VERSION) invalid("schemaVersion", "unsupported_schema", "версия схемы профиля не поддерживается.");
  if (typeof source.revision !== "number" || !Number.isSafeInteger(source.revision) || source.revision < 1) invalid("revision", "revision", "ожидается положительное безопасное целое число.");
  const parsed = createRegionalProfile({
    name: source.name, geolocation: source.geolocation, languages: source.languages,
    locale: source.locale, timeZone: source.timeZone, keyboardLayout: source.keyboardLayout
  }, source.revision);
  if (source.language !== parsed.language) invalid("language", "inconsistent_language", "language должен совпадать с первым каноническим элементом languages.");
  return parsed;
}
