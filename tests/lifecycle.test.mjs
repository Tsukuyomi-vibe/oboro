import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {runtimePage} from './helpers/runtime-page.mjs';
import {startFixtureServer} from '../fixtures/i02/server.mjs';
import {workerScript} from '../fixtures/i22/workers.mjs';
import {fakePageReport} from './helpers/page-report.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const [bridge,diagnostics]=await Promise.all(['src/runtime/bridge.ts','src/ui/diagnostics.ts'].map(entry=>build({entryPoints:[entry],absWorkingDir:root,bundle:true,write:false,format:'iife',globalName:'FixtureApi',logLevel:'silent'})));

test('I22: MAIN пропускает непрозрачный, неизвестный и противоречивый origin',()=>{
  for(const extra of ["origin='null'","delete globalThis.origin","origin='https://foreign.test'","location=new URL('about:blank');origin='null'","location=new URL('blob:https://selected.test/id')"]){
    const page=runtimePage({extra});assert.equal(page.report,null,extra);
    assert.equal(page.run("Date===NativeDate && Date.parse===nativeParse && navigator.language==='native'"),true);
    assert.equal(page.run("window[Symbol.for('regional-profile.runtime.v1')]"),undefined);
  }
});

function bridgePage(){
  const sent=[];const posted=[];const context=vm.createContext({chrome:{runtime:{id:'extension',sendMessage:async message=>{sent.push(JSON.parse(JSON.stringify(message)));return {recorded:true}},onMessage:{addListener:listener=>{context.runtimeListener=listener}}}},
    saveListener:(name,listener)=>{context.listeners??={};context.listeners[name]=listener},post:value=>posted.push(value)});
  vm.runInContext("globalThis.window=globalThis;window.addEventListener=saveListener;window.postMessage=post",context);
  vm.runInContext(bridge.outputFiles[0].text,context);
  return {sent,posted,run:code=>vm.runInContext(code,context),receive:report=>{context.incoming=report;vm.runInContext("listeners.message({source:window,data:{type:'regional-runtime:v1',report:incoming}})",context)}};
}
test('I22: bridge передаёт только диагностику, ограничивает payload и не выполняет команды страницы',()=>{
  const page=bridgePage();const baseline=page.sent.length;
  for(const type of ['regional-control:v1','regional-profile:v1','cookies.get'])page.run(`listeners.message({source:window,data:{type:${JSON.stringify(type)},operation:'policy.save',cookieName:'session'}})`);
  assert.equal(page.sent.length,baseline);
  page.run("listeners.message({source:{},data:{type:'regional-runtime:v1',report:{activationId:'foreign'}}})");assert.equal(page.sent.length,baseline);
  page.run("listeners.message({source:window,data:{type:'regional-runtime:v1',report:{activationId:'test',implementation:6,operation:'cookies.get',cookieName:'private'}}})");
  assert.equal(page.sent.length,baseline);
  const report=fakePageReport({activationId:'synthetic-bridge',signature:'synthetic-bridge-signature',profile:{revision:1},policy:{policyRevision:1}});
  page.receive({...report,cookieName:'private'});assert.equal(page.sent.length,baseline);
  page.receive(report);assert.deepEqual(page.sent.at(-1),{channel:'regional-frame:v1',report});
  const previous=page.sent.length;
  page.run("listeners.message({source:window,data:{type:'regional-runtime:v1',report:{activationId:'test',reasons:['x'.repeat(65000)]}}})");assert.equal(page.sent.length,previous);
  page.run("runtimeListener({channel:'regional-frame:v1',operation:'ping'},{id:'foreign'})");assert.equal(page.sent.length,previous);
});

test('I22: синтетический pageshow не выдаётся за нативное восстановление BFCache',()=>{
  const page=bridgePage();const before=page.sent.length;
  page.run("listeners.pageshow({isTrusted:false,persisted:true});listeners.pagehide({isTrusted:false,persisted:true})");assert.equal(page.sent.length,before);
  page.run("listeners.pagehide({isTrusted:true,persisted:true})");assert.equal(page.sent.at(-1).event,'pagehide');assert.equal(page.sent.at(-1).persisted,true);
  page.run("listeners.pageshow({isTrusted:true,persisted:true})");assert.equal(page.sent.at(-1).event,'pageshow');assert.equal(page.sent.at(-1).persisted,true);
});

