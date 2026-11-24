export function auditCoreManifest(manifest){
  const expected=['storage','activeTab','userScripts','scripting','declarativeNetRequestWithHostAccess','webNavigation'];
  if(manifest.manifest_version!==3||JSON.stringify(manifest.permissions)!==JSON.stringify(expected))throw Error('Unexpected core permissions');
  for(const key of ['host_permissions','optional_permissions','content_scripts','externally_connectable','web_accessible_resources','declarative_net_request'])if(manifest[key]!==undefined)throw Error('Unexpected core manifest surface: '+key);
  if(JSON.stringify(manifest.optional_host_permissions)!==JSON.stringify(['http://*/*','https://*/*']))throw Error('Unexpected optional host permissions');
  const csp=manifest.content_security_policy?.extension_pages??'';
  if(csp!=="script-src 'self'; object-src 'self'")throw Error('Unexpected script CSP');
}
export function auditPackagedText(name,text){
  if(/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$|\.(?:log(?:\..*)?|har|pem|key|p12|pfx|heapsnapshot|cpuprofile)$/i.test(name))throw Error('Private diagnostic or credential file in '+name);
  if(name.endsWith('.html')&&/<script\b[^>]*src\s*=\s*["']\s*(?:https?:)?\/\//i.test(text))throw Error('Remote script in '+name);
  if(name.endsWith('.js')&&(/\bimport\s*\(\s*["']\s*(?:https?:)?\/\//i.test(text)||/\bimport\s+[^;]*\bfrom\s*["']https?:/i.test(text)||/\beval\s*\(|\bnew\s+Function\s*\(/.test(text)))throw Error('Remote or dynamically evaluated executable code in '+name);
}

export function shouldPackageFile(directory,name){
  const fixtures={
    'fixtures/i02':['server.mjs','first-read.js','client.js','styles.css','config.json'],
    'fixtures/i22':['client.js','workers.mjs']
  };
  return !Object.hasOwn(fixtures,directory)||fixtures[directory].includes(name);
}
