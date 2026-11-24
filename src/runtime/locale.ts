type NativeFunction = (...args: unknown[]) => unknown;
interface Patch { target: object; key: string; descriptor: PropertyDescriptor; value: unknown; }
const CONSTRUCTORS = ["Collator", "DateTimeFormat", "NumberFormat", "PluralRules", "RelativeTimeFormat", "ListFormat", "DisplayNames", "Segmenter", "DurationFormat"] as const;

export function installLocaleRuntime(locale: string, timeZone?: string): () => void {
  const intl = Intl as unknown as Record<string, unknown>;
  const canonicalize = Intl.getCanonicalLocales.bind(Intl);
  const concat = String.prototype.concat;
  const dateValue = Date.prototype.getTime;
  const numberValue = Number.prototype.valueOf;
  const bigintValue = globalThis.BigInt?.prototype.valueOf;
  const patches: Patch[] = [];
  const locales = (value: unknown): string[] => {
    const list = canonicalize(value as string | string[] | undefined);
    return list.length ? list : [locale];
  };
  const dateOptions = (value: unknown): unknown => {
    if (timeZone === undefined) return value;
    if (value === null) throw new TypeError("Date formatting options must not be null.");
    const source = value === undefined ? Object.create(null) as object : Object(value) as object;
    // An empty facade avoids Proxy invariants for frozen own properties and
    // preserves getter receivers and native option-read order on the source.
    return new Proxy(Object.create(null) as object, {
      get(_target, key) {
        const result = Reflect.get(source, key, source) as unknown;
        return key === "timeZone" && result === undefined ? timeZone : result;
      }
    });
  };
  const text = (value: unknown): string => Reflect.apply(concat, "", [value]) as string;
  const receiverText = (value: unknown): string => {
    if (value === null || value === undefined) throw new TypeError("String method called on null or undefined");
    return text(value);
  };
  const add = (target: object, key: string, value: unknown): void => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor || (!descriptor.configurable && !descriptor.writable)) throw new Error("Недоступен метод форматирования: " + key);
    patches.push({ target, key, descriptor, value });
  };
  for (const name of CONSTRUCTORS) {
    const original = intl[name];
    if (typeof original !== "function") continue;
    const callable = ["Collator", "DateTimeFormat", "NumberFormat"].includes(name);
    const proxy = new Proxy(original, {
      construct(target, args, newTarget) {
        const next = [...args]; next[0] = locales(args[0]);
        if (name === "DateTimeFormat") next[1] = dateOptions(args[1]);
        return Reflect.construct(target, next, newTarget);
      },
      apply(target, thisArg, args) {
        if (!callable) return Reflect.apply(target, thisArg, args);
        const next = [...args]; next[0] = locales(args[0]);
        if (name === "DateTimeFormat") next[1] = dateOptions(args[1]);
        return Reflect.apply(target, thisArg, next);
      }
    });
    add(intl, name, proxy);
    const prototype = original.prototype as object;
    if (Object.getOwnPropertyDescriptor(prototype, "constructor")?.value === original) add(prototype, "constructor", proxy);
  }
  function method(target: object, key: string, run: (native: NativeFunction, receiver: unknown, args: unknown[]) => unknown): void {
    const original = Object.getOwnPropertyDescriptor(target, key)?.value as unknown;
    if (typeof original !== "function") return;
    const proxy = new Proxy(original, { apply: (native, receiver, args) => run(native as NativeFunction, receiver, args) });
    add(target, key, proxy);
  }
  method(Number.prototype, "toLocaleString", (native, receiver, args) => {
    Reflect.apply(numberValue, receiver, []);
    return Reflect.apply(native, receiver, [locales(args[0]), args[1]]);
  });
  if (bigintValue) method(BigInt.prototype, "toLocaleString", (native, receiver, args) => {
    Reflect.apply(bigintValue, receiver, []);
    return Reflect.apply(native, receiver, [locales(args[0]), args[1]]);
  });
  for (const key of ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]) method(Date.prototype, key, (native, receiver, args) => {
    const value = Reflect.apply(dateValue, receiver, []) as number;
    if (Number.isNaN(value)) return Reflect.apply(native, receiver, args);
    return Reflect.apply(native, receiver, [locales(args[0]), dateOptions(args[1])]);
  });
  method(String.prototype, "localeCompare", (native, receiver, args) => {
    const left = receiverText(receiver); const right = text(args[0]);
    return Reflect.apply(native, left, [right, locales(args[1]), args[2]]);
  });
  for (const key of ["toLocaleLowerCase", "toLocaleUpperCase"]) method(String.prototype, key, (native, receiver, args) =>
    Reflect.apply(native, receiverText(receiver), [locales(args[0])]));
  const applied: Patch[] = [];
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
