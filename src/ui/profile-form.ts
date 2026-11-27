import { parseProfileDraft } from "../profile/validation";
import type { ProfileDraft } from "../profile/types";

export const PROFILE_FIELDS = ["name", "latitude", "longitude", "accuracy", "altitude", "altitudeAccuracy", "speed", "heading", "languages", "locale", "timeZone", "keyboardLayout"] as const;
export type ProfileField = typeof PROFILE_FIELDS[number];
export type ProfileFields = Record<ProfileField, string>;
export const PROFILE_FIELD_LABELS: Readonly<Record<ProfileField, string>> = Object.freeze({
  name: "Название", latitude: "Широта", longitude: "Долгота", accuracy: "Точность", altitude: "Высота", altitudeAccuracy: "Точность высоты",
  speed: "Скорость", heading: "Направление", languages: "Языки", locale: "Локаль форматов", timeZone: "Часовой пояс", keyboardLayout: "Карта раскладки"
});
export function profileFieldForPath(path: string): ProfileField | undefined {
  const field = path.replace(/^geolocation\./, "").replace(/\[\d+\]$/, "");
  return (PROFILE_FIELDS as readonly string[]).includes(field) ? field as ProfileField : undefined;
}
function number(value: string, nullable = false): number | null | undefined {
  const text = value.trim();
  if (!text) return undefined;
  if (nullable && /^(unknown|неизвестно)$/i.test(text)) return null;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return NaN;
  return Number(text.replace(",", "."));
}
export function profileDraftFromFields(fields: ProfileFields): ProfileDraft {
  return parseProfileDraft({
    name: fields.name, geolocation: {
      latitude: number(fields.latitude), longitude: number(fields.longitude), accuracy: number(fields.accuracy),
      altitude: number(fields.altitude, true), altitudeAccuracy: number(fields.altitudeAccuracy, true), speed: number(fields.speed, true), heading: number(fields.heading, true)
    },
    ...(fields.languages.trim() ? { languages: fields.languages.trim().split(/[\s,]+/).filter(Boolean) } : {}),
    ...(fields.locale.trim() ? { locale: fields.locale } : {}), ...(fields.timeZone.trim() ? { timeZone: fields.timeZone } : {}), keyboardLayout: fields.keyboardLayout
  });
}
export function profileToFields(profile: ProfileDraft | null): ProfileFields {
  const geo = (name: keyof ProfileDraft["geolocation"]): string => {
    const value = profile?.geolocation[name];
    return value === null ? "unknown" : value === undefined ? "" : String(value);
  };
  return {
    name: profile?.name ?? "", latitude: geo("latitude"), longitude: geo("longitude"), accuracy: geo("accuracy"), altitude: geo("altitude"), altitudeAccuracy: geo("altitudeAccuracy"),
    speed: geo("speed"), heading: geo("heading"), languages: profile?.languages?.join(", ") ?? "",
    locale: profile?.locale ?? "", timeZone: profile?.timeZone ?? "", keyboardLayout: profile?.keyboardLayout ?? "native"
  };
}
