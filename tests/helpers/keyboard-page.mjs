import {runtimePage} from "./runtime-page.mjs";

// Realm-local WebIDL-shaped test double. This is not native Chrome acceptance.
export const nativeKeyboardFixture=String.raw`
  const maps=new WeakMap(); const token={};
  const entries=[['KeyY','native-y'],['KeyZ','native-z'],['Space',' '],['NativeOnly','native-entry']];
  function contents(receiver){if(!maps.has(receiver))throw new TypeError('Illegal invocation');return maps.get(receiver)}
  function key(args){if(!args.length)throw new TypeError('1 argument required');if(typeof args[0]==='symbol')throw new TypeError('Symbol');return String(args[0])}
  class KeyboardLayoutMap {
    constructor(secret){if(secret!==token)throw new TypeError('Illegal constructor');maps.set(this,new Map(entries))}
    get size(){return contents(this).size}
    get(code){const data=contents(this);return data.get(key(arguments))}
    has(code){const data=contents(this);return data.has(key(arguments))}
    entries(){return contents(this).entries()}
    keys(){return contents(this).keys()}
    values(){return contents(this).values()}
    forEach(callback,thisArg){const data=contents(this);if(typeof callback!=='function')throw new TypeError('callback');data.forEach((value,key)=>callback.call(thisArg,value,key,this))}
  }
  Object.defineProperty(KeyboardLayoutMap.prototype,Symbol.iterator,{value:KeyboardLayoutMap.prototype.entries,writable:true,configurable:true});
  Object.defineProperty(KeyboardLayoutMap.prototype,Symbol.toStringTag,{value:'KeyboardLayoutMap',configurable:true});
  class Keyboard extends EventTarget {
    getLayoutMap(){
      if(this!==navigator.keyboard)return Promise.reject(new TypeError('Illegal invocation'));
      nativeKeyboardCalls++;
      if(nativeKeyboardFailure)return Promise.reject(nativeKeyboardFailure);
      if(!cachedKeyboardMap)cachedKeyboardMap=new KeyboardLayoutMap(token);
      return Promise.resolve(cachedKeyboardMap);
    }
    get onlayoutchange(){return this.handler??null}
    set onlayoutchange(value){if(this.handler)this.removeEventListener('layoutchange',this.handler);this.handler=typeof value==='function'?value:null;if(this.handler)this.addEventListener('layoutchange',this.handler)}
    lock(){return Promise.resolve('native-lock')}
    unlock(){return 'native-unlock'}
  }
  globalThis.Keyboard=Keyboard; globalThis.KeyboardLayoutMap=KeyboardLayoutMap;
  Object.defineProperty(Navigator.prototype,'keyboard',{get(){if(this!==navigator)throw new TypeError('Illegal invocation');return keyboard},configurable:true});
  const keyboard=new Keyboard();
  globalThis.nativeKeyboardCalls=0;globalThis.nativeKeyboardFailure=null;globalThis.cachedKeyboardMap=null;
  globalThis.unrelatedMap=new KeyboardLayoutMap(token);
  globalThis.originalKeyboard=Object.getOwnPropertyDescriptors(Keyboard.prototype);
  globalThis.originalLayout=Object.getOwnPropertyDescriptors(KeyboardLayoutMap.prototype);
  globalThis.fireLayoutChange=(trusted=false)=>{const event=new Event('layoutchange');Object.defineProperty(event,'isTrusted',{value:trusted});keyboard.dispatchEvent(event)};
  globalThis.KeyboardEvent=class KeyboardEvent extends Event {constructor(type,options={}){super(type);Object.defineProperties(this,{key:{value:options.key},code:{value:options.code},isComposing:{value:options.isComposing??false}})}};
  globalThis.CompositionEvent=class CompositionEvent extends Event {constructor(type,options={}){super(type);Object.defineProperty(this,'data',{value:options.data})}};
  globalThis.originalKeyboardEvent=KeyboardEvent;globalThis.originalCompositionEvent=CompositionEvent;
  globalThis.isSecureContext=true;
`;
export function keyboardPage({layout="de-qwertz",extra="",...options}={}){
  return runtimePage({...options,keyboardLayout:layout,globals:{EventTarget,Event,DOMException,...options.globals},beforeRuntime:nativeKeyboardFixture,extra});
}
