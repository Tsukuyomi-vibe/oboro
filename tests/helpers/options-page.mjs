import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {JSDOM} from "jsdom";
import {runtimeBundle} from "../../scripts/runtime-build.mjs";
import {syntheticI02Evidence,SYNTHETIC_CHROME} from "./i02-evidence.mjs";
import {fakePageReport} from "./page-report.mjs";
const root=fileURLToPath(new URL('../../',import.meta.url));
const runtime=await runtimeBundle(root);
const bundles=await Promise.all(['src/options/options.ts','src/background/service-worker.ts'].map(entry=>build({entryPoints:[entry],absWorkingDir:root,bundle:true,write:false,format:'iife',platform:'browser',define:{__REGION_RUNTIME_BUNDLE__:JSON.stringify(runtime)},logLevel:'silent'})));
const html=await readFile(new URL('../../src/options/options.html',import.meta.url),'utf8');
const example=JSON.parse(await readFile(new URL('../../examples/berlin.regional-profile.json',import.meta.url),'utf8'));
const languageScript=await readFile(new URL('../../src/ui/language.js',import.meta.url),'utf8');
const themeScript=await readFile(new URL('../../src/ui/theme.js',import.meta.url),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const extensionId='a'.repeat(32);
const rule=(host)=>({host,schemes:['https'],includeSubdomains:false});
export const exampleProfile=()=>copy(example);
export const testSitePolicy=(mode='selected_sites')=>({schemaVersion:1,policyRevision:1,mode,include:[rule('example.com')],exclude:[rule('blocked.example.com')]});
function event(convert=(value)=>value){const handlers=[];return {handlers,addListener:handler=>handlers.push(handler),emit:(...args)=>{for(const handler of handlers)handler(...args.map(convert))}};}

// Actual UI and service worker bundles with in-memory Chrome APIs and synthetic
// M0/lifecycle/ACK evidence. No extension is installed and no native browser API
// availability is established by this fixture.
export function optionsPage({profile=null,policy,origins=[],proof=false,ack=true,language="ru",uiStorage={},initial={}}={}){
  const dom=new JSDOM(html,{url:`chrome-extension://${extensionId}/options/options.html`,runScripts:'outside-only'});
  const {window}=dom;
  // jsdom treats chrome-extension as opaque; native Chrome provides localStorage.
  const storageDom=new JSDOM('',{url:'https://oboro-ui-storage.test/'});
  Object.defineProperty(window,'localStorage',{value:storageDom.window.localStorage});
  for(const [key,value] of Object.entries(uiStorage))window.localStorage.setItem(key,value);
  if(language!==null)window.localStorage.setItem("oboro.language",language);
  window.eval(themeScript);
  window.eval(languageScript);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  const uiCopy=value=>window.JSON.parse(JSON.stringify(value));
  const data=copy(initial);if(profile)data.regionalProfile=copy(profile);if(policy)data.sitePolicy=copy(policy);
  if(proof)data.capabilityEvidence={report:syntheticI02Evidence()};
  const session={}; const calls=[]; const messages=[]; const uiChanges=event(uiCopy);
  let worker; const workerCopy=value=>vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify(value))+')',worker);
  const workerChanges=event(workerCopy);
  const faults={denyPermission:false,profileWrite:false,transportSave:false,concurrentProfile:null};
  let grants=[...origins];let main=[];let bridge=[];let rules=[];let documentId='initial-doc';let serial=0;
  const storage=(target,area)=>({get:async key=>workerCopy(Object.hasOwn(target,key)?{[key]:target[key]}:{}),set:async values=>{
    if(faults.profileWrite&&Object.hasOwn(values,'regionalProfile'))throw Error('synthetic storage failure');
    const changed={};for(const [key,value] of Object.entries(values)){changed[key]={oldValue:target[key],newValue:copy(value)};target[key]=copy(value)}
    if(area==='local')queueMicrotask(()=>{workerChanges.emit(changed,area);uiChanges.emit(changed,area)});
  }});
  const committed=event(workerCopy);const completed=event(workerCopy);const removed=event(workerCopy);
  const workerAdded=event(workerCopy),workerRemoved=event(workerCopy),uiAdded=event(uiCopy),uiRemoved=event(uiCopy);
  const runtimeMessages=event();
  const sender=()=>workerCopy({id:extensionId,url:`chrome-extension://${extensionId}/options/options.html`,origin:`chrome-extension://${extensionId}`});
  const sendWorker=(message,nativeSender=sender())=>new Promise((resolve,reject)=>{
    let answered=false;
    const respond=value=>{answered=true;resolve(copy(value))};
    try{
      for(const listener of runtimeMessages.handlers){const pending=listener(workerCopy(message),nativeSender,respond);if(answered||pending)return;}
      reject(Error('No message listener'));
    }catch(error){reject(error)}
  });
  const currentFrame=()=>({tabId:7,frameId:0,parentFrameId:-1,documentId,url:'https://example.com/',documentLifecycle:'active'});
  const reload=async(tabId)=>{
    calls.push('reload:'+tabId);documentId='ui-doc-'+(++serial);committed.emit({...currentFrame(),transitionType:'reload'});
    if(main.length&&ack){
      const snapshot=data.activationJournal?.target??data.activationSnapshot;
      const layout=data.regionalProfile.keyboardLayout??'native';
      const report=fakePageReport(snapshot,{timeCompatibility:{status:'passed',structuredClone:'passed',checks:['synthetic-ui-ack'],failures:[]},keyboard:layout==='native'?'native':'installed',keyboardLayout:layout});
      await sendWorker({channel:'regional-frame:v1',report},workerCopy({id:extensionId,tab:{id:tabId},frameId:0,documentId,url:'https://example.com/',origin:'https://example.com',documentLifecycle:'active'}));
    }
    completed.emit(currentFrame());
  };
  const contains=async({origins:requested})=>requested.every(origin=>grants.includes(origin)||grants.includes('https://*/*')&&origin.startsWith('https:'));
  const baseChrome={
    runtime:{id:extensionId,getManifest:()=>({version:'0.1.0'}),onMessage:runtimeMessages,onInstalled:event(),onStartup:event()},
    storage:{local:storage(data,'local'),session:storage(session,'session'),onChanged:workerChanges},
    permissions:{getAll:async()=>workerCopy({origins:grants}),contains,onAdded:workerAdded,onRemoved:workerRemoved},
    tabs:{query:async()=>workerCopy([{id:7,url:'https://example.com/',status:'complete'}]),reload,onRemoved:removed,sendMessage:async()=>({})},
    webNavigation:{getAllFrames:async()=>workerCopy([currentFrame()]),onCommitted:committed,onCompleted:completed},
    userScripts:{getScripts:async({ids}={})=>copy(main.filter(item=>!ids||ids.includes(item.id))),register:async list=>{calls.push('register:main');main.push(...copy(list))},unregister:async({ids})=>{main=main.filter(item=>!ids.includes(item.id))}},
    scripting:{getRegisteredContentScripts:async({ids}={})=>copy(bridge.filter(item=>!ids||ids.includes(item.id))),registerContentScripts:async list=>{bridge.push(...copy(list))},unregisterContentScripts:async({ids})=>{bridge=bridge.filter(item=>!ids.includes(item.id))}},
    declarativeNetRequest:{getDynamicRules:async()=>copy(rules),updateDynamicRules:async({removeRuleIds=[],addRules=[]})=>{rules=[...rules.filter(item=>!removeRuleIds.includes(item.id)),...copy(addRules)]}}
  };
  worker=vm.createContext({chrome:baseChrome,URL,console,setTimeout,clearTimeout,TextEncoder,crypto:{randomUUID:()=>`ui-activation-${++serial}`},navigator:{userAgent:`Synthetic UI fixture Chrome/${SYNTHETIC_CHROME}`,userAgentData:{getHighEntropyValues:async()=>({fullVersionList:[{brand:'Google Chrome',version:SYNTHETIC_CHROME}]})}}});
  vm.runInContext(bundles[1].outputFiles[0].text,worker);
  window.chrome={...baseChrome,
    runtime:{...baseChrome.runtime,sendMessage:async message=>{
      messages.push(copy(message));
      if(faults.transportSave&&message.channel==='regional-profile:v1'&&message.operation==='save')throw Error('synthetic transport failure');
      const response=await sendWorker(copy(message));
      if(message.operation==='save'&&faults.concurrentProfile){
        const next=faults.concurrentProfile;faults.concurrentProfile=null;
        await baseChrome.storage.local.set(workerCopy({regionalProfile:next}));
      }
      return uiCopy(response);
    }},
    storage:{onChanged:uiChanges},
    permissions:{getAll:async()=>uiCopy({origins:grants}),contains,onAdded:uiAdded,onRemoved:uiRemoved,request:requested=>{
      calls.push('permission.request');const allowed=!faults.denyPermission;
      if(allowed){grants=[...new Set([...grants,...requested.origins])];queueMicrotask(()=>{workerAdded.emit(requested);uiAdded.emit(requested)})}
      return Promise.resolve(allowed);
    }}
  };
  window.eval(bundles[0].outputFiles[0].text);
  const flush=async()=>{for(let turn=0;turn<12;turn++)await new Promise(setImmediate)};
  const set=(name,value)=>{const field=window.document.querySelector(`#profile-form [name="${name}"]`);field.value=value;field.dispatchEvent(new window.Event(field.tagName==='SELECT'?'change':'input',{bubbles:true}))};
  return {window,document:window.document,dom,flush,set,calls,messages,faults,
    control:(operation,fields={})=>window.chrome.runtime.sendMessage({channel:'regional-control:v1',operation,...fields}),
    snapshot:()=>copy(data),installed:()=>({main:copy(main),bridge:copy(bridge),rules:copy(rules)}),
    externalProfile:async value=>{await baseChrome.storage.local.set(workerCopy({regionalProfile:value}));await flush()},
    externalProfileWithoutEvent:value=>{data.regionalProfile=copy(value)},
    close:()=>{window.close();storageDom.window.close()},
    query:selector=>window.document.querySelector(selector),
    click:selector=>window.document.querySelector(selector).click(),
    submit:selector=>window.document.querySelector(selector).dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})),
    changeMode:value=>{const field=window.document.querySelector('#site-selection-mode');field.value=value;field.dispatchEvent(new window.Event('change',{bubbles:true}))}
  };
}
