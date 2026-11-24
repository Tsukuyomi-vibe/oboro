import test from "node:test";
import assert from "node:assert/strict";
import { geoPage } from "./helpers/geolocation-page.mjs";
const watch = "navigator.geolocation.watchPosition(p=>calls.push({ok:true,t:p.timestamp,lat:p.coords.latitude}),e=>calls.push({ok:false,code:e.code}))";
const get = (options = "{}") => `navigator.geolocation.getCurrentPosition(p=>calls.push({ok:true,t:p.timestamp,lat:p.coords.latitude}),e=>calls.push({ok:false,code:e.code}),${options})`;

test("I11: несколько подписчиков имеют разные ID, async callbacks, нет таймера фиктивного движения", async () => {
  const page = geoPage();
  const first = page.run(watch), second = page.run(watch);
  assert.ok(first > 0 && second > 0 && first !== second);
  assert.deepEqual(page.calls(), []);
  await page.flush();
  assert.deepEqual(page.calls().map(x=>x.lat), [52.52,52.52]);
  assert.equal(page.pending(), 0); assert.equal(page.listeners(), 2);
  await page.flush(60_000);
  assert.equal(page.calls().length, 2);
  page.run(`navigator.geolocation.clearWatch(${first}); navigator.geolocation.clearWatch(${second});`);
  assert.equal(page.listeners(), 0);
});
test("I11: clearWatch отменяет даже ещё не доставленные callbacks и ошибки", async () => {
  for (const permission of ["granted","denied"]) {
    const page = geoPage({permission});
    const id = page.run(watch);
    await page.microtasks();
    page.run(`navigator.geolocation.clearWatch(${id}); navigator.geolocation.clearWatch(${id}); navigator.geolocation.clearWatch(-1);`);
    await page.flush();
    assert.deepEqual(page.calls(), []); assert.equal(page.pending(), 0); assert.equal(page.listeners(), 0);
  }
});
test("I11: prompt-watch использует отменяемый native prompt, реальные координаты не читаются", async () => {
  const cancelled = geoPage({permission:"prompt",delay:500});
  const id = cancelled.run(watch);
  await cancelled.microtasks();
  assert.equal(cancelled.run("nativeWatches"), 1);
  cancelled.run(`navigator.geolocation.clearWatch(${id})`);
  await cancelled.flush(1000);
  assert.deepEqual(cancelled.calls(), []); assert.equal(cancelled.run("nativeClears"), 1); assert.equal(cancelled.run("realTouched"), 0);
  assert.equal(cancelled.pending(), 0);
  const granted = geoPage({permission:"prompt"});
  granted.run(watch); await granted.flush();
  assert.equal(granted.calls()[0].lat, 52.52);
  assert.equal(granted.run("realTouched"), 0); assert.equal(granted.run("nativeClears"), 1);
});
test("I11: maximumAge использует согласованный cache, high accuracy не подменяет accuracy", async () => {
  const page = geoPage();
  page.run(get()); await page.flush();
  const initial = page.calls()[0].t;
  await page.flush(500);
  page.run(get("{maximumAge:1000,timeout:0}")); await page.flush();
  assert.equal(page.calls()[1].t, initial);
  page.run(get("{maximumAge:1000,timeout:0,enableHighAccuracy:true}")); await page.flush();
  assert.equal(page.calls()[2].code, 3);
  page.run(get("{maximumAge:0,enableHighAccuracy:true}")); await page.flush();
  assert.equal(page.calls()[3].t, initial + 500); assert.equal(page.calls()[3].lat, 52.52);
});
test("I11: отзыв permission завершает watch один раз, после clear нет событий", async () => {
  const page = geoPage();
  page.run(watch); await page.flush();
  page.run("permission.state='denied'; permission.emit('change'); permission.emit('change');");
  assert.equal(page.calls().length, 1);
  await page.flush();
  assert.deepEqual(page.calls().at(-1), {ok:false,code:1});
  assert.equal(page.calls().length, 2); assert.equal(page.listeners(), 0); assert.equal(page.pending(), 0);
  page.run("permission.state='granted'; permission.emit('change');"); await page.flush();
  assert.equal(page.calls().length, 2);
});
test("I11: hidden документ ждёт видимости; timeout не включает время ожидания", async () => {
  const page = geoPage({hidden:true});
  page.run(get("{timeout:1}")); await page.flush(60_000);
  assert.deepEqual(page.calls(), []);
  page.run("document.visibilityState='visible'; document.emit('visibilitychange');");
  await page.flush();
  assert.equal(page.calls()[0].ok, true);
  const expired = geoPage();
  expired.run(get("{timeout:1}")); await expired.microtasks(); expired.advance(5); await expired.flush();
  assert.deepEqual(expired.calls(), [{ok:false,code:3}]);
});
test("I11: pagehide/dispose очищает подписки, задачи и native watch без настоящей позиции", async () => {
  for (const permission of ["granted","prompt"]) {
    const page = geoPage({permission,delay:100});
    page.run(watch); page.run(watch); await page.microtasks();
    page.run("emitWindow('pagehide')"); await page.flush(1000);
    assert.deepEqual(page.calls(), []); assert.equal(page.listeners(), 0); assert.equal(page.pending(), 0); assert.equal(page.run("realTouched"), 0);
    page.run("emitWindow('pageshow')"); page.run(get()); await page.microtasks(); await page.flush(100);
    assert.equal(page.calls()[0].ok, true);
  }
});
test("I11: clearWatch сохраняет проверки receiver/WebIDL; сотня подписок не оставляет ресурсов", async () => {
  const page = geoPage();
  for (const code of ["navigator.geolocation.clearWatch()", "navigator.geolocation.clearWatch(1n)", "Geolocation.prototype.clearWatch.call({},1)", "navigator.geolocation.watchPosition(null)", "navigator.geolocation.watchPosition(()=>{},null,{timeout:Symbol()})"]) assert.throws(()=>page.run(code));
  for (let i=0;i<100;i++) { const id=page.run(watch); page.run(`navigator.geolocation.clearWatch(${id})`); }
  await page.flush();
  assert.equal(page.pending(),0); assert.equal(page.listeners(),0); assert.deepEqual(page.calls(),[]);
});

