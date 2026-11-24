import { CalendarEngine, dateWallTime, timeClip, type DateComponents } from "./calendar";

const ISO = /^(\d{4}|[+-]\d{6})(?:-(\d{2})(?:-(\d{2}))?)?(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const LOCAL_STRING = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}) (-?\d{4,6}) (\d{2}):(\d{2}):(\d{2}) GMT([+-])(\d{2})(\d{2})(?: \([^\r\n]*\))?$/;
const UTC_STRING = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (-?\d{4,6}) (\d{2}):(\d{2}):(\d{2}) GMT$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DATE_PARSING_POLICY = "ISO date-only=UTC; zone-less ISO date-time=profile; explicit offsets preserved; Date string/UTC string accepted; other strings rejected.";

function primitive(value: unknown): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const exotic = Reflect.get(value, Symbol.toPrimitive) as unknown;
  if (exotic !== undefined && exotic !== null) {
    if (typeof exotic !== "function") throw new TypeError("Symbol.toPrimitive is not callable");
    const result: unknown = Reflect.apply(exotic, value, ["default"]);
    if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
    throw new TypeError("Cannot convert object to primitive value");
  }
  for (const name of ["valueOf", "toString"]) {
    const method = Reflect.get(value, name) as unknown;
    if (typeof method !== "function") continue;
    const result: unknown = Reflect.apply(method, value, []);
    if (result === null || (typeof result !== "object" && typeof result !== "function")) return result;
  }
  throw new TypeError("Cannot convert object to primitive value");
}
function validFields(parts: DateComponents): boolean {
  return parts[1] >= 0 && parts[1] <= 11 && parts[2] >= 1 && parts[2] <= 31
    && parts[3] >= 0 && parts[3] <= 24 && parts[4] < 60 && parts[5] < 60
    && (parts[3] !== 24 || parts[4] === 0 && parts[5] === 0 && parts[6] === 0);
}
export function createDateConstruction(calendar: CalendarEngine, NativeDate: DateConstructor) {
  const getTime = NativeDate.prototype.getTime;
  const concat = String.prototype.concat;
  const toText = (value: unknown): string => Reflect.apply(concat, "", [value]) as string;
  function parseText(text: string): number {
    const iso = ISO.exec(text);
    if (iso) {
      if (iso[1] === "-000000") return NaN;
      const fraction = iso[7] ?? "";
      const parts: DateComponents = [Number(iso[1]), Number(iso[2] ?? 1) - 1, Number(iso[3] ?? 1),
        Number(iso[4] ?? 0), Number(iso[5] ?? 0), Number(iso[6] ?? 0), Number(fraction.slice(0, 3).padEnd(3, "0"))];
      if (!validFields(parts) || parts[3] === 24 && /[1-9]/.test(fraction)) return NaN;
      if (iso[4] === undefined) return timeClip(dateWallTime(parts));
      const zone = iso[8];
      if (zone === undefined) return calendar.dateComponentsToInstant(parts);
      if (zone === "Z") return timeClip(dateWallTime(parts));
      const hour = Number(zone.slice(1, 3));
      const minute = Number(zone.slice(-2));
      if (hour > 23 || minute > 59) return NaN;
      const offset = (zone[0] === "-" ? -1 : 1) * (hour * 60 + minute) * 60_000;
      return timeClip(dateWallTime(parts) - offset);
    }
    const local = LOCAL_STRING.exec(text);
    if (local) {
      const parts: DateComponents = [Number(local[4]), MONTHS.indexOf(local[2]!), Number(local[3]), Number(local[5]), Number(local[6]), Number(local[7]), 0];
      const hour = Number(local[9]); const minute = Number(local[10]);
      if (!validFields(parts) || parts[3] === 24 || hour > 23 || minute > 59) return NaN;
      return timeClip(dateWallTime(parts) - (local[8] === "-" ? -1 : 1) * (hour * 60 + minute) * 60_000);
    }
    const utc = UTC_STRING.exec(text);
    if (utc) {
      const parts: DateComponents = [Number(utc[4]), MONTHS.indexOf(utc[3]!), Number(utc[2]), Number(utc[5]), Number(utc[6]), Number(utc[7]), 0];
      return validFields(parts) && parts[3] !== 24 ? timeClip(dateWallTime(parts)) : NaN;
    }
    // No native fallback: its ambiguous local formats would use the system zone.
    return NaN;
  }
  function construct(args: unknown[], newTarget: Function): object {
    if (!args.length) return Reflect.construct(NativeDate, args, newTarget);
    if (args.length === 1) {
      let copied: number | undefined;
      try { copied = Reflect.apply(getTime, args[0], []) as number; } catch { /* not a Date with [[DateValue]] */ }
      const value = copied === undefined ? primitive(args[0]) : copied;
      const instant = typeof value === "string" ? parseText(value) : +(value as number);
      return Reflect.construct(NativeDate, [instant], newTarget);
    }
    const parts = [0, 0, 1, 0, 0, 0, 0];
    for (let index = 0; index < Math.min(args.length, 7); index++) parts[index] = +(args[index] as number);
    const year = Math.trunc(parts[0]!);
    if (year >= 0 && year <= 99) parts[0] = 1900 + year;
    const instant = calendar.dateComponentsToInstant(parts as unknown as DateComponents);
    return Reflect.construct(NativeDate, [instant], newTarget);
  }
  const parse = new Proxy(NativeDate.parse, { apply(_target, _receiver, args) { return parseText(toText(args[0])); } });
  return { construct, parse };
}
