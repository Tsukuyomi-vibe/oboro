import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStoredZip,crc32} from '../scripts/lib/archive.mjs';
import {auditCoreManifest,auditPackagedText,shouldPackageFile} from '../scripts/lib/package-audit.mjs';

test('I23: ZIP имеет верный CRC, UTF-8 имена, данные и central-directory offsets',()=>{
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  const bytes=createStoredZip([{name:'пакет/dist/manifest.json',data:Buffer.from('{"manifest_version":3}')},{name:'пакет/README.md',data:Buffer.from('readme')}]);
  const end=bytes.length-22;assert.equal(bytes.readUInt32LE(end),0x06054b50);assert.equal(bytes.readUInt16LE(end+10),2);
  let cursor=bytes.readUInt32LE(end+16);const found=[];
  for(let index=0;index<2;index++){
    assert.equal(bytes.readUInt32LE(cursor),0x02014b50);const size=bytes.readUInt32LE(cursor+24),nameLength=bytes.readUInt16LE(cursor+28),offset=bytes.readUInt32LE(cursor+42);
    const name=bytes.subarray(cursor+46,cursor+46+nameLength).toString('utf8');assert.equal(bytes.readUInt32LE(offset),0x04034b50);assert.equal(bytes.readUInt16LE(offset+6),0x800);
    const payload=bytes.subarray(offset+30+nameLength,offset+30+nameLength+size);assert.equal(crc32(payload),bytes.readUInt32LE(cursor+16));
    found.push([name,payload.toString('utf8')]);cursor+=46+nameLength;
  }
  assert.deepEqual(found,[['пакет/README.md','readme'],['пакет/dist/manifest.json','{"manifest_version":3}']]);
});

test('I23: архив детерминирован и отклоняет выход за каталог и повторяющиеся записи',()=>{
  const entries=[{name:'dist/b.js',data:'b'},{name:'dist/a.js',data:'a'}];assert.deepEqual(createStoredZip(entries),createStoredZip([...entries].reverse()));
  for(const name of ['../secret','/absolute','C:/absolute','dist/../../secret','dist/./file','dist\\file','dist//file'])assert.throws(()=>createStoredZip([{name,data:''}]));
  assert.throws(()=>createStoredZip([{name:'a',data:''},{name:'a',data:'duplicate'}]));
});

test('I23: статический аудит пакета не допускает cookies/debugger и удалённый исполняемый код',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../src/manifest.json',import.meta.url),'utf8'));auditCoreManifest(manifest);
  for(const permission of ['cookies','debugger'])assert.throws(()=>auditCoreManifest({...manifest,permissions:[...manifest.permissions,permission]}));
  assert.throws(()=>auditCoreManifest({...manifest,host_permissions:['https://*/*']}));
  for(const [name,source]of [['page.html','<script src="https://example.com/code.js"></script>'],['app.js',"import('https://example.com/code.js')"],['app.js','eval(input)'],['app.js','new Function(input)']])assert.throws(()=>auditPackagedText(name,source));
  auditPackagedText('app.js',"const help='https://developer.chrome.com/';");
  for(const name of ['debug.log','debug.log.1','raw.har','.env','.npmrc','private.key'])assert.throws(()=>auditPackagedText(name,''));
  for(const name of ['raw-browser-report.json','debug.log','.env','private.key','profile.json'])assert.equal(shouldPackageFile('fixtures/i02',name),false);
  for(const name of ['client.js','server.mjs','styles.css','config.json'])assert.equal(shouldPackageFile('fixtures/i02',name),true);
});
