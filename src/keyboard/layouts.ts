export const KEYBOARD_LAYOUT_IDS = ["native", "us-qwerty", "de-qwertz", "ru-jcuken"] as const;
export type KeyboardLayoutId = typeof KEYBOARD_LAYOUT_IDS[number];
export interface KeyboardLayout {
  readonly id: KeyboardLayoutId;
  readonly label: string;
  readonly entries: readonly (readonly [string, string])[];
}

const ROWS = [
  ["Backquote", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0", "Minus", "Equal"],
  ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"],
  ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Backslash"],
  ["IntlBackslash", "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"], ["Space"]
] as const;
// Unmodified Windows PC writing-system keys, verified against Unicode CLDR 41.
// Dead-key labels use standalone characters; modifiers, IME and events are native.
function layout(id: KeyboardLayoutId, label: string, rows: readonly string[]): KeyboardLayout {
  const entries = ROWS.flatMap((codes, row) => {
    const values = [...rows[row]!];
    if (values.length !== codes.length) throw new Error("Некорректная карта раскладки " + id);
    return codes.map((code, index) => Object.freeze([code, values[index]!] as const));
  });
  return Object.freeze({ id, label, entries: Object.freeze(entries) });
}
export const KEYBOARD_LAYOUTS: readonly KeyboardLayout[] = Object.freeze([
  Object.freeze({ id: "native" as const, label: "Системная карта (без подмены)", entries: Object.freeze([]) }),
  layout("us-qwerty", "Английская — US QWERTY", ["`1234567890-=", "qwertyuiop[]", "asdfghjkl;'\\", "\\zxcvbnm,./", " "]),
  layout("de-qwertz", "Немецкая — DE QWERTZ", ["^1234567890ß´", "qwertzuiopü+", "asdfghjklöä#", "<yxcvbnm,.-", " "]),
  layout("ru-jcuken", "Русская — RU ЙЦУКЕН", ["ё1234567890-=", "йцукенгшщзхъ", "фывапролджэ\\", "\\ячсмитьбю.", " "])
]);
export function isKeyboardLayoutId(value: unknown): value is KeyboardLayoutId {
  return typeof value === "string" && (KEYBOARD_LAYOUT_IDS as readonly string[]).includes(value);
}
export function keyboardLayout(id: KeyboardLayoutId): KeyboardLayout {
  const found = KEYBOARD_LAYOUTS.find((entry) => entry.id === id);
  if (!found) throw new Error("Неизвестная карта раскладки.");
  return found;
}
