import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runtimeBundle } from "../../scripts/runtime-build.mjs";
const source = await runtimeBundle(fileURLToPath(new URL("../../",import.meta.url)));
const example = JSON.parse(await readFile(new URL("../../examples/berlin.regional-profile.json",import.meta.url),"utf8"));
export function runtimePage({host="selected.test",locale="de-DE",timeZone="Europe/Berlin",keyboardLayout="native",extra="",beforeRuntime="",foreignDate=new Date(0),globals={},setupContext}={}) {
  const context=vm.createContext({URL,setTimeout,clearTimeout,console,foreignDate,TextEncoder,crypto:globalThis.crypto,...globals});
  vm.runInContext(`
    class Navigator {
      get language(){if(this!==navigator)throw new TypeError('Illegal invocation');return 'native';}
      get languages(){if(this!==navigator)throw new TypeError('Illegal invocation');return ['native'];}
    }
    globalThis.Navigator=Navigator; globalThis.navigator=new Navigator();
    globalThis.window=globalThis; globalThis.location=new URL(${JSON.stringify("https://"+host+"/")});globalThis.origin=location.origin;
    globalThis.document={readyState:'loading'}; globalThis.addEventListener=()=>{}; globalThis.postMessage=()=>{};
    globalThis.NativeDate=Date; globalThis.NativeDateTimeFormat=Intl.DateTimeFormat;
    globalThis.original=Object.fromEntries(Object.getOwnPropertyNames(Date.prototype).map(key=>[key,Date.prototype[key]]));
    globalThis.nativeUTC=Date.UTC; globalThis.nativeParse=Date.parse; globalThis.nativeNow=Date.now;
    globalThis.originalPerformance=()=>123.45; globalThis.performance={now:originalPerformance};
  `,context);
  setupContext?.(context);
  if(beforeRuntime)vm.runInContext(beforeRuntime,context);
  if(extra)vm.runInContext(extra,context);
  const snapshot={activationId:"unit-time",signature:"unit-time-"+locale+timeZone+keyboardLayout,profile:{...example,locale,timeZone,keyboardLayout},
    policy:{schemaVersion:1,policyRevision:1,mode:"selected_sites",include:[{host:"selected.test",schemes:["https"],includeSubdomains:false}],exclude:[]},
    grantedOrigins:["https://selected.test/*"],geolocationOneShot:false};
  vm.runInContext(source,context);
  const report=vm.runInContext(`RegionRuntime.installMainRuntime(${JSON.stringify(snapshot)})`,context);
  const run=code=>vm.runInContext("{\n"+code+"\n}",context);
  return {run,report,context};
}
