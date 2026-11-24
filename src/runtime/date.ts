import { CalendarEngine, verifyCalendarEngine, type LocalFields } from "./calendar";
import { createDateConstruction } from "./date-construction";
import { createDateSetters } from "./date-setters";
const NativeDateTimeFormat = Intl.DateTimeFormat;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const pad = (value: number, length = 2): string => String(value).padStart(length, "0");

export function installDateRuntime(calendar: CalendarEngine): () => void {
  verifyCalendarEngine();
  const NativeDate = Date;
  const getTime = NativeDate.prototype.getTime;
  const now = NativeDate.now;
  const construction = createDateConstruction(calendar, NativeDate);
  const setters = createDateSetters(calendar, NativeDate);
  const zoneNames = new NativeDateTimeFormat("en-US", { timeZone: calendar.timeZone, timeZoneName: "long" });
  const patches: { target: object; key: string; descriptor: PropertyDescriptor; value: unknown }[] = [];
  const add = (target: object, key: string, value: unknown): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || (!descriptor.configurable && !descriptor.writable)) throw new Error("Недоступен метод времени: " + key);
    patches.push({ target, key, descriptor, value });
  };
  const dateString = (fields: LocalFields): string => {
    const year = fields.year < 0 ? "-" + pad(-fields.year, 4) : pad(fields.year, 4);
    return DAYS[fields.dayOfWeek] + " " + MONTHS[fields.month - 1] + " " + pad(fields.day) + " " + year;
  };
  const timeString = (instant: number, fields: LocalFields): string => {
    const minutes = Math.trunc(Math.abs(fields.offsetNanoseconds) / 60_000_000_000);
    const offset = (fields.offsetNanoseconds < 0 ? "-" : "+") + pad(Math.floor(minutes / 60)) + pad(minutes % 60);
    const name = zoneNames.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? calendar.timeZone;
    return pad(fields.hour) + ":" + pad(fields.minute) + ":" + pad(fields.second) + " GMT" + offset + " (" + name + ")";
  };
  const fullString = (instant: number): string => {
    if (Number.isNaN(instant)) return "Invalid Date";
    const fields = calendar.instantToLocal(instant);
    return dateString(fields) + " " + timeString(instant, fields);
  };
  const getters: Record<string, (fields: LocalFields) => number> = {
    getFullYear: (fields) => fields.year, getYear: (fields) => fields.year - 1900,
    getMonth: (fields) => fields.month - 1, getDate: (fields) => fields.day,
    getDay: (fields) => fields.dayOfWeek, getHours: (fields) => fields.hour,
    getMinutes: (fields) => fields.minute, getSeconds: (fields) => fields.second,
    getMilliseconds: (fields) => fields.millisecond,
    getTimezoneOffset: (fields) => Math.trunc(fields.timezoneOffset) || 0
  };
  for (const [key, read] of Object.entries(getters)) {
    const original = Object.getOwnPropertyDescriptor(NativeDate.prototype, key)?.value as unknown;
    if (typeof original !== "function") throw new Error("Отсутствует Date." + key);
    add(NativeDate.prototype, key, new Proxy(original, { apply(_target, receiver) {
      const instant = Reflect.apply(getTime, receiver, []) as number;
      return Number.isNaN(instant) ? NaN : read(calendar.instantToLocal(instant));
    } }));
  }
  for (const key of ["toString", "toDateString", "toTimeString"]) {
    const original = Object.getOwnPropertyDescriptor(NativeDate.prototype, key)?.value as unknown;
    if (typeof original !== "function") throw new Error("Отсутствует Date." + key);
    add(NativeDate.prototype, key, new Proxy(original, { apply(_target, receiver) {
      const instant = Reflect.apply(getTime, receiver, []) as number;
      if (Number.isNaN(instant)) return "Invalid Date";
      if (key === "toString") return fullString(instant);
      const fields = calendar.instantToLocal(instant);
      return key === "toDateString" ? dateString(fields) : timeString(instant, fields);
    } }));
  }
  const proxy = new Proxy(NativeDate, {
    apply() { return fullString(Reflect.apply(now, NativeDate, []) as number); },
    construct(_target, args, newTarget) { return construction.construct(args, newTarget); }
  });
  add(NativeDate, "parse", construction.parse);
  for (const [name, method] of Object.entries(setters)) add(NativeDate.prototype, name, method);
  add(NativeDate.prototype, "constructor", proxy);
  add(globalThis, "Date", proxy);
  const applied: typeof patches = [];
  const rollback = (): void => {
    for (const patch of applied.reverse()) Object.defineProperty(patch.target, patch.key, patch.descriptor);
    applied.length = 0;
  };
  try {
    for (const patch of patches) {
      Object.defineProperty(patch.target, patch.key, { ...patch.descriptor, value: patch.value });
      applied.push(patch);
    }
    return rollback;
  } catch (error) {
    rollback();
    throw error;
  }
}
