import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStoredZip} from './lib/archive.mjs';
import {auditCoreManifest,auditPackagedText,shouldPackageFile} from './lib/package-audit.mjs';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const output=path.join(root,'artifacts','release');
if(path.relative(root,output)!==path.join('artifacts','release'))throw Error('Invalid package output');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const core=JSON.parse(await readFile(path.join(root,'dist/manifest.json'),'utf8'));
const probe=JSON.parse(await readFile(path.join(root,'dist-probe/manifest.json'),'utf8'));
const matrix=JSON.parse(await readFile(path.join(root,'docs/core-acceptance-matrix.json'),'utf8'));
auditCoreManifest(core);if(core.version!==pkg.version)throw Error('Stale core build');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function directory(relative,prefix){
  const base=path.resolve(root,relative);if(path.relative(root,base).startsWith('..'))throw Error('Invalid package source');
  const entries=[];
  for(const name of (await readdir(base,{recursive:true})).sort()){
    if(!shouldPackageFile(relative,name.split(path.sep).join('/')))continue;
    const absolute=path.join(base,name);const info=await lstat(absolute);
    if(info.isSymbolicLink())throw Error('Symlink is not allowed in package');if(!info.isFile())continue;
    const relativeName=name.split(path.sep).join('/');const data=await readFile(absolute);
    auditPackagedText(relativeName,data.toString('utf8'));
    entries.push({name:prefix+'/'+relativeName,data});
  }
  return entries;
}
if(probe.version!==pkg.version||matrix.packageVersion!==pkg.version)throw Error('Stale probe build or browser matrix version');
const docs=['docs/releases/'+pkg.version+'.md','docs/core-acceptance-matrix.json','docs/core-package-readme.en.md','docs/core-package-readme.md','docs/configuration-format.md','schemas/oboro-config.v1.schema.json','schemas/oboro-config.v2.schema.json','docs/privacy.md','artifacts/verification-summary.json','artifacts/oboro-'+pkg.version+'-contrast.json'];
async function packagedReadmes(prefix,englishFile,russianFile){
  const translations=new Map([[englishFile,'README.md'],[russianFile,'README.ru.md']]);
  const entries=[];
  for(const [file,name]of translations){
    const text=(await readFile(path.join(root,'docs',file),'utf8')).replace(/\]\((?!https?:|#)([^)]+)\)/g,(_match,target)=>']('+(translations.get(target)??path.posix.normalize('docs/'+target))+')');
    entries.push({name:prefix+'/'+name,data:Buffer.from(text)});
  }
  return entries;
}
const mainPrefix='oboro-'+pkg.version;
const coreEntries=await directory('dist',mainPrefix+'/dist');
for(const name of docs)coreEntries.push({name:mainPrefix+'/'+name,data:await readFile(path.join(root,name))});
coreEntries.push(...await packagedReadmes(mainPrefix,'core-package-readme.en.md','core-package-readme.md'));
const info=(await readFile(path.join(root,'info.md'),'utf8')).replace(/\[([^\]]+)\]\((src\/[^)]+)\)/g,'$1 (`$2` в исходном проекте)');
coreEntries.push({name:mainPrefix+'/info.md',data:Buffer.from(info)});
const probePrefix='oboro-probe-'+probe.version;
const probeEntries=[...await directory('dist-probe',probePrefix+'/dist-probe'),...await directory('fixtures/i02',probePrefix+'/fixtures/i02'),...await directory('fixtures/i22',probePrefix+'/fixtures/i22')];
probeEntries.push(...await packagedReadmes(probePrefix,'probe-package-readme.en.md','probe-package-readme.md'));
await mkdir(output,{recursive:true});
const packages=[];
for(const [name,entries]of [[mainPrefix+'.zip',coreEntries],[probePrefix+'.zip',probeEntries]]){
  const bytes=createStoredZip(entries);await writeFile(path.join(output,name),bytes);
  packages.push({file:name,bytes:bytes.length,sha256:digest(bytes),entries:entries.map(entry=>({path:entry.name,bytes:entry.data.length,sha256:digest(entry.data)})).sort((a,b)=>a.path.localeCompare(b.path))});
}
// This records an evidence-backed checklist; it never authorizes injection.
// The installed extension independently validates raw I02 evidence and APIs.
const browserAccepted=matrix.status==='PASS_WITH_NATIVE_EVIDENCE'&&matrix.channels.length===2&&matrix.channels.every(channel=>/^\d+\.\d+\.\d+\.\d+$/.test(channel.exactBuild??'')&&channel.evidenceSource==='installed-chrome'&&channel.checks.length===matrix.requiredCases.length&&channel.checks.every(check=>(check.status==='PASS'||check.status==='UNSUPPORTED_CONFIRMED')&&check.evidence?.length));
const status={version:pkg.version,status:browserAccepted?'PACKAGE_READY_BROWSER_MATRIX_RECORDED':'PACKAGE_READY_BROWSER_ACCEPTANCE_INCOMPLETE',browserAcceptanceConfirmed:browserAccepted,
  signed:false,published:false,remoteExecutableCode:false,cookiesPermission:false,debuggerPermission:false,packages};
await writeFile(path.join(output,'release-manifest.json'),JSON.stringify(status,null,2)+'\n');
await writeFile(path.join(output,'SHA256SUMS.txt'),packages.map(item=>item.sha256+'  '+item.file).join('\n')+'\n');
console.log(JSON.stringify({status:status.status,version:pkg.version,packages:packages.map(({file,bytes,sha256})=>({file,bytes,sha256}))},null,2));
