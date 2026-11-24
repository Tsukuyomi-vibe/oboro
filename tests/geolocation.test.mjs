import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { runtimeBundle } from "../scripts/runtime-build.mjs";
const source = await runtimeBundle(fileURLToPath(new URL("../", import.meta.url)));
const example = JSON.parse(await readFile(new URL("../examples/berlin.regional-profile.json", import.meta.url), "utf8"));

function page({ host = "selected.test", permission = "granted", secure = true, nativeMode = "success", geo = {}, queryMode = "normal", policyAllowed = true } = {}) {
  const context = vm.createContext({ URL, setTimeout, clearTimeout, console, TextEncoder, crypto: globalThis.crypto });
  vm.runInContext(`
    class Navigator { get language(){ return 'native'; } get languages(){ return ['native']; } }
    globalThis.Navigator = Navigator; globalThis.navigator = new Navigator();
    globalThis.window = globalThis; globalThis.location = new URL('https://${host}/');
    globalThis.origin = location.origin;
    globalThis.document = { readyState: 'loading', permissionsPolicy: { allowsFeature: () => ${policyAllowed} } };
    globalThis.isSecureContext = ${secure};
    globalThis.postMessage = () => {}; globalThis.addEventListener = () => {};
    globalThis.nativeCalls = 0; globalThis.watchCalls = 0; globalThis.queryCalls = 0; globalThis.realTouched = 0;
    globalThis.permission = { state: ${JSON.stringify(permission)} };
    class Geolocation {
      getCurrentPosition(success, error, options) {
        nativeCalls++; globalThis.nativeOptions = options;
        setTimeout(() => {
          if (${JSON.stringify(nativeMode)} === 'deny') { permission.state = 'denied'; error({code: 1}); return; }
          if (${JSON.stringify(nativeMode)} === 'unavailable') { error({code: 2}); return; }
          permission.state = 'granted';
          success({ timestamp: 1, get coords() { realTouched++; return {latitude: 1, longitude: 2, accuracy: 3, altitude: 4, altitudeAccuracy: 5, speed: 6, heading: 7}; } });
          if (${JSON.stringify(nativeMode)} === 'both') error({code: 2});
        }, 0);
      }
      watchPosition() { watchCalls++; return 888; }
      clearWatch() {}
    }
    class GeolocationCoordinates {} class GeolocationPosition {} class GeolocationPositionError {}
    Object.assign(globalThis, {Geolocation, GeolocationCoordinates, GeolocationPosition, GeolocationPositionError});
    navigator.geolocation = new Geolocation();
    navigator.permissions = {query: () => { queryCalls++; if (${JSON.stringify(queryMode)} === 'throw') throw new Error('synthetic permission error'); return ${JSON.stringify(queryMode)} === 'reject' ? Promise.reject(new Error('synthetic permission error')) : Promise.resolve(permission); }};
    globalThis.originalGet = Geolocation.prototype.getCurrentPosition;
  `, context);
  const snapshot = {
    activationId: "geo-unit", signature: "geo-unit-v1", profile: { ...example, geolocation: { ...example.geolocation, ...geo } },
    policy: { schemaVersion: 1, policyRevision: 1, mode: "selected_sites", include: [{ host: "selected.test", includeSubdomains: false, schemes: ["https"] }], exclude: [] },
    grantedOrigins: ["https://selected.test/*"], geolocationOneShot: true
  };
  vm.runInContext(source, context);
  const report = vm.runInContext(`RegionRuntime.installMainRuntime(${JSON.stringify(snapshot)})`, context);
  return { context, report, run: (code) => vm.runInContext(code, context) };
}
function request(target, options = "undefined") {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Synthetic geo test did not complete")), 500);
    target.context.receiveGeo = (result) => { clearTimeout(timeout); resolve(JSON.parse(JSON.stringify(result))); };
    target.run(`globalThis.synchronous = true;
      navigator.geolocation.getCurrentPosition((position) => {
        receiveGeo({ success: true, synchronous, timestamp: position.timestamp,
          coords: Object.fromEntries(['latitude','longitude','accuracy','altitude','altitudeAccuracy','speed','heading'].map(key => [key, position.coords[key]])),
          frozen: Object.isFrozen(position) && Object.isFrozen(position.coords),
          json: typeof position.toJSON === 'function' ? position.toJSON() : null,
          prototype: position instanceof GeolocationPosition });
      }, (error) => receiveGeo({success: false, synchronous, code: error.code}), ${options});
      synchronous = false;`);
  });
}

