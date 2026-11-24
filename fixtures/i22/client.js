(() => {
  const show=(id,value)=>{document.getElementById(id).textContent=JSON.stringify(value,null,2)};
  const runId=window.__REGION_I02_FIRST_READ__.runId;
  const events=[];const resources=[];const frames=[];
  const record=event=>{events.push({event:event.type,persisted:event.persisted??null});if(events.length>30)events.shift();show('lifecycle-events',events)};
  for(const type of ['pageshow','pagehide','popstate','hashchange'])window.addEventListener(type,record);
  record({type:'fixture-ready'});
  document.getElementById('spa-nav').addEventListener('click',()=>{
    history.pushState({fixture:true},'',location.pathname+location.search+'#spa-'+events.length);record({type:'history.pushState'});
  });
  document.getElementById('go-back').addEventListener('click',()=>history.back());
  function snapshot(target){
    try{const options=new target.Intl.DateTimeFormat().resolvedOptions();return {href:target.location.href,origin:target.origin,language:target.navigator.language,languages:[...target.navigator.languages],timeZone:options.timeZone,
      baseRuntimeInjected:Boolean(target[Symbol.for('regional-profile.runtime.v1')])};}
    catch(error){return {error:error.name,message:error.message}}
  }
  document.getElementById('run-contexts').addEventListener('click',async()=>{
    for(const frame of frames.splice(0))frame.remove();
    const result=[];const target=document.getElementById('context-fixtures');
    const empty=document.createElement('iframe');empty.title='Ранний about:blank';target.append(empty);frames.push(empty);
    result.push({kind:'early-about:blank',...snapshot(empty.contentWindow)});show('context-results',result);
    for(const kind of ['srcdoc','blob']){
      const frame=document.createElement('iframe');frame.title=kind;
      let url;
      const loaded=new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
      if(kind==='srcdoc')frame.srcdoc='<!doctype html><p>srcdoc: без базовой инъекции</p>';
      else{url=URL.createObjectURL(new Blob(['<!doctype html><p>blob: без базовой инъекции</p>'],{type:'text/html'}));frame.src=url;}
      target.append(frame);frames.push(frame);await loaded;
      result.push({kind,...snapshot(frame.contentWindow)});if(url)URL.revokeObjectURL(url);show('context-results',result);
    }
  });
  function message(endpoint,send){
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{endpoint.removeEventListener('message',done);reject(Error('Нет ответа worker за 5 секунд'))},5000);
      const done=event=>{clearTimeout(timeout);resolve(event.data)};
      endpoint.addEventListener('message',done,{once:true});endpoint.start?.();send();
    });
  }
  async function dedicated(){
    if(typeof Worker!=='function')return {kind:'dedicated',status:'API отсутствует'};
    const worker=new Worker('/i22/dedicated-worker.js?run='+encodeURIComponent(runId));resources.push({kind:'dedicated',worker});
    return message(worker,()=>worker.postMessage({type:'region-fixture-snapshot'}));
  }
  async function shared(){
    if(typeof SharedWorker!=='function')return {kind:'shared',status:'API отсутствует'};
    const worker=new SharedWorker('/i22/shared-worker.js?run='+encodeURIComponent(runId),'region-fixture-'+runId);resources.push({kind:'shared',worker});
    return message(worker.port,()=>worker.port.postMessage({type:'region-fixture-snapshot'}));
  }
  async function service(){
    if(!navigator.serviceWorker)return {kind:'service',status:'API отсутствует'};
    const registration=await navigator.serviceWorker.register('/i22/service-worker.js',{scope:'/i22/sw-scope/'});
    let worker=registration.active??registration.installing??registration.waiting;
    if(!worker)throw Error('Service Worker не создан');
    if(worker.state!=='activated')await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{worker.removeEventListener('statechange',changed);reject(Error('Service Worker не активирован'))},5000);
      const changed=()=>{if(worker.state==='activated'){clearTimeout(timer);worker.removeEventListener('statechange',changed);resolve()}else if(worker.state==='redundant'){clearTimeout(timer);worker.removeEventListener('statechange',changed);reject(Error('Service Worker стал redundant'))}};
      worker.addEventListener('statechange',changed);changed();
    });
    worker=registration.active??worker;
    const channel=new MessageChannel();
    try{return await message(channel.port1,()=>worker.postMessage({type:'region-fixture-snapshot'},[channel.port2]));}
    finally{channel.port1.close();channel.port2.close()}
  }
  document.getElementById('run-workers').addEventListener('click',async()=>{
    const button=document.getElementById('run-workers');button.disabled=true;
    try{const results=await Promise.allSettled([dedicated(),shared(),service()]);show('worker-results',results.map((result,index)=>result.status==='fulfilled'?result.value:{kind:['dedicated','shared','service'][index],error:String(result.reason)}));}
    finally{button.disabled=false}
  });
  document.getElementById('cleanup-workers').addEventListener('click',async()=>{
    for(const {kind,worker}of resources.splice(0))if(kind==='dedicated')worker.terminate();else{worker.port.postMessage({type:'region-fixture-close'});worker.port.close()}
    const expected=new URL('/i22/sw-scope/',location.href).href;
    const registration=await navigator.serviceWorker?.getRegistration(expected);
    if(registration?.scope===expected){
      const known=[registration.active,registration.waiting,registration.installing].filter(Boolean).every(worker=>new URL(worker.scriptURL).pathname==='/i22/service-worker.js');
      if(known)await registration.unregister();else{show('worker-results',{cleanup:'Другая регистрация не изменена'});return}
    }
    for(const frame of frames.splice(0))frame.remove();show('worker-results',{cleanup:'Тестовые workers и iframe закрыты'});
  });
})();
