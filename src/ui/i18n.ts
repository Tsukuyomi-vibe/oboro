// The head script owns UI preferences and live translations. These helpers are
// deliberately used only by extension pages, never by the page runtime/worker.
interface UITranslations {
  translate(source: string, ...values: readonly unknown[]): string;
  setText(element: Element, source: string, ...values: readonly unknown[]): void;
  setPlainText(element: Element, value: string): void;
}
declare global { interface Window { oboroI18n?: UITranslations; } }

export function translate(source: string, ...values: readonly unknown[]): string {
  return window.oboroI18n?.translate(source, ...values) ?? source.replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)] ?? ""));
}
export function setText(element: Element, source: string, ...values: readonly unknown[]): void {
  if (window.oboroI18n) window.oboroI18n.setText(element, source, ...values);
  else element.textContent = translate(source, ...values);
}
export function setPlainText(element: Element, value: string): void {
  if (window.oboroI18n) window.oboroI18n.setPlainText(element, value);
  else element.textContent = value;
}