test("I10: granted выдаёт все поля асинхронно, неизвестные поля null, timestamp не timezone", async () => {
  const target = page();
  target.run("Date.now = () => 123;");
  const result = await request(target);
  assert.equal(result.success, true); assert.equal(result.synchronous, false);
  assert.deepEqual(result.coords, example.geolocation);
  assert.ok(Math.abs(result.timestamp - Date.now()) < 1000);
  assert.equal(result.timestamp, result.json.timestamp); assert.equal(result.frozen, true); assert.equal(result.prototype, true);
  assert.equal(target.run("nativeCalls"), 0); assert.equal(target.run("realTouched"), 0);
});
test("I10: дополнительные значения и стационарный heading", async () => {
  const moving = page({ geo: { altitude: -30, altitudeAccuracy: 2, speed: 4, heading: 270, accuracy: 5 } });
  const result = await request(moving);
  assert.deepEqual(result.coords, { ...example.geolocation, altitude: -30, altitudeAccuracy: 2, speed: 4, heading: 270, accuracy: 5 });
  assert.equal((await request(page({ geo: { speed: 0, heading: 200 } }))).coords.heading, null);
});
test("I10: denied и Permissions Policy не превращаются в granted", async () => {
  const denied = page({ permission: "denied" });
  assert.deepEqual(await request(denied), { success: false, synchronous: false, code: 1 });
  assert.equal(denied.run("nativeCalls"), 0);
  const policy = page({ policyAllowed: false });
  assert.equal((await request(policy)).code, 1); assert.equal(policy.run("queryCalls"), 0); assert.equal(policy.run("nativeCalls"), 0);
});
test("I10: prompt использует нативный запрос, а реальные координаты не читаются и не передаются", async () => {
  const target = page({ permission: "prompt" });
  const result = await request(target);
  assert.deepEqual(result.coords, example.geolocation); assert.equal(result.synchronous, false);
  assert.equal(target.run("nativeCalls"), 1); assert.equal(target.run("realTouched"), 0);
  const rejected = page({ permission: "prompt", nativeMode: "deny" });
  assert.equal((await request(rejected)).code, 1); assert.equal(rejected.run("realTouched"), 0);
  assert.equal((await request(page({ permission: "prompt", nativeMode: "unavailable" }))).code, 2);
});
test("I10: ошибки проверки permissions и timeout=0 возвращаются асинхронно", async () => {
  for (const queryMode of ["throw", "reject"]) {
    const result = await request(page({ queryMode }));
    assert.deepEqual(result, { success: false, synchronous: false, code: 2 });
  }
  assert.deepEqual(await request(page(), "{timeout: 0}"), { success: false, synchronous: false, code: 3 });
});
test("I10: WebIDL-подобные аргументы проверяются синхронно до permissions", () => {
  const target = page();
  for (const code of ["navigator.geolocation.getCurrentPosition()", "navigator.geolocation.getCurrentPosition(null)", "navigator.geolocation.getCurrentPosition(()=>{},42)", "navigator.geolocation.getCurrentPosition(()=>{},null,42)", "navigator.geolocation.getCurrentPosition(()=>{},null,{timeout:1n})", "Geolocation.prototype.getCurrentPosition.call({},()=>{})"]) assert.throws(() => target.run(code));
  assert.equal(target.run("queryCalls"), 0); assert.equal(target.run("nativeCalls"), 0);
});
test("I10: отзыв разрешения до callback отменяет синтетический успех", async () => {
  const target = page();
  const waiting = request(target);
  await Promise.resolve();
  target.run("permission.state = 'denied';");
  assert.equal((await waiting).code, 1); assert.equal(target.run("nativeCalls"), 0);
});
test("I10/I11: unselected остаётся нативным; insecure не получает искусственный API; watch выбранного перехвачен", async () => {
  const control = page({ host: "control.test" });
  assert.equal(control.report, null); assert.equal(control.run("Geolocation.prototype.getCurrentPosition === originalGet"), true);
  const native = await request(control);
  assert.equal(native.coords.latitude, 1); assert.equal(control.run("nativeCalls"), 1);
  const insecure = page({ secure: false });
  assert.equal(insecure.report.geolocation, "unsupported"); assert.equal(insecure.run("Geolocation.prototype.getCurrentPosition === originalGet"), true);
  const chosen = page();
  const id = chosen.run("navigator.geolocation.watchPosition(()=>{})");
  assert.ok(id > 0); assert.equal(chosen.run("watchCalls"), 0);
  chosen.run(`navigator.geolocation.clearWatch(${id});`);
});
