import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: {
    contents: `export * from './src/profile/index.ts';
      export * from './src/profile/repository.ts';
      export * from './src/profile/messages.ts';
      export * from './src/profile/protocol.ts';
      export { createRegionalProfile } from './src/profile/validation.ts';`,
    resolveDir: root
  }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent"
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const {
  ProfileRepository, ProfileRepositoryError, ProfileRevisionConflict, ProfileValidationError,
  PROFILE_STORAGE_KEY, PROFILE_CHANNEL, compileAcceptLanguage, compileRegionalProfile,
  createRegionalProfile, getExampleProfile, getExampleProfileDraft, parseProfileDraft,
  parseRegionalProfile, profileToDraft, createProfileMessageListener, isTrustedProfileUi,
  loadProfile, saveProfile, ProfileClientError
} = api;

const freshDraft = () => JSON.parse(JSON.stringify(getExampleProfileDraft()));
const clone = (value) => JSON.parse(JSON.stringify(value));
const extensionId = "a".repeat(32);
const trustedUi = {
  id: extensionId, url: `chrome-extension://${extensionId}/options/options.html`,
  origin: `chrome-extension://${extensionId}`
};

function jsonStorage(initial = {}) {
  let persisted = JSON.stringify(initial);
  const state = { reads: 0, writes: 0, readError: null, writeError: null, commitBeforeError: false };
  return {
    state,
    snapshot: () => JSON.parse(persisted),
    get: async (key) => {
      state.reads++;
      if (state.readError) throw state.readError;
      const data = JSON.parse(persisted);
      return Object.hasOwn(data, key) ? { [key]: data[key] } : {};
    },
    set: async (items) => {
      state.writes++;
      if (state.writeError && !state.commitBeforeError) throw state.writeError;
      persisted = JSON.stringify({ ...JSON.parse(persisted), ...clone(items) });
      if (state.writeError) throw state.writeError;
    }
  };
}

function send(listener, message, sender = trustedUi) {
  return new Promise((resolve) => {
    const keepOpen = listener(clone(message), sender, (response) => resolve(clone(response)));
    if (!keepOpen && (!message || message.channel !== PROFILE_CHANNEL)) resolve(undefined);
  });
}

function connectClient(repository, sender = trustedUi) {
  const listener = createProfileMessageListener(repository, extensionId);
  let sent = 0;
  globalThis.chrome = { runtime: { sendMessage: (message) => { sent++; return send(listener, message, sender); } } };
  return { sent: () => sent, listener };
}

test("I03: пример профиля и согласованный неизменяемый снимок", () => {
  const profile = getExampleProfile();
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.revision, 1);
  assert.equal(profile.language, profile.languages[0]);
  assert.deepEqual(profile.geolocation, { latitude: 52.52, longitude: 13.405, accuracy: 1000, altitude: null, altitudeAccuracy: null, speed: null, heading: null });
  assert.ok(Object.isFrozen(profile));
  assert.ok(Object.isFrozen(profile.languages));
  assert.ok(Object.isFrozen(profile.geolocation));
  assert.throws(() => { profile.languages.push("fr"); }, TypeError);
  assert.throws(() => { profile.geolocation.latitude = 0; }, TypeError);
  assert.notEqual(getExampleProfile(), profile);
  const compiled = compileRegionalProfile(profile);
  assert.equal(compiled.acceptLanguage, "de-DE,de;q=0.9,en-US;q=0.8");
  assert.equal(compiled.profile.revision, profile.revision);
  assert.ok(Object.isFrozen(compiled));
  assert.equal("utcOffset" in profile, false);
  assert.equal("revision" in profileToDraft(profile), false);
  assert.equal("language" in profileToDraft(profile), false);
});

test("I03: границы координат и нормализация неизвестных геополей в null", () => {
  const draft = freshDraft();
  draft.geolocation = { latitude: -90, longitude: 180, accuracy: 0 };
  const normalized = parseProfileDraft(draft);
  assert.deepEqual(normalized.geolocation, { latitude: -90, longitude: 180, accuracy: 0, altitude: null, altitudeAccuracy: null, speed: null, heading: null });
  const opposite = freshDraft();
  opposite.geolocation = { latitude: 90, longitude: -180, accuracy: 0.5, altitude: -430.25, altitudeAccuracy: 0, speed: 0, heading: 359.999 };
  assert.deepEqual(parseProfileDraft(opposite).geolocation, opposite.geolocation);
  draft.geolocation = { latitude: -0, longitude: -0, accuracy: -0 };
  assert.ok(Object.is(parseProfileDraft(draft).geolocation.latitude, 0));
});