test("I11: timeout/unavailable watch не становятся нативным успехом; подписку можно отменить",async()=>{
  const timeout=geoPage();
  timeout.run("globalThis.id=navigator.geolocation.watchPosition(p=>calls.push({ok:true}),e=>calls.push({ok:false,code:e.code}),{timeout:0})");
  await timeout.flush();
  assert.deepEqual(timeout.calls(),[{ok:false,code:3}]);
  assert.equal(timeout.listeners(),1);
  timeout.run("navigator.geolocation.clearWatch(id)");
  assert.equal(timeout.listeners(),0);assert.equal(timeout.pending(),0);
  const unavailable=geoPage({permission:"prompt",nativeMode:"unavailable"});
  unavailable.run("globalThis.id=navigator.geolocation.watchPosition(p=>calls.push({ok:true}),e=>calls.push({ok:false,code:e.code}))");
  await unavailable.flush();
  assert.deepEqual(unavailable.calls(),[{ok:false,code:2}]);
  assert.equal(unavailable.run("realTouched"),0);
  unavailable.run("navigator.geolocation.clearWatch(id)");assert.equal(unavailable.listeners(),0);
});

test("I11: callbacks не получают внутренний объект запроса через this",async()=>{
  const page=geoPage();
  page.run("navigator.geolocation.getCurrentPosition(function(position){'use strict';calls.push({undefinedThis:this===undefined,lat:position.coords.latitude})})");
  await page.flush();
  assert.deepEqual(page.calls(),[{undefinedThis:true,lat:52.52}]);
});
