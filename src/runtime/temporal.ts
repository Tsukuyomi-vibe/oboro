import type { TemporalStatus } from "./types";

type Callable = (...args: unknown[]) => unknown;
const ZONED_METHODS = [
  ["zonedDateTimeISO", 0], ["plainDateTimeISO", 0], ["plainDateISO", 0], ["plainTimeISO", 0],
  ["zonedDateTime", 1], ["plainDateTime", 1], ["plainDate", 1], ["plainTime", 0]
] as const;
function object(value: unknown): value is Record<string, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
export interface TemporalInstallation {
  status: TemporalStatus;
  reason?: string;
  rollback(): void;
}
export function installTemporalRuntime(timeZone: string): TemporalInstallation {
  const temporal: unknown = (globalThis as unknown as Record<string, unknown>).Temporal;
  if (temporal === undefined) return { status: "absent", rollback() {} };
  if (!object(temporal) || !object(temporal.Now)) return { status: "unsupported", reason: "Temporal присутствует без поддерживаемого Temporal.Now.", rollback() {} };
  const now = temporal.Now;
  const required = ["instant", "timeZoneId", "zonedDateTimeISO", "plainDateTimeISO", "plainDateISO", "plainTimeISO"];
  if (required.some((name) => typeof now[name] !== "function") || typeof now.timeZone === "function") {
    return { status: "unsupported", reason: "Версия Temporal.Now не поддерживает проверенный набор методов.", rollback() {} };
  }
  const patches: { key: string; descriptor: PropertyDescriptor; value: Callable }[] = [];
  const add = (key: string, value: Callable): boolean => {
    const descriptor = Object.getOwnPropertyDescriptor(now, key);
    if (!descriptor || typeof descriptor.value !== "function" || (!descriptor.configurable && !descriptor.writable)) return false;
    patches.push({ key, descriptor, value });
    return true;
  };
  const originalId = now.timeZoneId as Callable;
  if (!add("timeZoneId", new Proxy(originalId, {
    apply(target, receiver, args) { Reflect.apply(target, receiver, args); return timeZone; }
  }))) return { status: "unsupported", reason: "Temporal.Now.timeZoneId нельзя переопределить.", rollback() {} };
  for (const [name, index] of ZONED_METHODS) {
    const original = now[name];
    if (typeof original !== "function") continue; // Never create absent optional methods.
    const proxy = new Proxy(original as Callable, {
      apply(target, receiver, args) {
        const next = [...args];
        if (next[index] === undefined) next[index] = timeZone;
        return Reflect.apply(target, receiver, next);
      }
    });
    if (!add(name, proxy)) return { status: "unsupported", reason: "Метод Temporal.Now." + name + " нельзя переопределить.", rollback() {} };
  }
  const applied: typeof patches = [];
  const rollback = (): void => {
    for (const patch of applied.reverse()) Object.defineProperty(now, patch.key, patch.descriptor);
    applied.length = 0;
  };
  try {
    for (const patch of patches) {
      Object.defineProperty(now, patch.key, { ...patch.descriptor, value: patch.value });
      applied.push(patch);
    }
    return { status: "installed", rollback };
  } catch (error) {
    rollback();
    return { status: "error", reason: error instanceof Error ? error.message : "Ошибка установки Temporal.Now.", rollback() {} };
  }
}
