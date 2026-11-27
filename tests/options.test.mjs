import test from 'node:test';
import assert from 'node:assert/strict';
import {optionsPage,exampleProfile,testSitePolicy} from './helpers/options-page.mjs';
const page=async(t,options)=>{const current=optionsPage(options);t.after(current.close);await current.flush();return current};
const saves=current=>current.messages.filter(message=>message.operation==='save');

test('I20: новая установка без профиля и грантов; все поля доступны, пример только заполняет форму',async t=>{
  const current=await page(t);
  assert.equal(Object.hasOwn(current.snapshot(),'regionalProfile'),false);
  assert.equal(current.query('#profile-fields').disabled,false);
  assert.equal(current.query('#apply-profile').disabled,true);
  assert.equal(current.query('#master-enabled').checked,false);
  assert.equal(current.query('#profile-form [name="keyboardLayout"]').options.length,4);
  current.click('#profile-example');await current.flush();
  assert.equal(current.query('[name="latitude"]').value,'52.52');
  assert.equal(current.query('[name="languages"]').value,'de-DE, de, en-US');
  assert.equal(saves(current).length,0);assert.equal(current.calls.includes('permission.request'),false);
  assert.equal(current.query('#apply-profile').disabled,true);
  current.click('#save-profile');await current.flush();
  assert.equal(current.snapshot().regionalProfile.revision,1);
  assert.equal(current.snapshot().regionalProfile.keyboardLayout,'native');
  assert.equal(current.query('#apply-profile').disabled,false);
  assert.match(current.query('#profile-description').textContent,/версия: 1/);
});

test('I20: форма сохраняет все геополя, языки/форматы/зону и карту через версионируемый backend',async t=>{
  const current=await page(t,{profile:exampleProfile()});
  for(const [name,value] of Object.entries({name:'  Москва  ',latitude:'55,7558',longitude:'37.6173',accuracy:'0',altitude:'-5,25',altitudeAccuracy:'0',speed:'0',heading:'0',languages:'RU-ru, ru\n en-US',locale:'ru-ru',timeZone:'Europe/Moscow',keyboardLayout:'ru-jcuken'}))current.set(name,value);
  assert.equal(current.query('#apply-profile').disabled,true);
  current.click('#save-profile');await current.flush();
  const saved=current.snapshot().regionalProfile;
  assert.equal(saved.revision,2);assert.equal(saved.name,'Москва');
  assert.deepEqual(saved.geolocation,{latitude:55.7558,longitude:37.6173,accuracy:0,altitude:-5.25,altitudeAccuracy:0,speed:0,heading:0});
  assert.deepEqual(saved.languages,['ru-RU','ru','en-US']);assert.equal(saved.language,'ru-RU');
  assert.equal(saved.locale,'ru-RU');assert.equal(saved.timeZone,'Europe/Moscow');assert.equal(saved.keyboardLayout,'ru-jcuken');
  assert.equal(saves(current)[0].expectedRevision,1);
  assert.equal(current.calls.includes('permission.request'),false);
  current.set('altitude','');current.set('altitudeAccuracy','');current.set('speed','');current.set('heading','');
  current.click('#save-profile');await current.flush();
  const geo=current.snapshot().regionalProfile.geolocation;
  for(const field of ['altitude','altitudeAccuracy','speed','heading'])assert.equal(Object.hasOwn(geo,field),false);
});

test('I20: ошибки проверяются до передачи сообщения и отмечаются у соответствующего поля',async t=>{
  const current=await page(t,{profile:exampleProfile()});
  for(const [name,value] of [['name',''],['latitude','91'],['longitude','-181'],['accuracy','-1'],['altitude','Infinity'],['altitudeAccuracy','-1'],['speed','-1'],['heading','360'],['languages','en-US, EN-us'],['locale','xx-invalid'],['timeZone','+03:00']]){
    current.click('#reload-profile');await current.flush();current.set(name,value);current.submit('#profile-form');await current.flush();
    assert.equal(current.query(`[name="${name}"]`).getAttribute('aria-invalid'),'true',name);
    assert.notEqual(current.query(`#profile-error-${name}`).textContent,'',name);
    assert.equal(current.document.activeElement,current.query(`[name="${name}"]`));
  }
  assert.equal(saves(current).length,0);assert.equal(current.snapshot().regionalProfile.revision,1);
});