test("I03: нечисловые, бесконечные и выходящие за диапазон геозначения отвергаются", () => {
  for (const field of ["latitude", "longitude", "accuracy", "altitude", "altitudeAccuracy", "speed", "heading"]) {
    for (const value of [NaN, Infinity, -Infinity, "0", true, {}, []]) {
      const draft = freshDraft();
      draft.geolocation[field] = value;
      assert.throws(() => parseProfileDraft(draft), (error) => error instanceof ProfileValidationError && error.issues[0].path === `geolocation.${field}`, `${field}=${String(value)}`);
    }
  }
  for (const [field, value] of [["latitude", -90.01], ["latitude", 90.01], ["longitude", -180.01], ["longitude", 180.01], ["accuracy", -1], ["altitudeAccuracy", -1], ["speed", -1], ["heading", -1], ["heading", 360]]) {
    const draft = freshDraft(); draft.geolocation[field] = value;
    assert.throws(() => parseProfileDraft(draft), ProfileValidationError);
  }
  for (const field of ["latitude", "longitude", "accuracy"]) {
    const draft = freshDraft(); draft.geolocation[field] = null;
    assert.throws(() => parseProfileDraft(draft), ProfileValidationError);
    delete draft.geolocation[field];
    assert.throws(() => parseProfileDraft(draft), ProfileValidationError);
  }
});

test("I03: канонические теги, порядок языков и независимая locale", () => {
  const draft = freshDraft();
  draft.name = "  Берлин  ";
  draft.languages = ["EN-us", "en", "iw-IL"];
  draft.locale = "de-de";
  const profile = createRegionalProfile(draft, 7);
  assert.equal(profile.name, "Берлин");
  assert.deepEqual(profile.languages, ["en-US", "en", "he-IL"]);
  assert.equal(profile.language, "en-US");
  assert.equal(profile.locale, "de-DE");
  assert.equal(compileAcceptLanguage(["en-US", "de-DE"]), "en-US,de-DE;q=0.9");
  assert.equal(compileAcceptLanguage(["de-DE"]), "de-DE");
});

test("I03: ошибки языков и попытки вставить HTTP-заголовки не проходят", () => {
  const sparse = Array(2); sparse[0] = "en-US";
  for (const languages of [[], null, "en-US", [""], ["*"], ["en_US"], ["en-US,en"], ["en-US;q=0.9"], ["en-US\r\nX-Test: yes"], ["x-private"], [1], [null], ["en-US", "EN-us"], sparse, Array(11).fill("en")]) {
    assert.throws(() => compileAcceptLanguage(languages), ProfileValidationError);
  }
  const list = ["de-DE", "de", "en-US", "en", "fr-FR", "fr", "it-IT", "it", "es-ES", "es"];
  const header = compileAcceptLanguage(list);
  assert.equal(header.split(",").at(-1), "es;q=0.1");
  const weights = header.split(",").map((part) => Number(part.split(";q=")[1] ?? 1));
  assert.ok(weights.every((weight, index) => weight > 0 && (index === 0 || weight < weights[index - 1])));
  assert.ok(!header.includes("0.799999"));
});

test("I03: поддерживаемые locale и именованные timezone ID; без фиксированного offset", () => {
  for (const timeZone of ["Europe/Berlin", "America/New_York", "UTC", "Etc/GMT+3"]) {
    assert.equal(parseProfileDraft({ ...freshDraft(), timeZone }).timeZone, timeZone);
  }
  for (const timeZone of ["", "Mars/Olympus_Mons", "+03:00", "-05:00", "UTC+03:00", 180, null, "Europe/Berlin\n"]) {
    assert.throws(() => parseProfileDraft({ ...freshDraft(), timeZone }), ProfileValidationError);
  }
  for (const locale of ["zz-ZZ", "en_US", "", "de-DE\n", null, 4]) {
    assert.throws(() => parseProfileDraft({ ...freshDraft(), locale }), ProfileValidationError);
  }
  for (const extra of [{ utcOffset: 60 }, { timezoneOffset: -60 }, { revision: 999 }, { language: "fr" }]) {
    assert.throws(() => parseProfileDraft({ ...freshDraft(), ...extra }), (error) => error.issues[0].code === "unknown_field");
  }
  const typo = freshDraft(); typo.geolocation.altitdue = 0;
  assert.throws(() => parseProfileDraft(typo), ProfileValidationError);
});

