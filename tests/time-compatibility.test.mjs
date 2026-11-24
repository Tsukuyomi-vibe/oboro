import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runtimePage} from "./helpers/runtime-page.mjs";
import {temporalPage} from "./helpers/temporal-page.mjs";
import {cloneIntoContext,withNativeClone} from "./helpers/realm-clone.mjs";
const json=(run,expression)=>JSON.parse(run("JSON.stringify("+expression+")"));

test("I18: нативный structured serializer клонирует Date в выбранный realm без сдвига instant",()=>{
  const page=runtimePage({setupContext:withNativeClone});
  assert.equal(page.report.time,"installed");
  assert.equal(page.report.timeCompatibility.structuredClone,"passed");
  assert.equal(page.report.timeCompatibility.status,"passed");
  const date=page.run("new Date(2024,0,15,12,34,56,789)");
  const native=structuredClone(date);
  assert.equal(native.getTime(),Date.parse("2024-01-15T11:34:56.789Z"));
  const returned=cloneIntoContext(page.context,{date:native,invalid:new Date(NaN)});
  page.context.received=returned;
  assert.equal(page.run("Object.getPrototypeOf(received.date)===Date.prototype && received.date instanceof Date"),true);
  assert.equal(page.run("received.date.toISOString()"),"2024-01-15T11:34:56.789Z");
  assert.equal(page.run("received.date.getHours()"),12);
  assert.equal(page.run("Number.isNaN(received.invalid.getTime())"),true);
});
test("I18: граф с Date, Map, alias и циклом сохраняет данные и выбранный Date prototype",()=>{
  const {context,run}=runtimePage({setupContext:withNativeClone});
  const date=new Date("2024-07-15T12:00:00Z");
  const graph={date,alias:date,invalid:new Date(NaN),map:new Map([[date,{date}]])};graph.self=graph;
  context.received=cloneIntoContext(context,graph);
  assert.equal(run("received.self===received && received.date===received.alias && received.map.get(received.date).date===received.date"),true);
  assert.equal(run("received.date.getHours()"),14);
  assert.equal(run("received.date.toISOString()"),"2024-07-15T12:00:00.000Z");
  assert.equal(run("Object.getPrototypeOf(received.date)===Date.prototype"),true);
});
test("I18: subclass сохраняет поведение Date/JSON, clone намеренно возвращает базовый Date",()=>{
  const page=runtimePage({setupContext:withNativeClone});
  page.run("globalThis.Meeting=class Meeting extends Date{constructor(...args){super(...args);this.label='local'}localHour(){return this.getHours()}};globalThis.meeting=new Meeting(2024,0,15,12)");
  assert.equal(page.run("meeting instanceof Meeting && meeting instanceof Date && meeting.constructor===Meeting"),true);
  assert.equal(page.run("meeting.localHour()"),12);
  assert.equal(page.run("JSON.stringify(meeting)"),'"2024-01-15T11:00:00.000Z"');
  page.context.cloned=cloneIntoContext(page.context,page.run("meeting"));
  assert.equal(page.run("cloned instanceof Date && !(cloned instanceof Meeting) && cloned.constructor===Date"),true);
  assert.equal(page.run("'label' in cloned || 'localHour' in cloned"),false);
  assert.equal(page.run("cloned.getHours()"),12);
  assert.equal(page.run("Object.prototype.toString.call(cloned)"),"[object Date]");
});
test("I18: JSON/reviver, Invalid Date, extended years и пользовательский toJSON сохраняются",()=>{
  const {run}=runtimePage();
  for(const iso of ["2024-07-15T12:34:56.789Z","0000-01-01T00:00:00.000Z","-000001-01-01T00:00:00.000Z","+275760-09-13T00:00:00.000Z"]){
    assert.equal(run(`JSON.parse(JSON.stringify(new Date('${iso}')))`),iso);
    assert.equal(run(`const text=JSON.stringify({date:new Date('${iso}')});JSON.parse(text,(key,value)=>key==='date'?new Date(value):value).date.toISOString()`),iso);
  }
  assert.equal(run("JSON.stringify({invalid:new Date(NaN)})"),'{"invalid":null}');
  assert.equal(run("class Custom extends Date{toJSON(){return {custom:true}}};JSON.stringify(new Custom(0))"),'{"custom":true}');
  assert.equal(run("const d=new Date(0);+d===0 && String(d)===d.toString()"),true);
});
test("I18: доступные selected realm обмениваются Date с сохранением internal value и receivers",()=>{
  const left=runtimePage(),right=runtimePage();
  left.run("globalThis.localDate=new Date(2024,0,15,12)");
  right.context.fromLeft=left.run("localDate");
  assert.equal(right.run("fromLeft instanceof Date"),false);
  assert.equal(right.run("Date.prototype.getHours.call(fromLeft)"),12);
  assert.equal(right.run("new Date(fromLeft).getTime()===fromLeft.getTime()"),true);
  right.run("Date.prototype.setHours.call(fromLeft,15)");
  assert.equal(left.run("localDate.getHours()"),15);
  right.context.packet=cloneIntoContext(right.context,left.run("localDate"));
  assert.equal(right.run("packet instanceof Date && packet.getHours()===15"),true);
  assert.equal(right.run("packet.getTime()===fromLeft.getTime()"),true);
});
test("I18: контрольный realm остаётся нативным; доступ по чужому prototype следует realm метода",()=>{
  const selected=runtimePage(),control=runtimePage({host:"control.test"});
  const epoch=Date.parse("2024-01-15T12:00:00Z");
  control.run(`globalThis.nativeDate=new Date(${epoch})`);
  selected.context.controlDate=control.run("nativeDate");
  selected.context.controlGetHours=control.run("original.getHours");
  selected.run(`globalThis.selectedDate=new Date(${epoch})`);
  assert.equal(selected.run("controlDate.getHours()"),control.run("nativeDate.getHours()"));
  assert.equal(selected.run("Date.prototype.getHours.call(controlDate)"),13);
  assert.equal(selected.run("controlGetHours.call(selectedDate)"),control.run("nativeDate.getHours()"));
  control.context.packet=cloneIntoContext(control.context,selected.run("selectedDate"));
  assert.equal(control.run("packet.getTime()===nativeDate.getTime() && packet.getHours()===nativeDate.getHours()"),true);
  assert.equal(control.run("Date===NativeDate && Date.parse===nativeParse"),true);
  assert.equal(control.report,null);
});
test("I18: Date constructor/proxy не становится cloneable; нативные ошибки не обходятся",()=>{
  const page=runtimePage({setupContext:withNativeClone});
  for(const value of [page.run("Date"),page.run("Date.prototype.getHours"),page.run("new Proxy(new Date(0),{})")]){
    assert.throws(()=>cloneIntoContext(page.context,value),error=>error.name==="DataCloneError");
  }
});
test("I18: runtime guard выявляет неправильный clone realm и откатывает timezone",()=>{
  const page=runtimePage({globals:{structuredClone}});
  // Host structuredClone returns a host-realm Date, not a receiving VM Date.
  assert.equal(page.report.time,"error");assert.equal(page.report.timeCompatibility.status,"failed");
  assert.equal(page.report.timeCompatibility.structuredClone,"failed");
  assert.equal(page.report.timeCoverage.complete,false);
  assert.equal(page.run("Date===NativeDate && Date.parse===nativeParse"),true);
  assert.ok(page.report.timeCompatibility.failures.some(failure=>failure.includes("realm")));
});
test("I18: runtime guard действительно сверяет Temporal default с Date/Intl и откатывает сбой",()=>{
  const page=temporalPage({extra:"Temporal.Now.zonedDateTimeISO=()=>originalNow.zonedDateTimeISO('UTC')"});
  assert.equal(page.report.time,"error");assert.equal(page.report.timeCompatibility.status,"failed");
  assert.equal(page.report.temporal,"error");assert.equal(page.report.timeCoverage.complete,false);
  assert.equal(page.run("Date===NativeDate && Date.parse===nativeParse"),true);
  assert.ok(page.report.timeCompatibility.failures.some(failure=>failure.includes("Temporal")));
});
test("I18: optional clone absence отмечено явно, успешные Date/Intl получают complete",()=>{
  const {report,run}=runtimePage();
  assert.equal(report.timeCompatibility.status,"passed");
  assert.equal(report.timeCompatibility.structuredClone,"absent");
  assert.equal(report.timeCoverage.complete,true);
  assert.ok(report.timeCompatibility.checks.includes("date.absolute"));
  assert.ok(report.timeCompatibility.checks.includes("date.serialization"));
  assert.equal(run("'structuredClone' in globalThis"),false);
});

