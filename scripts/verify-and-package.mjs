import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const npmCli=process.env.npm_execpath;
if(!npmCli||!npmCli.endsWith('npm-cli.js'))throw Error('Запустите через npm run package:core.');
await mkdir(path.join(root,'artifacts'),{recursive:true});
let output='';
const child=spawn(process.execPath,[npmCli,'run','check'],{cwd:root,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',chunk=>{output=(output+chunk.toString()).slice(-131072);process.stdout.write(chunk)});
child.stderr.on('data',chunk=>process.stderr.write(chunk));
const [code]=await once(child,'close');
if(code!==0)process.exitCode=code??1;
else {
  const counts={};
  for(const key of ['tests','pass','fail','cancelled','skipped']){
    const matches=[...output.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];
    if(!matches.length)throw Error('Нет итоговых счётчиков тестов: '+key);
    counts[key]=Number(matches.at(-1)[1]);
  }
  const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
  const summary={version:pkg.version,command:'npm run check',status:'PASS',typecheck:true,coreBuild:true,probeBuild:true,packageAudit:true,tests:counts,isNativeChromeAcceptance:false};
  // Whitelisted numbers/booleans only: never persist console output, paths,
  // raw browser observations or environment/account identifiers.
  await writeFile(path.join(root,'artifacts/verification-summary.json'),JSON.stringify(summary,null,2)+'\n');
  await import('./package-core.mjs');
}
