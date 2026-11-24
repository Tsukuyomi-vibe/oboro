import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const bundled=await build({entryPoints:['src/runtime/report.ts'],absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent'});
export const reportApi=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
// Synthetic Chrome ACKs still exercise the production authentication code.
export function fakePageReport(snapshot,overrides={},origin='https://example.com'){
  const status={implementation:7,activationId:snapshot.activationId,profileRevision:snapshot.profile.revision,policyRevision:snapshot.policy.policyRevision,
    readyState:'loading',languages:'installed',locale:'installed',time:'installed',temporal:'absent',keyboard:'native',keyboardLayout:'native',keyboardReason:null,
    timeCompatibility:{status:'passed',structuredClone:'absent',checks:['synthetic-unit-ack'],failures:[]},timeCoverage:{formatting:true,localRead:true,construction:true,parse:true,localSetters:true,temporal:false,complete:true},
    geolocation:'installed',needsReload:false,reasons:[],...overrides};
  const secret={activationId:status.activationId,signature:snapshot.signature};
  if(status.profileRevision!==snapshot.profile.revision||status.policyRevision!==snapshot.policy.policyRevision)secret.signature+=':synthetic-stale-revisions:'+status.profileRevision+':'+status.policyRevision;
  return JSON.parse(JSON.stringify(reportApi.createPageRuntimeReport(secret,status,origin)));
}
