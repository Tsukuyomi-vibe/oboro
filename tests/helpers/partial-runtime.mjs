import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runtimeBundle } from "../../scripts/runtime-build.mjs";
import { nativeKeyboardFixture } from "./keyboard-page.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = await runtimeBundle(root);
const compiled = await build({ stdin: { contents: "export * from './src/profile/validation.ts'; export * from './src/runtime/compiler.ts';", resolveDir: root },
  bundle: true, write: false, format: "esm", platform: "browser", define: { __REGION_RUNTIME_BUNDLE__: '""' }, logLevel: "silent" });
export const partialApi = await import("data:text/javascript;base64," + Buffer.from(compiled.outputFiles[0].text).toString("base64"));

// Independent WebIDL-shaped providers with different locale/position defaults.
// Native Date still uses the process time zone; separate-process tests vary TZ.
export function partialBrowser(profile, { locale = "en-US", timeZone = "UTC", language = locale, longitude = 30, permission = "granted", keyboard = "host-y" } = {}) {
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout, TextEncoder, crypto: globalThis.crypto, EventTarget, Event, DOMException });
  vm.runInContext(`
    globalThis.window=globalThis;
    const windowEvents=new EventTarget(); globalThis.addEventListener=windowEvents.addEventListener.bind(windowEvents);
    globalThis.emitWindow=type=>windowEvents.dispatchEvent(new Event(type)); globalThis.postMessage=()=>{};
    globalThis.document={readyState:'loading',visibilityState:'visible',permissionsPolicy:{allowsFeature:()=>true}};
    globalThis.location=new URL('https://selected.test/');globalThis.origin=location.origin;globalThis.isSecureContext=true;
    const pcLocale=${JSON.stringify(locale)},pcZone=${JSON.stringify(timeZone)};
    class Navigator {get language(){return ${JSON.stringify(language)}}get languages(){return [${JSON.stringify(language)},'en']}}
    globalThis.Navigator=Navigator;globalThis.navigator=new Navigator();
    for(const key of ['Collator','DateTimeFormat','NumberFormat','PluralRules','RelativeTimeFormat','ListFormat','DisplayNames','Segmenter','DurationFormat']){
      const original=Intl[key];if(typeof original!=='function')continue;
      const defaults=args=>{const next=[...args];if(next[0]===undefined||Array.isArray(next[0])&&!next[0].length)next[0]=pcLocale;
        if(key==='DateTimeFormat')next[1]={...(next[1]??{}),timeZone:next[1]?.timeZone??pcZone};return next};
      Intl[key]=new Proxy(original,{construct:(target,args,newTarget)=>Reflect.construct(target,defaults(args),newTarget),apply:(target,receiver,args)=>Reflect.apply(target,receiver,defaults(args))});
    }
    for(const key of ['toLocaleString','toLocaleDateString','toLocaleTimeString']){
      const original=Date.prototype[key];Date.prototype[key]=function(locales,options){return original.call(this,locales??pcLocale,{...(options??{}),timeZone:options?.timeZone??pcZone})};
    }
    globalThis.nativeCoords={latitude:12,longitude:${longitude},accuracy:17,altitude:40,altitudeAccuracy:3,speed:8,heading:92};
    globalThis.nativeTimestamp=1705320000123;globalThis.nativeGeoCalls=0;globalThis.nativeOptions=null;
    globalThis.nativePermission=${JSON.stringify(permission)};globalThis.nativeError={code:1,message:'native permission denied'};
    const geoWatches=new Map();let geoId=100;globalThis.nativeClears=0;
    const deliver=(success,error,id)=>Promise.resolve().then(()=>{if(id!==undefined&&!geoWatches.has(id))return;
      if(nativePermission==='denied'){error?.(nativeError);return}
      globalThis.nativeLastPosition=Object.freeze({coords:Object.freeze({...nativeCoords}),timestamp:nativeTimestamp});success(nativeLastPosition)});
    class Geolocation {
      getCurrentPosition(success,error,options){if(this!==navigator.geolocation)throw new TypeError('Illegal invocation');if(typeof success!=='function'||error!=null&&typeof error!=='function')throw new TypeError('callback');nativeGeoCalls++;nativeOptions=options;deliver(success,error)}
      watchPosition(success,error,options){if(this!==navigator.geolocation)throw new TypeError('Illegal invocation');if(typeof success!=='function'||error!=null&&typeof error!=='function')throw new TypeError('callback');nativeGeoCalls++;nativeOptions=options;const id=++geoId;geoWatches.set(id,{success,error});deliver(success,error,id);return id}
      clearWatch(id){if(this!==navigator.geolocation)throw new TypeError('Illegal invocation');if(!arguments.length)throw new TypeError('watch id');nativeClears++;geoWatches.delete(+id>>0)}
    }
    globalThis.Geolocation=Geolocation;navigator.geolocation=new Geolocation();
    globalThis.emitNativePosition=()=>{for(const [id,watch]of geoWatches)deliver(watch.success,watch.error,id)};
    globalThis.received=[];globalThis.errors=[];
  `, context);
  vm.runInContext(nativeKeyboardFixture.replaceAll("native-y", keyboard), context);
  vm.runInContext(`
    globalThis.originalRefs={Date,DateTimeFormat:Intl.DateTimeFormat,NumberFormat:Intl.NumberFormat,Collator:Intl.Collator,
      number:Number.prototype.toLocaleString,string:String.prototype.localeCompare,dateLocale:Date.prototype.toLocaleString,
      geo:navigator.geolocation.getCurrentPosition,keyboard:navigator.keyboard.getLayoutMap,
      lang:Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get};
    globalThis.values=()=>({language:navigator.language,languages:[...navigator.languages],locale:new Intl.DateTimeFormat().resolvedOptions().locale,
      timeZone:new Intl.DateTimeFormat().resolvedOptions().timeZone,number:new Intl.NumberFormat().format(12345.67),
      hours:new Date(1705320000123).getHours(),date:new Date(1705320000123).toLocaleString(),instant:new Date(1705320000123).getTime()});
    globalThis.before=values();
  `, context);
  const regional = partialApi.createRegionalProfile(profile, 1);
  const snapshot = partialApi.createRuntimeSnapshot(regional, { schemaVersion: 1, policyRevision: 1, mode: "selected_sites", include: [{ host: "selected.test", schemes: ["https"], includeSubdomains: false }], exclude: [] }, ["https://selected.test/*"], "synthetic-partial", true);
  vm.runInContext(source, context);
  const report = vm.runInContext(`RegionRuntime.installMainRuntime(${JSON.stringify(snapshot)})`, context);
  const run = code => vm.runInContext(code, context);
  return { report, snapshot, context, run, json: code => JSON.parse(run("JSON.stringify(" + code + ")")), async flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); } };
}
