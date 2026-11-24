import { Temporal } from "@js-temporal/polyfill";

// The polyfill and this reference are evaluated before any page Intl/Date wrappers.
const NativeDateTimeFormat = Intl.DateTimeFormat;
const NativeUTC = Date.UTC;
export const CALENDAR_COMPONENT = Object.freeze({
  name: "@js-temporal/polyfill", version: "0.5.1",
  timeZoneRules: "Browser Intl / ICU IANA data; no separate bundled tzdb",
  disambiguation: "compatible" as const
});
export type Disambiguation = "compatible" | "earlier" | "later" | "reject";
export type DateComponents = readonly [year: number, monthIndex: number, day: number, hour: number, minute: number, second: number, millisecond: number];
export const DATE_LIMIT = 8_640_000_000_000_000;
const DAY_MS = 86_400_000;
const GREGORIAN_CYCLE_MS = 146_097 * DAY_MS;
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334] as const;

/** MakeDay/MakeTime balance components before timezone conversion and TimeClip. */
export function dateWallTime(components: DateComponents): number {
  if (components.some((value) => !Number.isFinite(value))) return NaN;
  const [year, month, day, hour, minute, second, millisecond] = components.map(Math.trunc) as unknown as DateComponents;
  const shortYear = year >= 0 && year <= 99;
  const utcYear = shortYear ? year + 400 : year;
  const shift = shortYear ? GREGORIAN_CYCLE_MS : 0;
  const native = NativeUTC(utcYear, month, day, hour, minute, second, millisecond);
  if (Number.isFinite(native)) return native - shift;
  const fullYear = year + Math.floor(month / 12);
  const monthIndex = ((month % 12) + 12) % 12;
  const leap = fullYear % 4 === 0 && (fullYear % 100 !== 0 || fullYear % 400 === 0);
  const days = 365 * (fullYear - 1970) + Math.floor((fullYear - 1969) / 4)
    - Math.floor((fullYear - 1901) / 100) + Math.floor((fullYear - 1601) / 400)
    + MONTH_STARTS[monthIndex]! + (monthIndex >= 2 && leap ? 1 : 0) + day - 1;
  const wall = days * DAY_MS + (hour * 3_600_000 + minute * 60_000 + second * 1000 + millisecond);
  if (!Number.isFinite(wall)) return NaN;
  // Distinguish clipping from a native MakeDay rejection of extreme inputs.
  // The probe balances to the epoch but leaves the original year/month intact.
  const probe = NativeUTC(utcYear, month, day, hour, minute, second, millisecond - (wall + shift));
  return Number.isFinite(probe) ? wall : NaN;
}
export function timeClip(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > DATE_LIMIT) return NaN;
  const result = Math.trunc(value);
  return result === 0 ? 0 : result;
}
export interface LocalDateTime {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number; millisecond: number;
}
export interface LocalFields extends LocalDateTime {
  dayOfWeek: number;
  offsetNanoseconds: number;
  timezoneOffset: number;
}
export class CalendarEngine {
  readonly timeZone: string;
  private cached: { instant: number; fields: Readonly<LocalFields> } | null = null;
  constructor(timeZone: string) {
    if (typeof timeZone !== "string" || /^[+\-−]/.test(timeZone.trim())) throw new RangeError("A named time zone is required.");
    this.timeZone = new NativeDateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  }
  instantToLocal(instant: number): Readonly<LocalFields> {
    if (!Number.isSafeInteger(instant) || Math.abs(instant) > 8_640_000_000_000_000) throw new RangeError("Invalid Date instant.");
    if (this.cached?.instant === instant) return this.cached.fields;
    const date = Temporal.Instant.fromEpochMilliseconds(instant).toZonedDateTimeISO(this.timeZone);
    const offset = -date.offsetNanoseconds / 60_000_000_000;
    const fields = Object.freeze({
      year: date.year, month: date.month, day: date.day, hour: date.hour,
      minute: date.minute, second: date.second, millisecond: date.millisecond,
      dayOfWeek: date.dayOfWeek % 7, offsetNanoseconds: date.offsetNanoseconds,
      timezoneOffset: offset === 0 ? 0 : offset
    });
    this.cached = { instant, fields };
    return fields;
  }
  localToInstant(fields: LocalDateTime, disambiguation: Disambiguation = "compatible"): number {
    for (const key of ["year", "month", "day", "hour", "minute", "second", "millisecond"] as const) {
      if (!Number.isSafeInteger(fields[key])) throw new RangeError("Invalid local field: " + key);
    }
    return Temporal.ZonedDateTime.from({ ...fields, calendar: "iso8601", timeZone: this.timeZone },
      { disambiguation, overflow: "reject" }).epochMilliseconds;
  }
  dateComponentsToInstant(components: DateComponents): number {
    const wall = dateWallTime(components);
    // Named IANA offsets are less than one day. Do not clip the wall time
    // before applying that offset: a boundary Date can have out-of-range local fields.
    if (!Number.isSafeInteger(wall) || Math.abs(wall) > DATE_LIMIT + DAY_MS) return NaN;
    const anchor = Math.max(-DATE_LIMIT, Math.min(DATE_LIMIT, wall));
    try {
      const local = Temporal.Instant.fromEpochMilliseconds(anchor).toZonedDateTimeISO("UTC")
        .toPlainDateTime().add({ milliseconds: wall - anchor });
      return timeClip(local.toZonedDateTime(this.timeZone, { disambiguation: "compatible" }).epochMilliseconds);
    } catch (error) {
      if (error instanceof RangeError) {
        if (Math.abs(wall) < DATE_LIMIT - 2 * DAY_MS) return NaN;
        // The component rejects some valid Date wall times just beyond its
        // Instant range. At that boundary resolve only offsets observed by
        // the same IANA engine on the reachable side, without a second tzdb.
        const edge = wall < 0 ? -DATE_LIMIT : DATE_LIMIT;
        const offsets = new Set([0, 1, 2].map((days) => this.instantToLocal(edge + (wall < 0 ? 1 : -1) * days * DAY_MS).offsetNanoseconds / 1_000_000));
        const candidates = [...offsets].map((offset) => wall - offset);
        const exact = candidates.filter((instant) => Number.isFinite(timeClip(instant)) && instant + this.instantToLocal(instant).offsetNanoseconds / 1_000_000 === wall);
        return exact.length ? Math.min(...exact) : timeClip(Math.max(...candidates));
      }
      throw error;
    }
  }
}