test("I03: схема, revision и derived language проверяются при чтении снимка", () => {
  for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
    assert.throws(() => parseRegionalProfile({ ...clone(getExampleProfile()), revision }), ProfileValidationError);
  }
  for (const schemaVersion of [0, 2, "1", null]) {
    assert.throws(() => parseRegionalProfile({ ...clone(getExampleProfile()), schemaVersion }), (error) => error.issues[0].code === "unsupported_schema");
  }
  assert.throws(() => parseRegionalProfile({ ...clone(getExampleProfile()), language: "en-US" }), (error) => error.issues[0].code === "inconsistent_language");
  assert.throws(() => parseProfileDraft({ ...freshDraft(), name: "\n" }), ProfileValidationError);
  assert.throws(() => parseProfileDraft({ ...freshDraft(), name: "a".repeat(81) }), ProfileValidationError);
  for (const value of [null, [], new Date(), "{}"]) assert.throws(() => parseProfileDraft(value), ProfileValidationError);
});

test("I03: пустое хранилище не получает профиль автоматически", async () => {
  const storage = jsonStorage({ extensionPreferences: { masterEnabled: false } });
  const repository = new ProfileRepository(storage);
  assert.equal(await repository.load(), null);
  assert.equal(storage.state.writes, 0);
  assert.equal(PROFILE_STORAGE_KEY in storage.snapshot(), false);
});

test("I03: JSON-хранилище сохраняет профиль и revision после нового экземпляра репозитория", async () => {
  const storage = jsonStorage({ extensionPreferences: { masterEnabled: true }, unrelated: { keep: 1 } });
  const beforeRestart = new ProfileRepository(storage);
  const first = await beforeRestart.save(freshDraft(), 0);
  assert.equal(first.revision, 1);
  const afterRestart = new ProfileRepository(storage);
  assert.deepEqual(await afterRestart.load(), first);
  const next = await afterRestart.save({ ...freshDraft(), name: "Новый профиль" }, 1);
  assert.equal(next.revision, 2);
  assert.equal(first.name, "Берлин");
  assert.equal((await new ProfileRepository(storage).load()).name, "Новый профиль");
  assert.deepEqual(storage.snapshot().unrelated, { keep: 1 });
  assert.equal(storage.snapshot().extensionPreferences.masterEnabled, true);
  assert.equal(storage.snapshot().regionalProfileRevision, next.revision);
  assert.equal(Object.keys(storage.snapshot()).length, 4);
});

test("I03: повторное сохранение того же содержимого не создаёт новую revision", async () => {
  const storage = jsonStorage();
  const repository = new ProfileRepository(storage);
  const first = await repository.save(freshDraft(), 0);
  const equivalent = freshDraft(); equivalent.name = " Берлин "; equivalent.languages[0] = "DE-de";
  const second = await repository.save(equivalent, 1);
  assert.deepEqual(second, first);
  assert.equal(storage.state.writes, 1);
});

test("I03: проверка данных идёт до чтения/записи; очередь получает независимый снимок", async () => {
  const storage = jsonStorage();
  const repository = new ProfileRepository(storage);
  const invalid = freshDraft(); invalid.geolocation.speed = NaN;
  await assert.rejects(repository.save(invalid, 0), ProfileValidationError);
  await assert.rejects(repository.save(freshDraft(), "0"), ProfileValidationError);
  assert.equal(storage.state.reads, 0);
  assert.equal(storage.state.writes, 0);
  const draft = freshDraft();
  const saving = repository.save(draft, 0);
  draft.languages[0] = "fr"; draft.geolocation.latitude = 0;
  const saved = await saving;
  assert.equal(saved.language, "de-DE");
  assert.equal(saved.geolocation.latitude, 52.52);
});