test('I20: внешний save не стирает черновик; повторное чтение принимает новую revision',async t=>{
  const current=await page(t,{profile:exampleProfile()});
  current.set('name','Мой черновик');
  await current.externalProfile({...exampleProfile(),name:'Из другого окна',revision:2});
  assert.equal(current.query('[name="name"]').value,'Мой черновик');
  assert.equal(current.query('#save-profile').disabled,true);assert.match(current.query('#profile-draft-state').textContent,/перечитать/);
  current.click('#reload-profile');await current.flush();
  assert.equal(current.query('[name="name"]').value,'Из другого окна');
  current.set('name','После перечитывания');current.click('#save-profile');await current.flush();
  assert.equal(current.snapshot().regionalProfile.revision,3);
  assert.equal(saves(current).at(-1).expectedRevision,2);
});

test('I20: ошибка записи сохраняет черновик и блокирует повтор до проверки сохранённого состояния',async t=>{
  const current=await page(t,{profile:exampleProfile()});
  current.set('name','Не потерять');current.faults.profileWrite=true;current.click('#save-profile');await current.flush();
  assert.equal(current.query('[name="name"]').value,'Не потерять');assert.equal(current.snapshot().regionalProfile.name,'Берлин');
  assert.equal(current.query('#save-profile').disabled,true);assert.equal(current.query('#apply-profile').disabled,true);
  assert.match(current.query('#profile-save-feedback').textContent,/запис|сохранить/);
  current.faults.profileWrite=false;current.click('#reload-profile');await current.flush();
  assert.equal(current.query('#save-profile').disabled,false);
});

test('I20: переключение режимов сохраняет оба списка и не вызывает permission request',async t=>{
  const policy=testSitePolicy();
  const current=await page(t,{profile:exampleProfile(),policy,origins:['https://example.com/*','https://extra.test/*']});
  assert.equal(current.query('#site-selection-mode').value,'selected_sites');
  current.changeMode('all_granted_sites');assert.equal(current.snapshot().sitePolicy.mode,'selected_sites');
  current.click('#save-site-mode');await current.flush();
  const all=current.snapshot().sitePolicy;
  assert.equal(all.mode,'all_granted_sites');assert.equal(all.policyRevision,2);
  assert.deepEqual(all.include,policy.include);assert.deepEqual(all.exclude,policy.exclude);
  assert.match(current.query('#granted-sites').textContent,/extra\.test/);
  current.changeMode('selected_sites');current.click('#save-site-mode');await current.flush();
  assert.equal(current.snapshot().sitePolicy.mode,'selected_sites');assert.equal(current.snapshot().sitePolicy.policyRevision,3);
  assert.deepEqual(current.snapshot().sitePolicy.exclude,policy.exclude);
  assert.equal(current.calls.includes('permission.request'),false);
});

test('I20: selected_sites с пустым списком не выбирает даже уже разрешённый сайт',async t=>{
  const current=await page(t,{profile:exampleProfile(),origins:['https://example.com/*']});
  assert.match(current.query('#site-list').textContent,/Ни один сайт не выбран/);
  current.click('#apply-profile');await current.flush();
  assert.equal(current.snapshot().activationState.status,'OUT_OF_SCOPE');
  assert.equal(current.installed().main.length,0);assert.equal(current.installed().rules.length,0);
});

test('I20: site-form сохраняет выбранный сайт при отказе, исключение не запрашивает доступ',async t=>{
  const current=await page(t,{profile:exampleProfile()});current.faults.denyPermission=true;
  current.query('#site-form [name="host"]').value='example.com';current.submit('#site-form');await current.flush();
  assert.equal(current.snapshot().sitePolicy.include.length,1);assert.match(current.query('#site-feedback').textContent,/доступ не выдан/);
  assert.equal(current.calls.filter(value=>value==='permission.request').length,1);
  current.query('#site-form [name="kind"]').value='exclude';current.submit('#site-form');await current.flush();
  assert.equal(current.snapshot().sitePolicy.exclude.length,1);
  assert.equal(current.calls.filter(value=>value==='permission.request').length,1);
});

test('I20: UI не обходит M0 даже с валидным профилем и доступом',async t=>{
  const current=await page(t,{profile:exampleProfile(),policy:testSitePolicy(),origins:['https://example.com/*']});
  current.click('#apply-profile');await current.flush();
  assert.equal(current.snapshot().activationState.status,'LIMITED');
  assert.match(current.query('#activation-details').textContent,/отчёт проверки совместимости/);
  assert.equal(current.installed().main.length,0);
});

