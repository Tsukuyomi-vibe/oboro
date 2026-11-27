import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const built = await build({ entryPoints: [root + "src/runtime/geolocation.ts"], bundle: true, write: false, format: "iife", globalName: "GeoRuntime", platform: "browser", logLevel: "silent" });

export function geoPage({ permission = "granted", nativeMode = "success", delay = 0, secure = true, policyAllowed = true, profile = { latitude: 52.52, longitude: 13.405 } } = {}) {
  let clock = 1700000000000, serial = 0;
  const timers = new Map();
  const context = vm.createContext({ console, clockNow: () => clock,
    setTimeout: callback => { const id = ++serial; timers.set(id, { callback, due: clock + delay }); return id; },
    clearTimeout: id => timers.delete(id) });
  vm.runInContext(`
    const handlers=new Map();globalThis.window=globalThis;globalThis.isSecureContext=${secure};
    globalThis.addEventListener=(type,fn)=>{const entries=handlers.get(type)??[];entries.push(fn);handlers.set(type,entries)};
    globalThis.emitWindow=type=>{for(const fn of handlers.get(type)??[])fn()};
    globalThis.document={permissionsPolicy:{allowsFeature:()=>${policyAllowed}}};
    globalThis.nativePermission=${JSON.stringify(permission)};globalThis.nativeMode=${JSON.stringify(nativeMode)};
    globalThis.nativeCoords={latitude:-1,longitude:10,accuracy:17,altitude:40,altitudeAccuracy:3,speed:0,heading:92};
    globalThis.calls=[];globalThis.nativeCalls=0;globalThis.nativeWatches=0;globalThis.nativeClears=0;globalThis.nativeOptions=null;
    globalThis.nativeError={code:1,message:'Native error'};
    const watches=new Map();let nextId=100;globalThis.nativeWatchCount=()=>watches.size;
    function deliver(success,error,id){
      const timer=setTimeout(()=>{
        if(id!==undefined){const watch=watches.get(id);if(!watch)return;watch.timers.delete(timer)}
        if(nativePermission==='denied'||!document.permissionsPolicy.allowsFeature('geolocation')||nativeMode!=='success'){
          nativeError.code=nativePermission==='denied'||!document.permissionsPolicy.allowsFeature('geolocation')||nativeMode==='denied'?1:nativeMode==='timeout'?3:2;
          if(error)Reflect.apply(error,undefined,[nativeError]);return;
        }
        nativePermission='granted';
        const coords=Object.freeze({...nativeCoords});globalThis.nativePosition=Object.freeze({coords,timestamp:clockNow()});
        Reflect.apply(success,undefined,[nativePosition]);
      });
      if(id!==undefined)watches.get(id).timers.add(timer);
    }
    function validate(receiver,success,error){if(receiver!==navigator.geolocation)throw new TypeError('Illegal invocation');if(typeof success!=='function'||error!=null&&typeof error!=='function')throw new TypeError('Invalid callback')}
    class Geolocation{
      getCurrentPosition(success,error,options){validate(this,success,error);nativeCalls++;nativeOptions=options;deliver(success,error)}
      watchPosition(success,error,options){validate(this,success,error);nativeWatches++;nativeOptions=options;const id=++nextId;watches.set(id,{success,error,timers:new Set()});deliver(success,error,id);return id}
      clearWatch(id){if(this!==navigator.geolocation)throw new TypeError('Illegal invocation');if(!arguments.length)throw new TypeError('Missing ID');id=+id>>0;nativeClears++;const watch=watches.get(id);if(watch)for(const timer of watch.timers)clearTimeout(timer);watches.delete(id)}
    }
    class GeolocationCoordinates{} class GeolocationPosition{}
    Object.assign(globalThis,{Geolocation,GeolocationCoordinates,GeolocationPosition});
    globalThis.navigator={geolocation:new Geolocation(),permissions:{query:()=>{throw new Error('Wrapper must use native acquisition')}}};
    globalThis.emitNativePosition=()=>{for(const [id,watch]of watches)deliver(watch.success,watch.error,id)};
    globalThis.originalGet=Geolocation.prototype.getCurrentPosition;
  `, context);
  vm.runInContext(built.outputFiles[0].text, context);
  vm.runInContext("globalThis.installed=GeoRuntime.installGeolocationRuntime(" + JSON.stringify(profile) + ")", context);
  const run = code => vm.runInContext(code, context);
  async function flush(advance = 0) {
    clock += advance;
    for (let turn = 0; turn < 100; turn++) {
      const due = [...timers].filter(([, value]) => value.due <= clock);
      if (!due.length) return;
      for (const [id, value] of due) if (timers.delete(id)) value.callback();
      await Promise.resolve();
    }
    throw Error("Unexpected recurring native fixture jobs");
  }
  return { run, flush, pending: () => timers.size, json: code => JSON.parse(run("JSON.stringify(" + code + ")")), calls: () => JSON.parse(run("JSON.stringify(calls)")) };
}
