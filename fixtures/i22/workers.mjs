const snapshotSource=String.raw`
function snapshot(){
  const format=new Intl.DateTimeFormat().resolvedOptions();
  const date=new Date(1705320000123);
  return {kind:KIND,origin:self.origin,language:navigator.language,languages:[...navigator.languages],locale:format.locale,timeZone:format.timeZone,
    date:{timestamp:date.getTime(),iso:date.toISOString(),hours:date.getHours(),offset:date.getTimezoneOffset()},
    baseRuntimeInjected:Boolean(self[Symbol.for('regional-profile.runtime.v1')]),keyboardApi:typeof navigator.keyboard?.getLayoutMap==='function'};
}
`;
export function workerScript(kind){
  if(!['dedicated','shared','service'].includes(kind))throw Error('Unknown worker fixture');
  const prefix='const KIND='+JSON.stringify(kind)+';\n'+snapshotSource;
  if(kind==='dedicated')return prefix+"self.addEventListener('message',event=>{if(event.data?.type==='region-fixture-snapshot')self.postMessage(snapshot())});";
  if(kind==='shared')return prefix+"self.onconnect=event=>{const port=event.ports[0];port.onmessage=message=>{if(message.data?.type==='region-fixture-snapshot')port.postMessage(snapshot());if(message.data?.type==='region-fixture-close')self.close()};port.start()};";
  return prefix+"self.addEventListener('message',event=>{if(event.data?.type==='region-fixture-snapshot'&&event.ports[0])event.ports[0].postMessage(snapshot())});";
}
