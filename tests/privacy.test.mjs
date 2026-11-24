import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {runtimePage} from './helpers/runtime-page.mjs';
import {fakePageReport,reportApi} from './helpers/page-report.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({stdin:{contents:"export * from './src/runtime/sha256.ts'; export * from './src/runtime/compiler.ts';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'browser',define:{__REGION_RUNTIME_BUNDLE__:'""'},logLevel:'silent'});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const example=JSON.parse(await readFile(new URL('../examples/berlin.regional-profile.json',import.meta.url),'utf8'));
const hex=value=>Buffer.from(value).toString('hex');
function snapshot(id='synthetic-private-activation',revision=1){return api.createRuntimeSnapshot({...example,name:'synthetic-private-profile-name',revision},{schemaVersion:1,policyRevision:1,mode:'all_granted_sites',include:[],exclude:[]},['https://selected.test/*','https://private-example.test/*'],id,false)}
function install(current,origin='https://selected.test'){
  const messages=[];const page=runtimePage({host:'outside.test',globals:{capture:value=>messages.push(JSON.parse(JSON.stringify(value)))}});
  page.run('location=new URL('+JSON.stringify(origin+'/')+');origin=location.origin;postMessage=value=>capture(value)');
  const report=page.run('RegionRuntime.installMainRuntime('+JSON.stringify(current)+')');
  return {...page,report,messages};
}

