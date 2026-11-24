import { keyboardLayout, type KeyboardLayoutId } from "../keyboard/layouts";
import type { KeyboardStatus } from "./types";

type Callable = (...args: unknown[]) => unknown;
interface Patch { target: object; key: PropertyKey; before: PropertyDescriptor; after: PropertyDescriptor; }
export interface KeyboardInstallation { status: KeyboardStatus; reason?: string; rollback(): void; }

export function installKeyboardRuntime(id: KeyboardLayoutId): KeyboardInstallation {
  if (id === "native") return { status: "native", rollback() {} };
  const patches: Patch[] = []; const applied: Patch[] = [];
  let removeListener: (() => void) | undefined;
  const rollback = (): void => {
    removeListener?.(); removeListener = undefined;
    for (const patch of applied.reverse()) Object.defineProperty(patch.target, patch.key, patch.before);
    applied.length = 0;
  };
  const unsupported = (reason: string): KeyboardInstallation => ({ status: "unsupported", reason, rollback() {} });
  try {
    const keyboard = (navigator as unknown as { keyboard?: Record<string, unknown> }).keyboard;
    const constructor = (globalThis as unknown as { KeyboardLayoutMap?: { prototype?: object } }).KeyboardLayoutMap;
    if (!keyboard || typeof keyboard.getLayoutMap !== "function" || !constructor?.prototype) return unsupported("Keyboard Map API недоступен; карта раскладки не подменена.");
    if (globalThis.isSecureContext === false) return unsupported("Карта раскладки требует безопасного контекста.");
    const policy = (document as unknown as { permissionsPolicy?: { allowsFeature(name: string): boolean }; featurePolicy?: { allowsFeature(name: string): boolean } });
    const permissions = policy.permissionsPolicy ?? policy.featurePolicy;
    if (permissions && !permissions.allowsFeature("keyboard-map")) return unsupported("Permissions Policy запрещает keyboard-map; нативный отказ сохранён.");
    const addListener = keyboard.addEventListener; const remove = keyboard.removeEventListener;
    if (typeof addListener !== "function" || typeof remove !== "function") return unsupported("События Keyboard API не поддержаны.");
    const prototype = constructor.prototype;
    const size = Object.getOwnPropertyDescriptor(prototype, "size");
    if (typeof size?.get !== "function") return unsupported("KeyboardLayoutMap не поддерживает проверенный maplike-контракт.");
    const nativeSize = size.get;
    const selected = new Map(keyboardLayout(id).entries);
    const tagged = new WeakSet<object>();
    const then = Promise.prototype.then;
    const mapGet = Map.prototype.get; const mapHas = Map.prototype.has; const mapEach = Map.prototype.forEach;
    const iterators = { entries: Map.prototype.entries, keys: Map.prototype.keys, values: Map.prototype.values };
    const add = (target: object, key: PropertyKey, after: PropertyDescriptor): void => {
      const before = Object.getOwnPropertyDescriptor(target, key);
      if (!before || (!before.configurable && ("get" in after || !before.writable))) throw new Error("Нельзя переопределить Keyboard API: " + String(key));
      patches.push({ target, key, before, after: { ...before, ...after } });
    };
    add(prototype, "size", { get: new Proxy(nativeSize, { apply(target, receiver, args) {
      const native = Reflect.apply(target, receiver, args);
      return tagged.has(receiver as object) ? selected.size : native;
    } }) });
    const aliases = new Map<Callable, Callable>();
    for (const key of ["get", "has", "entries", "keys", "values", "forEach", Symbol.iterator] as const) {
      const original = Object.getOwnPropertyDescriptor(prototype, key)?.value as unknown;
      if (typeof original !== "function") return unsupported("KeyboardLayoutMap не поддерживает " + String(key));
      const operation = key === Symbol.iterator ? "entries" : key;
      let proxy = aliases.get(original as Callable);
      if (!proxy) {
        proxy = new Proxy(original as Callable, { apply(target, receiver, args) {
          Reflect.apply(nativeSize, receiver, []); // Native brand check, without coercing the key twice.
          if (!tagged.has(receiver as object)) return Reflect.apply(target, receiver, args);
          if (operation === "get" || operation === "has") {
            if (!args.length) throw new TypeError("Требуется один аргумент KeyboardLayoutMap." + operation);
            if (typeof args[0] === "symbol") throw new TypeError("Cannot convert a Symbol value to a string");
            const code = String(args[0]);
            return Reflect.apply(operation === "get" ? mapGet : mapHas, selected, [code]);
          }
          if (operation === "forEach") {
            const callback = args[0]; const thisArg = args[1];
            if (typeof callback !== "function") throw new TypeError("Callback должен быть функцией.");
            Reflect.apply(mapEach, selected, [(value: string, code: string) => Reflect.apply(callback, thisArg, [value, code, receiver])]);
            return undefined;
          }
          return Reflect.apply(iterators[operation], selected, []);
        } });
        aliases.set(original as Callable, proxy);
      }
      add(prototype, key, { value: proxy });
    }
    let owner: object | null = keyboard;
    while (owner && !Object.hasOwn(owner, "getLayoutMap")) owner = Object.getPrototypeOf(owner) as object | null;
    if (!owner) return unsupported("Метод Keyboard.getLayoutMap недоступен.");
    const original = keyboard.getLayoutMap as Callable;
    add(owner, "getLayoutMap", { value: new Proxy(original, { apply(target, receiver, args) {
      const promise = Reflect.apply(target, receiver, args); // Keep native policy, focus and receiver errors.
      return Reflect.apply(then, promise, [(map: object) => {
        Reflect.apply(nativeSize, map, []);
        tagged.add(map); return map; // Preserve native class, prototype and cache identity.
      }]);
    } }) });
    for (const patch of patches) { Object.defineProperty(patch.target, patch.key, patch.after); applied.push(patch); }
    const onLayoutChange = (event: Event): void => {
      // The virtual map is fixed for this document. Keep page-created events native.
      if (event.isTrusted) event.stopImmediatePropagation();
    };
    Reflect.apply(addListener, keyboard, ["layoutchange", onLayoutChange, true]);
    removeListener = () => { Reflect.apply(remove, keyboard, ["layoutchange", onLayoutChange, true]); };
    return { status: "installed", rollback };
  } catch (error) {
    try { rollback(); }
    catch { return { status: "error", reason: "Не удалось откатить Keyboard API; перезагрузите документ.", rollback }; }
    return { status: "error", reason: error instanceof Error ? error.message : "Ошибка карты раскладки.", rollback() {} };
  }
}
