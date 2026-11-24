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
function number(value: string, optional = false): number | null {
  const text = value.trim();
  if (!text && optional) return null;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(text)) return NaN;
  return Number(text.replace(",", "."));
}
export function profileDraftFromFields(fields: ProfileFields): ProfileDraft {
  return parseProfileDraft({
    name: fields.name, geolocation: {
      latitude: number(fields.latitude), longitude: number(fields.longitude), accuracy: number(fields.accuracy),
      altitude: number(fields.altitude, true), altitudeAccuracy: number(fields.altitudeAccuracy, true), speed: number(fields.speed, true), heading: number(fields.heading, true)
    },
    languages: fields.languages.trim() ? fields.languages.trim().split(/[\s,]+/).filter(Boolean) : [],
    locale: fields.locale, timeZone: fields.timeZone, keyboardLayout: fields.keyboardLayout
  });
}
export function profileToFields(profile: ProfileDraft | null): ProfileFields {
  return {
    name: profile?.name ?? "", latitude: profile ? String(profile.geolocation.latitude) : "", longitude: profile ? String(profile.geolocation.longitude) : "",
    accuracy: profile ? String(profile.geolocation.accuracy) : "1000", altitude: String(profile?.geolocation.altitude ?? ""), altitudeAccuracy: String(profile?.geolocation.altitudeAccuracy ?? ""),
    speed: String(profile?.geolocation.speed ?? ""), heading: String(profile?.geolocation.heading ?? ""), languages: profile?.languages.join(", ") ?? "",
    locale: profile?.locale ?? "", timeZone: profile?.timeZone ?? "", keyboardLayout: profile?.keyboardLayout ?? "native"
  };
}