test('I22: workers стенда явно сообщают отсутствие MAIN runtime и сохраняют независимый realm',()=>{
  for(const kind of ['dedicated','shared','service']){
    const callbacks={};const received=[];const endpoint={postMessage:value=>received.push(value),start(){}};
    const context=vm.createContext({navigator:{language:'native-worker',languages:['native-worker']},origin:'https://selected.test',addEventListener:(name,callback)=>{callbacks[name]=callback},postMessage:value=>received.push(value)});
    vm.runInContext('globalThis.self=globalThis',context);vm.runInContext(workerScript(kind),context);
    if(kind==='shared'){context.onconnect({ports:[endpoint]});endpoint.onmessage({data:{type:'region-fixture-snapshot'}})}
    else callbacks.message({data:{type:'region-fixture-snapshot'},ports:[endpoint]});
    assert.equal(received[0].kind,kind);assert.equal(received[0].language,'native-worker');assert.equal(received[0].baseRuntimeInjected,false);assert.equal(received[0].date.timestamp,1705320000123);
    assert.equal(received[0].keyboardApi,false);
  }
});

test('I22: HTTP-стенд предоставляет все worker scripts и lifecycle, без автоматического запуска workers',async t=>{
  const server=await startFixtureServer({port:0});t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
  const get=pathname=>new Promise((resolve,reject)=>{const request=http.get({hostname:'127.0.0.1',port:server.address().port,path:pathname,headers:{Host:'selected.localhost:'+server.address().port}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,type:response.headers['content-type'],body:Buffer.concat(chunks).toString('utf8')}))});request.on('error',reject)});
  for(const name of ['dedicated','shared','service']){const response=await get('/i22/'+name+'-worker.js');assert.equal(response.status,200);assert.match(response.type,/javascript/);assert.equal(response.body,workerScript(name));}
  const page=await get('/lifecycle-target?run=lifecycle-unit');assert.equal(page.status,200);assert.match(page.body,/Жизненный цикл страниц и границы покрытия/);assert.match(page.body,/id="run-workers"/);
  const client=await get('/i22-client.js');assert.equal(client.status,200);assert.match(client.body,/addEventListener\('click',async\(\)=>/);
  assert.ok(client.body.includes("scope:'/i22/sw-scope/'"));assert.ok(client.body.includes("registration?.scope===expected"));
});

test('I22: UI показывает actual/expected revision, модульные пробелы и выводит недоверенный текст безопасно',async t=>{
  const html=await readFile(new URL('../src/options/options.html',import.meta.url),'utf8');const dom=new JSDOM(html,{runScripts:'outside-only'});t.after(()=>dom.window.close());
  vm.runInContext(diagnostics.outputFiles[0].text,dom.getInternalVMContext());
  const row={tabId:7,frameId:0,documentId:'cached-document',origin:'https://example.com',lifecycle:'cached',lastEvent:'pagehide.persisted',profileRevision:1,expectedProfileRevision:2,policyRevision:3,expectedPolicyRevision:4,status:'NEEDS_RELOAD',languages:'installed',geolocation:'error',locale:'installed',time:'partial',temporal:'absent',keyboard:'unsupported',reasons:['<img src=x onerror=alert(1)>']};
  dom.window.FixtureApi.renderDocumentCoverage([row],{phase:'awaiting_documents',recovery:'resumed'});
  const text=dom.window.document.getElementById('document-coverage').textContent;
  assert.match(text,/Профиль: 1; ожидается 2.*Политика: 3; ожидается 4/);assert.match(text,/BFCache/);assert.match(text,/Не поддержан/);assert.ok(text.includes('<img src=x onerror=alert(1)>'));
  assert.equal(dom.window.document.querySelector('#document-coverage img'),null);
  assert.match(dom.window.document.querySelector('.coverage-gap').textContent,/Workers: no baseline overrides/);
  assert.match(dom.window.document.querySelector('#recovery-state').textContent,/не завершено/);
});