let verified = false;
export function verifyCalendarEngine(): void {
  if (verified) return;
  for (const [zone, instant, hour, minute, offset] of [
    ["UTC", 1_705_320_000_000, 12, 0, 0],
    ["Europe/Berlin", 1_705_320_000_000, 13, 0, -60],
    ["Europe/Berlin", 1_721_044_800_000, 14, 0, -120],
    ["Asia/Kathmandu", 1_705_320_000_000, 17, 45, -345],
    ["America/New_York", 1_705_320_000_000, 7, 0, 300]
  ] as const) {
    const result = new CalendarEngine(zone).instantToLocal(instant);
    if (result.hour !== hour || result.minute !== minute || result.timezoneOffset !== offset) throw new Error("CalendarEngine self-check failed: " + zone);
  }
  const berlin = new CalendarEngine("Europe/Berlin");
  const gap = { year: 2024, month: 3, day: 31, hour: 2, minute: 30, second: 0, millisecond: 0 };
  const overlap = { ...gap, month: 10, day: 27 };
  if (berlin.localToInstant(gap) !== 1_711_848_600_000 || berlin.localToInstant(overlap) !== 1_729_989_000_000) throw new Error("CalendarEngine DST self-check failed.");
  if (berlin.dateComponentsToInstant([2024, 1, 30, 12, 0, 0, 0]) !== 1_709_290_800_000) throw new Error("CalendarEngine Date normalization self-check failed.");
  verified = true;
}