test('privacy: SHA-256 и HMAC совпадают с эталонными векторами RFC 4231',()=>{
  assert.equal(hex(api.sha256(Buffer.from(''))),'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(api.sha256(Buffer.from('abc'))),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(hex(api.hmacSha256(Buffer.alloc(20,0x0b),Buffer.from('Hi There'))),'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  assert.equal(hex(api.hmacSha256(Buffer.from('Jefe'),Buffer.from('what do ya want for nothing?'))),'5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  assert.equal(hex(api.hmacSha256(Buffer.alloc(131,0xaa),Buffer.from('Test Using Larger Than Block-Size Key - Hash Key First'))),'60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
});

test('privacy: SHA-256 и HMAC совпадают с node:crypto на границах блоков и длинных сообщениях',()=>{
  for(const length of [0,1,55,56,63,64,65,127,128,129,1024,65535]){
    const bytes=Buffer.from(Array.from({length},(_,i)=>(i*31+7)&255));
    assert.equal(hex(api.sha256(bytes)),createHash('sha256').update(bytes).digest('hex'));
    for(const size of [0,1,20,64,65,131]){
      const key=Buffer.from(Array.from({length:size},(_,i)=>(i*17+19)&255));
      assert.equal(hex(api.hmacSha256(key,bytes)),createHmac('sha256',key).update(bytes).digest('hex'));
    }
  }
});

test('privacy: глобальный маркер и postMessage не раскрывают grants, имена, версии и activationId',()=>{
  const current=snapshot();const page=install(current);
  const marker=page.run("window[Symbol.for('regional-profile.runtime.v1')]");
  assert.equal(typeof marker,'function');assert.equal(marker.signature,undefined);assert.equal(marker.report,undefined);
  assert.equal(marker.length,0);
  const visible=JSON.stringify({report:marker(),messages:page.messages,source:marker.toString(),properties:Object.getOwnPropertyDescriptors(marker)});
  for(const value of [current.activationId,current.profile.name,'private-example.test','grantedOrigins','activationId','profileRevision','policyRevision','signature'])assert.ok(!visible.includes(value),value);
  const decoded=reportApi.authenticatePageRuntimeReport(page.report,current,'https://selected.test');
  assert.equal(decoded.activationId,current.activationId);assert.equal(decoded.profileRevision,1);
});

test('privacy: разные документы получают разные proof/nonce даже при одном применении',()=>{
  const current=snapshot();const first=install(current),second=install(current,'https://private-example.test'),third=install(current);
  assert.equal(new Set([first.report.documentNonce,second.report.documentNonce,third.report.documentNonce]).size,3);
  assert.equal(new Set([first.report.proof,second.report.proof,third.report.proof]).size,3);
  const reader=first.run("window[Symbol.for('regional-profile.runtime.v1')]");
  assert.equal(reader('chosen-common-nonce',current.activationId).documentNonce,first.report.documentNonce);
});

test('privacy: изменённые сообщения, другой origin и другая конфигурация не подтверждают применение',()=>{
  const current=snapshot(),page=install(current),report=JSON.parse(JSON.stringify(page.report));
  assert.ok(reportApi.authenticatePageRuntimeReport(report,current,'https://selected.test'));
  for(const changed of [{...report,languages:'error'},{...report,proof:'0'.repeat(64)},{...report,documentNonce:'0'.repeat(32)},{...report,activationId:current.activationId},{...report,grants:current.grantedOrigins}])assert.equal(reportApi.authenticatePageRuntimeReport(changed,current,'https://selected.test'),null);
  assert.equal(reportApi.authenticatePageRuntimeReport(report,current,'https://private-example.test'),null);
  assert.equal(reportApi.authenticatePageRuntimeReport(report,snapshot('another-private-id'),'https://selected.test'),null);
  assert.equal(reportApi.authenticatePageRuntimeReport(report,snapshot(current.activationId,2),'https://selected.test'),null);
  assert.equal(reportApi.readPageRuntimeReport({activationId:current.activationId,implementation:6}),null);
  const valid=fakePageReport(current,{},'https://selected.test');assert.ok(reportApi.authenticatePageRuntimeReport(valid,current,'https://selected.test'));
});

test('privacy: повтор той же версии не наслаивает обёртки; новая версия требует reload',()=>{
  const current=snapshot(),page=install(current);
  const getter=page.run("Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get");
  const same=page.run('RegionRuntime.installMainRuntime('+JSON.stringify(current)+')');
  assert.equal(same.documentNonce,page.report.documentNonce);assert.equal(same.proof,page.report.proof);
  const changed=page.run('RegionRuntime.installMainRuntime('+JSON.stringify(snapshot('updated-private-id'))+')');
  assert.equal(changed.needsReload,true);
  assert.equal(page.run("Object.getOwnPropertyDescriptor(Navigator.prototype,'language').get"),getter);
  assert.ok(!JSON.stringify(page.messages).includes('updated-private-id'));
});

test('privacy: старый маркер не переиздаёт личные поля; для его удаления нужен reload',()=>{
  const current=snapshot();const page=runtimePage({host:'outside.test'});
  page.run("globalThis.sent=[];location=new URL('https://selected.test/');origin=location.origin;postMessage=value=>sent.push(value);Object.defineProperty(window,Symbol.for('regional-profile.runtime.v1'),{value:{signature:'legacy-private-grants',report:{activationId:'legacy-private-id'}}})");
  const report=page.run('RegionRuntime.installMainRuntime('+JSON.stringify(current)+')');
  assert.equal(report.needsReload,true);assert.equal(page.run('navigator.language'),'native');
  const sent=page.run('JSON.stringify(sent)');assert.ok(!sent.includes('legacy-private-grants'));assert.ok(!sent.includes('legacy-private-id'));
});

test('privacy: отсутствие безопасной случайности не заменяется Math.random',()=>{
  const page=runtimePage({host:'outside.test',globals:{crypto:undefined}});
  page.run("location=new URL('https://selected.test/');origin=location.origin");
  assert.throws(()=>page.run('RegionRuntime.installMainRuntime('+JSON.stringify(snapshot())+')'));
  assert.equal(page.run('navigator.language'),'native');assert.equal(page.run("window[Symbol.for('regional-profile.runtime.v1')]"),undefined);
});

test('privacy: посторонняя функция маркера не получает закрытые аргументы',()=>{
  const current=snapshot(),page=runtimePage({host:'outside.test'});
  page.run("location=new URL('https://selected.test/');origin=location.origin;globalThis.received=[];Object.defineProperty(window,Symbol.for('regional-profile.runtime.v1'),{value:(...args)=>{received=args;throw Error('synthetic unrelated marker')}})");
  const report=page.run('RegionRuntime.installMainRuntime('+JSON.stringify(current)+')');
  assert.equal(report.needsReload,true);assert.equal(page.run('received.length'),0);assert.equal(page.run('navigator.language'),'native');
  assert.ok(!JSON.stringify(report).includes(current.activationId));
});
