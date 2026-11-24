export function installLanguageRuntime(profile: { language: string; languages: readonly string[] }): void {
  const prototype = Navigator.prototype;
  const language = Object.getOwnPropertyDescriptor(prototype, "language");
  const languages = Object.getOwnPropertyDescriptor(prototype, "languages");
  if (!language?.get || !languages?.get || !language.configurable || !languages.configurable) throw new Error("Свойства языка браузера недоступны для переопределения.");
  const nativeLanguage = language.get;
  const nativeLanguages = languages.get;
  const primary = profile.language;
  const values = Object.freeze([...profile.languages]);
  try {
    Object.defineProperty(prototype, "language", { ...language, get: function language() { nativeLanguage.call(this); return primary; } });
    Object.defineProperty(prototype, "languages", { ...languages, get: function languages() { nativeLanguages.call(this); return Object.freeze([...values]); } });
  } catch (error) {
    Object.defineProperty(prototype, "language", language);
    Object.defineProperty(prototype, "languages", languages);
    throw error;
  }
}
