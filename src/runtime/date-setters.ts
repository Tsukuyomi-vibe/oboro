import { CalendarEngine, type DateComponents, type LocalFields } from "./calendar";

const SETTERS = [
  ["setDate", [2]], ["setFullYear", [0, 1, 2]], ["setHours", [3, 4, 5, 6]],
  ["setMilliseconds", [6]], ["setMinutes", [4, 5, 6]], ["setMonth", [1, 2]],
  ["setSeconds", [5, 6]], ["setYear", [0]]
] as const;
const INVALID_BASE: LocalFields = Object.freeze({
  year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0,
  dayOfWeek: 4, offsetNanoseconds: 0, timezoneOffset: 0
});
export function createDateSetters(calendar: CalendarEngine, NativeDate: DateConstructor): Record<string, Function> {
  const getTime = NativeDate.prototype.getTime;
  const setTime = NativeDate.prototype.setTime;
  const result: Record<string, Function> = {};
  for (const [name, indices] of SETTERS) {
    const original = Object.getOwnPropertyDescriptor(NativeDate.prototype, name)?.value as unknown;
    if (typeof original !== "function") {
      if (name === "setYear") continue; // Optional Annex B surface.
      throw new Error("Отсутствует Date." + name);
    }
    result[name] = new Proxy(original, { apply(_target, receiver, args) {
      // Read the internal value before argument conversion: user valueOf can
      // mutate this same Date, but omitted fields still come from this snapshot.
      const instant = Reflect.apply(getTime, receiver, []) as number;
      const values: number[] = [];
      for (let index = 0; index < Math.min(Math.max(args.length, 1), indices.length); index++) values.push(+(args[index] as number));
      const recoverInvalid = name === "setFullYear" || name === "setYear";
      // Native non-recovering setters return NaN without a write here. Preserve
      // any mutation performed by an argument's conversion on an invalid Date.
      if (Number.isNaN(instant) && !recoverInvalid) return NaN;
      const fields = Number.isNaN(instant) ? INVALID_BASE : calendar.instantToLocal(instant);
      const parts = [fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second, fields.millisecond];
      for (let index = 0; index < values.length; index++) parts[indices[index]!] = values[index]!;
      if (name === "setYear") {
        const year = Math.trunc(parts[0]!);
        if (year >= 0 && year <= 99) parts[0] = 1900 + year;
      }
      const updated = calendar.dateComponentsToInstant(parts as unknown as DateComponents);
      return Reflect.apply(setTime, receiver, [updated]);
    } });
  }
  return result;
}
