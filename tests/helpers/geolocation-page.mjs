import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
const root = fileURLToPath(new URL("../../", import.meta.url));
const result = await build({ entryPoints: [root + "src/runtime/geolocation.ts"], bundle: true, write: false, format: "iife", globalName: "GeoRuntime", platform: "browser", logLevel: "silent" });
const source = result.outputFiles[0].text;
const example = JSON.parse(await readFile(new URL("../../examples/berlin.regional-profile.json", import.meta.url), "utf8"));

export function geoPage({ permission = "granted", nativeMode = "success", delay = 0, hidden = false } = {}) {
  let clock = 1_700_000_000_000;
  let nextTimer = 1;
  const timers = new Map();
  const context = vm.createContext({
    URL, console, clockNow: () => clock,
    setTimeout: (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { callback, due: clock + delay }); return id; },
    clearTimeout: (id) => timers.delete(id)
  });
  vm.runInContext(`
    class Hub {
      listeners = new Map();
      addEventListener(type, fn) { const set = this.listeners.get(type) ?? new Set(); set.add(fn); this.listeners.set(type, set); }
      removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
      emit(type) { for (const fn of [...(this.listeners.get(type) ?? [])]) fn(); }
    }
    const events = new Hub();
    globalThis.addEventListener = events.addEventListener.bind(events);
    globalThis.emitWindow = events.emit.bind(events);
    globalThis.window = globalThis; globalThis.isSecureContext = true;
    globalThis.document = new Hub(); document.visibilityState = ${JSON.stringify(hidden ? "hidden" : "visible")};
    document.permissionsPolicy = { allowsFeature: () => true };
    Date.now = clockNow;
    globalThis.permission = new Hub(); permission.state = ${JSON.stringify(permission)};
    globalThis.calls = []; globalThis.nativeCalls = 0; globalThis.nativeWatches = 0; globalThis.nativeClears = 0; globalThis.realTouched = 0;
    const nativeTimers = new Map(); let nativeId = 100;
    function nativeRequest(success, error, options) {
      globalThis.nativeOptions = options;
      return setTimeout(() => {
        if (${JSON.stringify(nativeMode)} === 'denied') { permission.state = 'denied'; error({code: 1}); return; }
        if (${JSON.stringify(nativeMode)} === 'unavailable') { error({code: 2}); return; }
        permission.state = 'granted';
        success({ get coords() { realTouched++; return { latitude: -1 }; } });
      }, ${delay});
    }
    class Geolocation {
      getCurrentPosition(success, error, options) { nativeCalls++; nativeRequest(success, error, options); }
      watchPosition(success, error, options) { nativeWatches++; const id = ++nativeId; nativeTimers.set(id, nativeRequest(success, error, options)); return id; }
      clearWatch(id) { nativeClears++; clearTimeout(nativeTimers.get(id)); nativeTimers.delete(id); }
    }
    globalThis.Geolocation = Geolocation;
    globalThis.navigator = {geolocation: new Geolocation(), permissions: {query: () => Promise.resolve(permission)}};
  `, context);
  vm.runInContext(source, context);
  vm.runInContext(`globalThis.installed = GeoRuntime.installGeolocationRuntime(${JSON.stringify(example.geolocation)})`, context);
  const run = (code) => vm.runInContext(code, context);
  async function microtasks() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
  async function flush(advance = 0) {
    clock += advance;
    for (let i = 0; i < 100; i++) {
      await microtasks();
      const due = [...timers].filter(([, item]) => item.due <= clock).sort((a,b) => a[1].due - b[1].due || a[0] - b[0]);
      if (!due.length) return;
      for (const [id, item] of due) if (timers.delete(id)) item.callback();
    }
    throw new Error("Unbounded synthetic geolocation tasks");
  }
  return { run, flush, microtasks, advance: (amount) => { clock += amount; }, pending: () => timers.size,
    calls: () => JSON.parse(run("JSON.stringify(calls)")), listeners: () => run("permission.listeners.get('change')?.size ?? 0") };
}