test('I20: полный UI-путь save → apply → READY → OFF/reload, с явными synthetic M0 и frame ACK',async t=>{
  const current=await page(t,{policy:testSitePolicy(),origins:['https://example.com/*'],proof:true});
  current.click('#profile-example');current.set('keyboardLayout','de-qwertz');current.click('#save-profile');await current.flush();
  current.click('#apply-profile');await current.flush();
  assert.equal(current.snapshot().activationState.status,'READY');
  assert.equal(current.installed().main.length,1);assert.equal(current.installed().rules.length,1);
  assert.match(current.query('#active-profile').textContent,/Активная конфигурация.*Берлин.*1/);
  current.set('name','Изменённый профиль');
  assert.equal(current.query('#apply-profile').disabled,true);assert.equal(current.query('#master-enabled').disabled,false);
  current.query('#master-enabled').checked=false;current.query('#master-enabled').dispatchEvent(new current.window.Event('change'));await current.flush();
  assert.equal(current.installed().main.length,0);assert.equal(current.installed().rules.length,0);
  assert.equal(current.snapshot().activationState.status,'NEEDS_RELOAD');
  current.click('#reload-tabs button');await current.flush();
  assert.equal(current.snapshot().activationState.status,'OFF');
  assert.equal(current.query('[name="name"]').value,'Изменённый профиль');
});

test('I20: конфликт revision до получения storage event оставляет правки и требует перечитывания',async t=>{
  const current=await page(t,{profile:exampleProfile()});
  current.set('name','Мои правки');
  current.externalProfileWithoutEvent({...exampleProfile(),name:'Параллельная запись',revision:2});
  current.click('#save-profile');await current.flush();
  assert.equal(current.query('[name="name"]').value,'Мои правки');
  assert.equal(current.snapshot().regionalProfile.name,'Параллельная запись');
  assert.equal(current.query('#save-profile').disabled,true);
  assert.match(current.query('#profile-save-feedback').textContent,/изменился/);
});

test('I20: сохранение активного профиля снимает старые регистрации и показывает необходимость reload',async t=>{
  const current=await page(t,{profile:exampleProfile(),policy:testSitePolicy(),origins:['https://example.com/*'],proof:true});
  current.click('#apply-profile');await current.flush();assert.equal(current.snapshot().activationState.status,'READY');
  current.set('timeZone','America/New_York');current.click('#save-profile');await current.flush();
  assert.equal(current.snapshot().regionalProfile.revision,2);
  assert.equal(current.snapshot().activationState.status,'NEEDS_RELOAD');
  assert.equal(current.installed().main.length,0);assert.equal(current.installed().rules.length,0);
  assert.match(current.query('#active-profile').textContent,/версия 2.*Старые документы требуют перезагрузки/);
  current.click('#apply-profile');await current.flush();
  assert.equal(current.snapshot().activationState.status,'READY');
  assert.equal(current.snapshot().activationState.committed.profileRevision,2);
});

test('I20: all_granted_sites не требует доступ к неактивным правилам сохранённого include',async t=>{
  const policy={...testSitePolicy('all_granted_sites'),include:[{host:'not-granted.test',schemes:['https'],includeSubdomains:false}]};
  const current=await page(t,{profile:exampleProfile(),policy,origins:['https://example.com/*'],proof:true});
  current.click('#apply-profile');await current.flush();
  assert.equal(current.snapshot().activationState.status,'READY');
  assert.deepEqual(current.snapshot().sitePolicy.include,policy.include);
  assert.equal(current.calls.includes('permission.request'),false);
});

test('I20: storage event во время save не теряется, форма перечитывает более новую версию',async t=>{
  const current=await page(t,{profile:exampleProfile()});
  current.set('name','Моя запись');
  current.faults.concurrentProfile={...exampleProfile(),name:'Более новая запись',revision:3};
  current.click('#save-profile');await current.flush();
  assert.equal(current.snapshot().regionalProfile.name,'Более новая запись');
  assert.equal(current.query('[name="name"]').value,'Более новая запись');
  assert.match(current.query('#profile-draft-state').textContent,/версия: 3/);
  current.set('name','Следующая запись');current.click('#save-profile');await current.flush();
  assert.equal(current.snapshot().regionalProfile.revision,4);
});
