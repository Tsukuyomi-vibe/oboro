import { setText } from "./i18n";
import { loadProfile, saveProfile, ProfileClientError } from "../profile/client";
import { getExampleProfileDraft } from "../profile/example";
import { PROFILE_STORAGE_KEY, ProfileValidationError, type RegionalProfile, type ValidationIssue } from "../profile/types";
import { KEYBOARD_LAYOUTS } from "../keyboard/layouts";
import { PROFILE_FIELDS, PROFILE_FIELD_LABELS, profileDraftFromFields, profileFieldForPath, profileToFields, type ProfileField, type ProfileFields } from "./profile-form";
import { PROFILE_DRAFT_EVENT, type ProfileDraftState } from "./profile-events";

export function mountProfileEditor(): void {
  const form = document.querySelector<HTMLFormElement>("#profile-form");
  const fields = document.querySelector<HTMLFieldSetElement>("#profile-fields");
  const feedback = document.getElementById("profile-save-feedback");
  const validation = document.getElementById("profile-validation");
  const state = document.getElementById("profile-draft-state");
  const save = document.querySelector<HTMLButtonElement>("#save-profile");
  const reload = document.querySelector<HTMLButtonElement>("#reload-profile");
  const example = document.querySelector<HTMLButtonElement>("#profile-example");
  const layout = form?.querySelector<HTMLSelectElement>('[name="keyboardLayout"]');
  if (!form || !fields || !feedback || !validation || !state || !save || !reload || !example || !layout) return;
  for (const entry of KEYBOARD_LAYOUTS) {
    const option = document.createElement("option"); option.value = entry.id; setText(option, entry.label); layout.append(option);
  }
  let baseline = ""; let revision = 0; let loaded = false; let busy = false; let stale = false;
  let requestVersion = 0; let attempted = false; let changedWhileSaving = false;
  const touched = new Set<ProfileField>();
  const input = (name: ProfileField): HTMLInputElement | HTMLSelectElement => form.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  const read = (): ProfileFields => Object.fromEntries(PROFILE_FIELDS.map((name) => [name, input(name).value])) as ProfileFields;
  const fill = (values: ProfileFields): void => { for (const name of PROFILE_FIELDS) input(name).value = values[name]; };
  const isDirty = (): boolean => loaded && JSON.stringify(read()) !== baseline;
  const renderIssues = (issues: readonly ValidationIssue[]): void => {
    const visible = issues.filter((issue) => attempted || touched.has(profileFieldForPath(issue.path) ?? "name"));
    for (const name of PROFILE_FIELDS) {
      const issue = visible.find((entry) => profileFieldForPath(entry.path) === name);
      input(name).setAttribute("aria-invalid", String(Boolean(issue)));
      const error = document.getElementById("profile-error-" + name);
      if (error) setText(error, issue?.message ?? "");
    }
    setText(validation, visible.map((issue) => `${PROFILE_FIELD_LABELS[profileFieldForPath(issue.path) ?? "name"]}: ${issue.message}`).join("\n"));
  };
  const validate = (): boolean => {
    try { profileDraftFromFields(read()); renderIssues([]); return true; }
    catch (error) {
      if (error instanceof ProfileValidationError) renderIssues(isDirty() || attempted ? error.issues : []);
      else setText(validation, String(error));
      return false;
    }
  };
  const update = (): void => {
    const dirty = isDirty(); const valid = loaded && validate();
    fields.disabled = !loaded || busy;
    save.disabled = !loaded || busy || stale;
    reload.disabled = busy;
    setText(state, !loaded ? "Загрузка сохранённого профиля…" : stale ? "Сохранённое состояние нужно перечитать. Правки оставлены в форме. Загрузите сохранённые значения перед новой записью."
      : dirty ? "Есть несохранённые изменения. Сохраните профиль перед применением."
        : revision ? `Сохранённая версия: ${revision}. Применение и перезагрузка выполняются отдельной кнопкой.` : "Профиль ещё не сохранён. Заполните поля или подставьте пример.");
    const detail: ProfileDraftState = { blocked: !loaded || dirty || stale, dirty, valid };
    window.dispatchEvent(new CustomEvent(PROFILE_DRAFT_EVENT, { detail }));
  };
  const accept = (profile: RegionalProfile | null): void => {
    revision = profile?.revision ?? 0; loaded = true; stale = false; attempted = false; touched.clear();
    fill(profileToFields(profile)); baseline = JSON.stringify(read()); update();
  };
  const refresh = async (force = false): Promise<void> => {
    const request = ++requestVersion;
    if (!force && isDirty()) { stale = true; update(); return; }
    const before = loaded ? JSON.stringify(read()) : "";
    try {
      const profile = await loadProfile();
      if (request !== requestVersion) return;
      if (loaded && JSON.stringify(read()) !== before) { stale = true; update(); return; }
      const changed = loaded && profile?.revision !== revision;
      accept(profile);
      if (changed) { setText(feedback, "Загружена новая сохранённая версия профиля. Проверьте значения перед применением."); delete feedback.dataset.kind; }
    } catch (error) {
      if (request !== requestVersion) return;
      stale = true; setText(feedback, error instanceof Error ? error.message : String(error)); feedback.dataset.kind = "error"; update();
    }
  };
  const edited = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
      if ((PROFILE_FIELDS as readonly string[]).includes(target.name)) touched.add(target.name as ProfileField);
    }
    setText(feedback, ""); update();
  };
  form.addEventListener("input", edited);
  form.addEventListener("change", edited);
  form.addEventListener("submit", (event) => {
    event.preventDefault(); attempted = true;
    if (!loaded || busy || stale) { update(); return; }
    if (!validate()) { form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); return; }
    const draft = profileDraftFromFields(read()); busy = true; update(); setText(feedback, "Сохранение…"); delete feedback.dataset.kind;
    void saveProfile(draft, revision).then((profile) => {
      accept(profile); setText(feedback, "Профиль «{0}» сохранён, версия {1}. Примените его и перезагрузите выбранные страницы.", profile.name, profile.revision);
    }).catch((error: unknown) => {
      setText(feedback, error instanceof Error ? error.message : String(error)); feedback.dataset.kind = "error";
      if (error instanceof ProfileClientError && ["REVISION_CONFLICT", "STORAGE_WRITE_FAILED", "TRANSPORT_ERROR"].includes(error.detail.code)) stale = true;
      if (error instanceof ProfileClientError && error.detail.issues) renderIssues(error.detail.issues);
    }).finally(() => {
      busy = false; update();
      if (changedWhileSaving) { changedWhileSaving = false; void refresh(); }
    });
  });
  example.addEventListener("click", () => {
    if (!loaded || busy) return;
    fill(profileToFields(getExampleProfileDraft())); attempted = false;
    setText(feedback, "Пример подставлен в форму. Для записи нажмите «Сохранить профиль»."); delete feedback.dataset.kind; update();
  });
  reload.addEventListener("click", () => { if (!busy) { setText(feedback, ""); void refresh(true); } });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[PROFILE_STORAGE_KEY] !== undefined) {
      if (busy) changedWhileSaving = true; else void refresh();
    }
  });
  update(); void refresh();
}
