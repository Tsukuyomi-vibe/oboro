import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {keyboardPage} from "./helpers/keyboard-page.mjs";
import {runtimePage} from "./helpers/runtime-page.mjs";
const bundle=await build({stdin:{contents:"export * from './src/keyboard/layouts.ts'; export * from './src/profile/index.ts';",resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,write:false,format:'esm',logLevel:'silent'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const json=(page,expression)=>JSON.parse(page.run('JSON.stringify('+expression+')'));
async function map(page){await page.run('navigator.keyboard.getLayoutMap().then(value=>{globalThis.layoutMap=value})');}

test("I19: каталог содержит три проверенные карты, нормализует старый профиль в native без записи",()=>{
  assert.deepEqual(api.KEYBOARD_LAYOUT_IDS,['native','us-qwerty','de-qwertz','ru-jcuken']);
  for(const entry of api.KEYBOARD_LAYOUTS){
    assert.equal(new Set(entry.entries.map(([key])=>key)).size,entry.entries.length);
    assert.equal(Object.isFrozen(entry.entries),true);
    if(entry.id!=='native')assert.equal(entry.entries.length,49);
  }
  const legacy=JSON.parse(JSON.stringify(api.getExampleProfile()));delete legacy.keyboardLayout;
  assert.equal(api.parseRegionalProfile(legacy).keyboardLayout,'native');
  for(const value of [null,{},'',true,'fr','__proto__'])assert.throws(()=>api.parseProfileDraft({...api.getExampleProfileDraft(),keyboardLayout:value}),error=>error.issues[0].path==='keyboardLayout');
});

test("I19: get/has/size и все итераторы используют выбранную карту, сохраняя класс и native cache identity",async()=>{
  for(const [layout,y,z,quote] of [['us-qwerty','y','z',"'"],['de-qwertz','z','y','ä'],['ru-jcuken','н','я','э']]){
    const page=keyboardPage({layout});await map(page);
    assert.equal(page.report.keyboard,'installed');assert.equal(page.report.keyboardLayout,layout);
    assert.equal(page.run('layoutMap.size'),49);
    assert.deepEqual(json(page,"[layoutMap.get('KeyY'),layoutMap.get('KeyZ'),layoutMap.get('Quote'),layoutMap.has('NativeOnly'),layoutMap.has('Space'),layoutMap.get('Unknown')]"),[y,z,quote,false,true,null]);
    assert.deepEqual(json(page,'[...layoutMap]'),api.KEYBOARD_LAYOUTS.find(entry=>entry.id===layout).entries);
    assert.deepEqual(json(page,'[...layoutMap.keys()]'),json(page,'[...layoutMap.entries()].map(pair=>pair[0])'));
    assert.deepEqual(json(page,'[...layoutMap.values()]'),json(page,'[...layoutMap].map(pair=>pair[1])'));
    assert.equal(page.run("layoutMap instanceof KeyboardLayoutMap && Object.getPrototypeOf(layoutMap)===KeyboardLayoutMap.prototype && Object.prototype.toString.call(layoutMap)==='[object KeyboardLayoutMap]'"),true);
    assert.equal(await page.run('navigator.keyboard.getLayoutMap().then(value=>value===layoutMap && value===cachedKeyboardMap)'),true);
    assert.equal(page.run('nativeKeyboardCalls'),2);
    assert.equal(page.run('layoutMap[Symbol.iterator]===layoutMap.entries'),true);
  }
});

test("I19: forEach сохраняет callback/thisArg/третий аргумент; maplike остаётся readonly",async()=>{
  const page=keyboardPage();await map(page);
  assert.equal(page.run("const receiver={};let count=0;layoutMap.forEach(function(value,key,map){if(this!==receiver||map!==layoutMap||value!==map.get(key))throw Error('callback');count++},receiver);count"),49);
  assert.equal(page.run("layoutMap.forEach(()=>{})===undefined && !('set' in layoutMap) && !('delete' in layoutMap) && !('clear' in layoutMap)"),true);
  assert.throws(()=>page.run('layoutMap.forEach(null)'));
  assert.throws(()=>page.run("Map.prototype.get.call(layoutMap,'KeyY')"));
  assert.throws(()=>page.run('new KeyboardLayoutMap()'));
});

test("I19: WebIDL-ключ приводится один раз, проверки receiver и ошибки аргументов сохранены",async()=>{
  const page=keyboardPage();await map(page);
  assert.equal(page.run("let calls=0;const value=layoutMap.get({toString(){calls++;return 'KeyY'}});value==='z'&&calls===1"),true);
  for(const expression of ["layoutMap.get()","layoutMap.has()","layoutMap.get(Symbol())","layoutMap.has(Symbol())","KeyboardLayoutMap.prototype.get.call({},'KeyY')","Object.getOwnPropertyDescriptor(KeyboardLayoutMap.prototype,'size').get.call({})","new navigator.keyboard.getLayoutMap()"]){assert.throws(()=>page.run(expression),undefined,expression);}
  await assert.rejects(page.run('navigator.keyboard.getLayoutMap.call({})'),error=>error.name==='TypeError');
  assert.equal(page.run("navigator.keyboard.getLayoutMap.name==='getLayoutMap' && navigator.keyboard.getLayoutMap.length===0 && KeyboardLayoutMap.prototype.get.name==='get' && KeyboardLayoutMap.prototype.get.length===1"),true);
});

test("I19: нативные отказы permission/focus не превращаются в успешную карту",async()=>{
  const page=keyboardPage();
  for(const name of ['SecurityError','InvalidStateError','NotAllowedError']){
    page.run(`nativeKeyboardFailure=new DOMException('native denial','${name}')`);
    await assert.rejects(page.run('navigator.keyboard.getLayoutMap()'),error=>error===page.run('nativeKeyboardFailure'));
  }
  assert.equal(page.run('nativeKeyboardCalls'),3);
  assert.equal(page.run('cachedKeyboardMap'),null);
});

test("I19: fixed map подавляет только trusted layoutchange системы, обработчики страницы и другие события сохранены",async()=>{
  const page=keyboardPage();await map(page);
  page.run("globalThis.events=[];navigator.keyboard.addEventListener('layoutchange',()=>events.push('listener'));navigator.keyboard.onlayoutchange=()=>events.push('handler');navigator.keyboard.addEventListener('keydown',event=>events.push(event.key+event.code));");
  page.run('fireLayoutChange(true)');assert.deepEqual(json(page,'events'),[]);
  page.run('fireLayoutChange(false)');assert.deepEqual(json(page,'events'),['listener','handler']);
  page.run("navigator.keyboard.dispatchEvent(new KeyboardEvent('keydown',{key:'я',code:'KeyZ',isComposing:true}))");
  assert.deepEqual(json(page,'events'),['listener','handler','яKeyZ']);
  assert.equal(page.run("KeyboardEvent===originalKeyboardEvent&&CompositionEvent===originalCompositionEvent&&new CompositionEvent('compositionupdate',{data:'文'}).data==='文'"),true);
  assert.equal(await page.run("navigator.keyboard.lock()"),'native-lock');
  assert.equal(page.run('navigator.keyboard.unlock()'),'native-unlock');
  assert.equal(page.run("layoutMap.get('KeyY')"),'z');
});

test("I19: native, контрольный и поздний документы не получают обёрток или подавления layoutchange",async()=>{
  for(const options of [{layout:'native'},{host:'control.test'},{extra:"document.readyState='complete'"}]){
    const page=keyboardPage(options);
    assert.equal(page.run('Keyboard.prototype.getLayoutMap===originalKeyboard.getLayoutMap.value && KeyboardLayoutMap.prototype.get===originalLayout.get.value'),true);
    assert.equal(await page.run("navigator.keyboard.getLayoutMap().then(value=>value.get('KeyY'))"),'native-y');
    assert.equal(page.run("let seen=0;navigator.keyboard.addEventListener('layoutchange',()=>seen++);fireLayoutChange(true);seen"),1);
    if(options.layout==='native')assert.equal(page.report.keyboard,'native');
    else if(options.host)assert.equal(page.report,null);
    else assert.equal(page.report.keyboard,'not_checked');
  }
});

test("I19: отсутствующий API, unsafe context и policy denial отмечаются явно без создания API",()=>{
  const absent=runtimePage({keyboardLayout:'de-qwertz'});
  assert.equal(absent.report.keyboard,'unsupported');assert.equal(absent.run("'keyboard' in navigator"),false);
  for(const extra of ["isSecureContext=false","document.permissionsPolicy={allowsFeature:()=>false}","delete KeyboardLayoutMap.prototype.values"]){
    const page=keyboardPage({extra});assert.equal(page.report.keyboard,'unsupported');
    assert.equal(page.run('Keyboard.prototype.getLayoutMap===originalKeyboard.getLayoutMap.value'),true);
  }
});

test("I19: запертый descriptor не оставляет частичную карту; прежние нетегированные карты нативны",async()=>{
  const locked=keyboardPage({extra:"Object.defineProperty(Keyboard.prototype,'getLayoutMap',{value:Keyboard.prototype.getLayoutMap,writable:false,configurable:false})"});
  assert.equal(locked.report.keyboard,'error');
  assert.equal(locked.run('KeyboardLayoutMap.prototype.get===originalLayout.get.value'),true);
  const page=keyboardPage();await map(page);
  assert.equal(page.run("unrelatedMap.get('KeyY')"),'native-y');
  assert.equal(page.run('unrelatedMap.size'),4);
  assert.equal(page.run("[...unrelatedMap].some(([key])=>key==='NativeOnly')"),true);
});
