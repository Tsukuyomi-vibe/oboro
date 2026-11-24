import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {runtimePage} from "./runtime-page.mjs";
const root=fileURLToPath(new URL("../../",import.meta.url));
const result=await build({stdin:{contents:"export {Temporal} from '@js-temporal/polyfill';",resolveDir:root},bundle:true,write:false,format:"iife",globalName:"TemporalFixture",logLevel:"silent"});
const source=result.outputFiles[0].text;

// A realm-local polyfill is only a feature-present test surrogate, not proof
// of native Temporal in installed Chrome.
export function temporalPage({clock=1705320000123,extra="",...options}={}){
  const beforeRuntime=`
    ${clock===null?"":"Date.now=()=>"+clock+"; globalThis.nativeNow=Date.now;"}
    ${source}
    globalThis.Temporal=TemporalFixture.Temporal;
    globalThis.originalTemporal=Temporal;
    globalThis.systemTimeZone=new Intl.DateTimeFormat().resolvedOptions().timeZone;
    globalThis.nowCalls=[];
    for(const name of ['timeZoneId','zonedDateTimeISO','plainDateTimeISO','plainDateISO','plainTimeISO']){
      const original=Temporal.Now[name];
      Temporal.Now[name]=new Proxy(original,{apply(target,receiver,args){nowCalls.push({name,args:[...args]});return Reflect.apply(target,receiver,args)}});
    }
    globalThis.originalNow=Object.fromEntries(Object.getOwnPropertyNames(Temporal.Now).map(name=>[name,Temporal.Now[name]]));
    globalThis.originalTemporalConstructors=Object.fromEntries(['Instant','PlainDate','PlainDateTime','PlainTime','ZonedDateTime','Duration'].map(name=>[name,Temporal[name]]));
  `;
  return runtimePage({...options,beforeRuntime,extra});
}
