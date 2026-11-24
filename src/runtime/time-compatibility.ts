import { CalendarEngine } from "./calendar";
import type { Temporal as TemporalAPI } from "@js-temporal/polyfill";
import type { TemporalStatus, TimeCompatibility } from "./types";

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function createTimeVerifier(calendar: CalendarEngine, locale: string): (temporal: TemporalStatus) => Readonly<TimeCompatibility> {
  const NativeDate = Date;
  const nativeNow = Date.now;
  const nativeUTC = Date.UTC;
  const getTime = Date.prototype.getTime;
  const valueOf = Date.prototype.valueOf;
  const iso = Date.prototype.toISOString;
  const json = Date.prototype.toJSON;
  const localeString = Date.prototype.toLocaleString;
  const NativeFormatter = Intl.DateTimeFormat;
  const utcMethods = Object.fromEntries(Object.getOwnPropertyNames(Date.prototype)
    .filter((name) => name.startsWith("getUTC") || name.startsWith("setUTC") || name === "setTime" || name === "toUTCString" || name === "toGMTString")
    .map((name) => [name, (Date.prototype as unknown as Record<string, unknown>)[name]]));
  const performanceNow = globalThis.performance?.now;
  const clone: unknown = (globalThis as unknown as Record<string, unknown>).structuredClone;
  const temporal = (globalThis as unknown as { Temporal?: typeof TemporalAPI }).Temporal;
  const originalInstant = temporal?.Now?.instant;
  return (temporalStatus) => {
    const checks: string[] = []; const failures: string[] = [];
    let cloneStatus: TimeCompatibility["structuredClone"] = "not_run";
    const check = (name: string, run: () => void): void => {
      try { run(); checks.push(name); }
      catch (error) { failures.push(name + ": " + (error instanceof Error ? error.message : String(error))); }
    };
    check("date.absolute", () => {
      ensure(Date.now === nativeNow && Date.UTC === nativeUTC, "Абсолютные Date API изменились.");
      ensure(Date.prototype.getTime === getTime && Date.prototype.valueOf === valueOf && Date.prototype.toISOString === iso && Date.prototype.toJSON === json, "Сериализация или timestamp Date изменились.");
      for (const [name, method] of Object.entries(utcMethods)) ensure((Date.prototype as unknown as Record<string, unknown>)[name] === method, "Изменён Date." + name);
      ensure(globalThis.performance?.now === performanceNow, "Изменён performance.now.");
    });
    for (const epoch of [1_705_320_000_123, 1_721_044_800_789]) {
      const label = epoch === 1_705_320_000_123 ? "winter" : "summer";
      const fields = calendar.instantToLocal(epoch);
      check("date.read." + label, () => {
        const date = new Date(epoch);
        const actual = [date.getFullYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(), date.getTimezoneOffset()];
        const expected = [fields.year, fields.month - 1, fields.day, fields.dayOfWeek, fields.hour, fields.minute, fields.second, fields.millisecond, Math.trunc(fields.timezoneOffset) || 0];
        ensure(actual.every((value, index) => value === expected[index]), "Локальные поля Date не совпадают с профилем.");
        ensure(date.getTime() === epoch && date.toISOString() === Reflect.apply(iso, new NativeDate(epoch), []), "Изменён instant Date.");
      });
      check("date.construct." + label, () => {
        const parts = [fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.millisecond] as const;
        ensure(new Date(...parts).getTime() === calendar.dateComponentsToInstant(parts), "Конструктор Date использует другую timezone.");
        ensure(Date.parse(new Date(epoch).toISOString()) === epoch, "Date.parse изменил явный UTC.");
      });
      check("date.setters." + label, () => {
        const date = new Date(epoch);
        const expected = calendar.dateComponentsToInstant([fields.year, fields.month - 1, fields.day + 1, fields.hour, fields.minute, fields.second, fields.millisecond]);
        ensure(date.setDate(fields.day + 1) === expected && date.getTime() === expected, "Setter Date не согласован с календарём.");
      });
      check("intl." + label, () => {
        const expected = new NativeFormatter(locale, { timeZone: calendar.timeZone });
        const actual = new Intl.DateTimeFormat();
        const resolved = actual.resolvedOptions();
        ensure(resolved.timeZone === expected.resolvedOptions().timeZone && resolved.locale === expected.resolvedOptions().locale, "Intl defaults не совпадают с профилем.");
        ensure(actual.format(epoch) === expected.format(epoch), "Intl форматирует в другой зоне.");
        ensure(new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(epoch) === new NativeFormatter("en-US", { timeZone: "UTC" }).format(epoch), "Изменена явная UTC zone.");
        const date = new Date(epoch);
        ensure(date.toLocaleString() === Reflect.apply(localeString, date, [locale, { timeZone: calendar.timeZone }]), "Date.toLocaleString не согласован с Intl.");
      });
    }
    check("date.serialization", () => {
      const date = new Date(1_705_320_000_123);
      ensure(JSON.stringify({ date, invalid: new Date(NaN) }) === '{"date":"2024-01-15T12:00:00.123Z","invalid":null}', "JSON Date не сохраняет instant/Invalid Date.");
      ensure(Number.isNaN(new Date(NaN).getTime()) && new Date(NaN).toString() === "Invalid Date", "Изменена Invalid Date.");
    });
    if (clone === undefined) { cloneStatus = "absent"; checks.push("structuredClone.absent"); }
    else {
      check("structuredClone", () => {
        cloneStatus = "failed";
        ensure(typeof clone === "function", "structuredClone присутствует без функции.");
        const original = new Date(1_705_320_000_123);
        const copied = Reflect.apply(clone, globalThis, [{ date: original, invalid: new Date(NaN) }]) as { date: Date; invalid: Date };
        ensure(copied.date !== original && Reflect.apply(getTime, copied.date, []) === original.getTime(), "structuredClone изменил timestamp.");
        ensure(Object.getPrototypeOf(copied.date) === Date.prototype && copied.date.getHours() === original.getHours(), "structuredClone использует другой realm Date.");
        ensure(Number.isNaN(Reflect.apply(getTime, copied.invalid, []) as number), "structuredClone изменил Invalid Date.");
        ensure((globalThis as unknown as Record<string, unknown>).structuredClone === clone, "structuredClone был подменён.");
        cloneStatus = "passed";
      });
    }
    if (temporalStatus === "absent") checks.push("temporal.absent");
    else check("temporal.now", () => {
      ensure(temporalStatus === "installed" && temporal?.Now, "Temporal.Now не установлен.");
      ensure(temporal.Now.instant === originalInstant, "Изменён Temporal.Now.instant.");
      ensure(temporal.Now.timeZoneId() === calendar.timeZone, "Temporal.Now использует системную зону.");
      const before = temporal.Now.instant();
      const zoned = temporal.Now.zonedDateTimeISO();
      const plain = temporal.Now.plainDateTimeISO();
      const date = temporal.Now.plainDateISO();
      const time = temporal.Now.plainTimeISO();
      const after = temporal.Now.instant();
      ensure(new NativeFormatter("en-US", { timeZone: zoned.timeZoneId }).resolvedOptions().timeZone === calendar.timeZone, "Temporal.Now.zonedDateTimeISO возвращает другую именованную зону.");
      const low = before.epochNanoseconds < after.epochNanoseconds ? before : after;
      const high = before.epochNanoseconds < after.epochNanoseconds ? after : before;
      ensure(zoned.epochNanoseconds >= low.epochNanoseconds && zoned.epochNanoseconds <= high.epochNanoseconds, "Temporal.Now изменил instant.");
      const beforeLocal = low.toZonedDateTimeISO(calendar.timeZone);
      const afterLocal = high.toZonedDateTimeISO(calendar.timeZone);
      const inRange = (compareBefore: number, compareAfter: number, wraps: boolean): boolean =>
        wraps ? compareBefore >= 0 || compareAfter <= 0 : compareBefore >= 0 && compareAfter <= 0;
      const { PlainDateTime, PlainDate, PlainTime } = temporal;
      ensure(inRange(PlainDateTime.compare(plain, beforeLocal.toPlainDateTime()), PlainDateTime.compare(plain, afterLocal.toPlainDateTime()),
        PlainDateTime.compare(beforeLocal.toPlainDateTime(), afterLocal.toPlainDateTime()) > 0), "Temporal.Now.plainDateTimeISO не согласован с зоной.");
      ensure(inRange(PlainDate.compare(date, beforeLocal.toPlainDate()), PlainDate.compare(date, afterLocal.toPlainDate()),
        PlainDate.compare(beforeLocal.toPlainDate(), afterLocal.toPlainDate()) > 0), "Temporal.Now.plainDateISO не согласован с зоной.");
      ensure(inRange(PlainTime.compare(time, beforeLocal.toPlainTime()), PlainTime.compare(time, afterLocal.toPlainTime()),
        PlainTime.compare(beforeLocal.toPlainTime(), afterLocal.toPlainTime()) > 0), "Temporal.Now.plainTimeISO не согласован с зоной.");
      const explicit = temporal.Now.zonedDateTimeISO("UTC");
      ensure(explicit.timeZoneId === "UTC", "Temporal.Now изменил явную UTC zone.");
      const expected = calendar.instantToLocal(zoned.epochMilliseconds);
      ensure(zoned.year === expected.year && zoned.month === expected.month && zoned.day === expected.day && zoned.hour === expected.hour && zoned.minute === expected.minute && zoned.second === expected.second, "Date/Intl/Temporal используют разные зоны.");
    });
    return Object.freeze({
      status: failures.length ? "failed" : "passed", structuredClone: cloneStatus,
      checks: Object.freeze(checks), failures: Object.freeze(failures)
    });
  };
}