test("I18: первый снимок стенда сохраняет Temporal, clone и проверку времени без BigInt в JSON",async()=>{
  const first=await readFile(new URL("../fixtures/i02/first-read.js",import.meta.url),"utf8");
  for(const page of [temporalPage({setupContext:withNativeClone}),runtimePage()]){
    page.run("window.top=window;document.currentScript={dataset:{requestId:'unit-compat',runId:'unit-compat'}}");
    page.run(first);
    const snapshot=json(page.run,"window.__REGION_I02_FIRST_READ__");
    assert.equal(snapshot.regionalRuntime.timeCompatibility.status,"passed");
    assert.equal(snapshot.regionalRuntime.timeCoverage.complete,true);
    assert.equal(snapshot.dateInterchange.json,'{"date":"2024-01-15T12:00:00.123Z","invalid":null}');
    if(snapshot.temporal.status==="available"){
      assert.equal(snapshot.temporal.timeZoneId,"Europe/Berlin");
      assert.equal(snapshot.temporal.zonedTimeZoneId,"Europe/Berlin");
      assert.equal(snapshot.temporal.explicitUTC,"UTC");
      assert.match(snapshot.temporal.epochNanoseconds,/^\d+$/);
      assert.equal(snapshot.dateInterchange.structuredClone.status,"available");
      assert.equal(snapshot.dateInterchange.structuredClone.receivingDatePrototype,true);
      assert.equal(snapshot.dateInterchange.structuredClone.subclassRemoved,true);
      assert.equal(snapshot.dateInterchange.structuredClone.invalidPreserved,true);
      assert.equal(snapshot.dateInterchange.structuredClone.localHours,13);
    }else{
      assert.equal(snapshot.temporal.status,"absent");
      assert.equal(snapshot.dateInterchange.structuredClone.status,"absent");
    }
    assert.equal(page.run("Object.isFrozen(__REGION_I02_FIRST_READ__.temporal) && Object.isFrozen(__REGION_I02_FIRST_READ__.dateInterchange.structuredClone) && Object.isFrozen(__REGION_I02_FIRST_READ__.regionalRuntime.timeCompatibility.checks)"),true);
    page.run("window[Symbol.for('regional-profile.runtime.v1')]().timeCoverage={complete:false}");
    assert.equal(page.run("__REGION_I02_FIRST_READ__.regionalRuntime.timeCoverage.complete"),true);
  }
});