test("I03: параллельные записи с одинаковой базовой revision дают явный конфликт", async () => {
  const storage = jsonStorage();
  const repository = new ProfileRepository(storage);
  const results = await Promise.allSettled([
    repository.save({ ...freshDraft(), name: "Первый" }, 0),
    repository.save({ ...freshDraft(), name: "Второй" }, 0)
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.ok(results[1].reason instanceof ProfileRevisionConflict);
  assert.equal(results[1].reason.actualRevision, 1);
  assert.equal(storage.state.writes, 1);
  assert.equal((await repository.load()).name, "Первый");
  const recovered = await repository.save({ ...freshDraft(), name: "После конфликта" }, 1);
  assert.equal(recovered.revision, 2);
});

test("I03: повреждённые и будущие схемы не перезаписываются при load/save", async () => {
  for (const raw of [null, { ...clone(getExampleProfile()), schemaVersion: 99 }, { ...clone(getExampleProfile()), language: "wrong" }]) {
    const storage = jsonStorage({ [PROFILE_STORAGE_KEY]: raw });
    const repository = new ProfileRepository(storage);
    await assert.rejects(repository.load(), (error) => error.code === "INVALID_STORED_PROFILE");
    await assert.rejects(repository.save(freshDraft(), 0), (error) => error.code === "INVALID_STORED_PROFILE");
    assert.equal(storage.state.writes, 0);
    assert.deepEqual(storage.snapshot()[PROFILE_STORAGE_KEY], raw);
  }
});

test("I03: ошибки storage не выдаются за успех и не ломают последующие запросы", async () => {
  const storage = jsonStorage();
  const repository = new ProfileRepository(storage);
  storage.state.readError = new Error("synthetic read failure");
  await assert.rejects(repository.load(), (error) => error instanceof ProfileRepositoryError && error.code === "STORAGE_READ_FAILED");
  storage.state.readError = null;
  storage.state.writeError = new Error("synthetic write failure");
  await assert.rejects(repository.save(freshDraft(), 0), (error) => error.code === "STORAGE_WRITE_FAILED");
  assert.equal(await repository.load(), null);
  storage.state.writeError = null;
  assert.equal((await repository.save(freshDraft(), 0)).revision, 1);
  storage.state.writeError = new Error("synthetic lost acknowledgement");
  storage.state.commitBeforeError = true;
  await assert.rejects(repository.save({ ...freshDraft(), name: "Запись завершена, ответ потерян" }, 1), (error) => error.code === "STORAGE_WRITE_FAILED");
  const actual = await repository.load();
  assert.equal(actual.revision, 2);
  await assert.rejects(repository.save(freshDraft(), 1), ProfileRevisionConflict);
});

test("I03: revision не переполняется", async () => {
  const raw = { ...clone(getExampleProfile()), revision: Number.MAX_SAFE_INTEGER };
  const storage = jsonStorage({ [PROFILE_STORAGE_KEY]: raw });
  const repository = new ProfileRepository(storage);
  assert.equal((await repository.save(freshDraft(), raw.revision)).revision, raw.revision);
  await assert.rejects(repository.save({ ...freshDraft(), name: "Изменение" }, raw.revision), (error) => error.code === "REVISION_LIMIT");
  assert.equal(storage.state.writes, 0);
});

test("I03: сообщения принимаются только от popup/options своего расширения", async () => {
  const storage = jsonStorage();
  const listener = createProfileMessageListener(new ProfileRepository(storage), extensionId);
  const message = { channel: PROFILE_CHANNEL, operation: "save", draft: freshDraft(), expectedRevision: 0 };
  const denied = [
    {}, { ...trustedUi, id: "b".repeat(32) }, { ...trustedUi, origin: "https://example.com" },
    { ...trustedUi, url: "https://selected.localhost:8787/options/options.html" },
    { ...trustedUi, url: `chrome-extension://${extensionId}/probe/probe.html` },
    { ...trustedUi, url: `chrome-extension://${extensionId}:999/options/options.html` },
    { ...trustedUi, url: `chrome-extension://user@${extensionId}/options/options.html` }
  ];
  for (const sender of denied) assert.equal((await send(listener, message, sender)).error.code, "FORBIDDEN");
  assert.equal(storage.state.writes, 0);
  assert.equal(storage.state.reads, 0);
  assert.equal(isTrustedProfileUi({ ...trustedUi, url: `chrome-extension://${extensionId}/popup/popup.html?view=1#state` }, extensionId), true);
  let answered = false;
  assert.equal(listener({ channel: "unrelated" }, trustedUi, () => { answered = true; }), false);
  assert.equal(answered, false);
  assert.equal((await send(listener, { ...message, extraPermission: true })).error.code, "INVALID_REQUEST");
  assert.equal((await send(listener, { channel: PROFILE_CHANNEL, operation: "unknown" })).error.code, "INVALID_REQUEST");
});

test("I03: клиент ↔ handler ↔ JSON-хранилище, включая новый worker после перезапуска", async () => {
  const storage = jsonStorage();
  connectClient(new ProfileRepository(storage));
  assert.equal(await loadProfile(), null);
  const saved = await saveProfile(freshDraft(), 0);
  assert.equal(saved.revision, 1);
  assert.ok(Object.isFrozen(saved));
  connectClient(new ProfileRepository(storage));
  assert.deepEqual(await loadProfile(), saved);
  await assert.rejects(saveProfile({ ...freshDraft(), name: "Устаревшее изменение" }, 0), (error) => error instanceof ProfileClientError && error.detail.code === "REVISION_CONFLICT" && error.detail.actualRevision === 1);
  assert.equal((await saveProfile({ ...freshDraft(), name: "Новая версия" }, 1)).revision, 2);
});

test("I03: NaN и Infinity проверяются клиентом до JSON-сериализации Chrome", async () => {
  const storage = jsonStorage();
  const client = connectClient(new ProfileRepository(storage));
  for (const field of ["altitude", "altitudeAccuracy", "heading", "speed"]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const draft = freshDraft(); draft.geolocation[field] = value;
      await assert.rejects(saveProfile(draft, 0), ProfileValidationError);
    }
  }
  assert.equal(client.sent(), 0);
  assert.equal(storage.state.writes, 0);
});

test("I03: клиент явно сообщает об ошибках транспорта и некорректных ответах", async () => {
  for (const response of [undefined, {}, { ok: true, profile: {} }, { ok: false, error: {} }]) {
    globalThis.chrome = { runtime: { sendMessage: async () => response } };
    await assert.rejects(loadProfile(), (error) => error instanceof ProfileClientError && error.detail.code === "INVALID_RESPONSE");
  }
  globalThis.chrome = { runtime: { sendMessage: async () => { throw new Error("synthetic unavailable worker"); } } };
  await assert.rejects(loadProfile(), (error) => error.detail.code === "TRANSPORT_ERROR");
});

test("I03: закрытие UI не отменяет уже завершённую запись и не раскрывает причины storage", async () => {
  const storage = jsonStorage();
  const repository = new ProfileRepository(storage);
  const listener = createProfileMessageListener(repository, extensionId);
  assert.equal(listener({ channel: PROFILE_CHANNEL, operation: "save", draft: freshDraft(), expectedRevision: 0 }, trustedUi, () => { throw new Error("synthetic closed popup"); }), true);
  assert.equal((await repository.load()).revision, 1);
  storage.state.readError = new Error("private adapter detail");
  const result = await send(listener, { channel: PROFILE_CHANNEL, operation: "load" });
  assert.equal(result.error.code, "STORAGE_READ_FAILED");
  assert.ok(!JSON.stringify(result).includes("private adapter detail"));
});

test("I03: фактический bundle service worker подключает обработчик и не создаёт профиль при установке", async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL("../src/background/service-worker.ts", import.meta.url))], bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent" });
  const storage = jsonStorage();
  const listeners = { message: [], installed: [] };
  const chrome = {
    storage: { local: storage }, runtime: { id: extensionId,
      onMessage: { addListener: (listener) => listeners.message.push(listener) },
      onInstalled: { addListener: (listener) => listeners.installed.push(listener) }
    }
  };
  vm.runInNewContext(result.outputFiles[0].text, { chrome, console, URL });
  assert.equal(listeners.message.length, 3);
  assert.equal(storage.state.writes, 0);
  listeners.installed[0]();
  await new Promise(setImmediate);
  assert.equal(PROFILE_STORAGE_KEY in storage.snapshot(), false);
  assert.equal(storage.snapshot().extensionPreferences.masterEnabled, false);
});
