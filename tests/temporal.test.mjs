import test from "node:test";
import assert from "node:assert/strict";
import {runtimePage} from "./helpers/runtime-page.mjs";
import {temporalPage} from "./helpers/temporal-page.mjs";
const json=(run,expression)=>JSON.parse(run("JSON.stringify("+expression+")"));

test("I18: существующий Temporal.Now получает default timezone профиля, instant сохраняется",()=>{
  const {run,report}=temporalPage();
  assert.equal(report.temporal,"installed");assert.equal(report.time,"installed");
  assert.equal(report.timeCoverage.temporal,true);assert.equal(report.timeCoverage.complete,true);
  assert.equal(report.timeCompatibility.status,"passed");
  assert.equal(run("Temporal===originalTemporal && Temporal.Now.instant===originalNow.instant"),true);
  assert.equal(run("Temporal.Now.timeZoneId()"),"Europe/Berlin");
  assert.equal(run("Temporal.Now.zonedDateTimeISO().timeZoneId"),"Europe/Berlin");
  assert.equal(run("Temporal.Now.zonedDateTimeISO().epochNanoseconds===Temporal.Now.instant().epochNanoseconds"),true);
  assert.equal(run("Temporal.Now.instant().epochNanoseconds%1000000n!==0n"),true);
  assert.equal(run("Object.entries(originalTemporalConstructors).every(([name,ctor])=>Temporal[name]===ctor)"),true);
});
test("I18: все четыре ISO Now метода получают explicit default argument, а не системную зону",()=>{
  const {run}=temporalPage({clock:1704070800123,timeZone:"America/Los_Angeles"});
  run("nowCalls.length=0");
  assert.equal(run("Temporal.Now.plainDateTimeISO().toString()"),"2023-12-31T17:00:00.123800123");
  assert.equal(run("Temporal.Now.plainDateISO().toString()"),"2023-12-31");
  assert.equal(run("Temporal.Now.plainTimeISO().hour"),17);
  assert.equal(run("Temporal.Now.zonedDateTimeISO(undefined).timeZoneId"),"America/Los_Angeles");
  const calls=json(run,"nowCalls.filter(item=>item.name!=='timeZoneId').map(item=>({name:item.name,zone:item.args[0]}))");
  assert.equal(calls.length,4);assert.ok(calls.every(item=>item.zone==="America/Los_Angeles"));
});
test("I18: явные UTC, именованные и offset-зоны, ZonedDateTime argument сохраняются",()=>{
  const {run}=temporalPage();
  for(const zone of ["UTC","Asia/Tokyo","-03:30"]){
    assert.equal(run(`Temporal.Now.zonedDateTimeISO('${zone}').timeZoneId`),zone);
    assert.equal(run(`Temporal.Now.plainDateTimeISO('${zone}').equals(originalNow.plainDateTimeISO('${zone}'))`),true);
    assert.equal(run(`Temporal.Now.plainDateISO('${zone}').equals(originalNow.plainDateISO('${zone}'))`),true);
    assert.equal(run(`Temporal.Now.plainTimeISO('${zone}').equals(originalNow.plainTimeISO('${zone}'))`),true);
  }
  assert.equal(run("const zone=Temporal.ZonedDateTime.from('2024-01-01T00:00[Asia/Tokyo]');Temporal.Now.zonedDateTimeISO(zone).timeZoneId"),"Asia/Tokyo");
  for(const value of ["null","1","{}","Symbol()","'Not/AZone'"])assert.throws(()=>run(`Temporal.Now.plainDateTimeISO(${value})`),undefined,value);
});
test("I18: Native-like descriptors, borrowed calls и отсутствие искусственных методов",()=>{
  const {run}=temporalPage();
  for(const name of ["timeZoneId","zonedDateTimeISO","plainDateTimeISO","plainDateISO","plainTimeISO"]){
    assert.equal(run(`Temporal.Now.${name}.name===originalNow.${name}.name && Temporal.Now.${name}.length===originalNow.${name}.length`),true,name);
    assert.equal(run(`Object.getOwnPropertyDescriptor(Temporal.Now,'${name}').enumerable`),true);
    assert.equal(run(`Reflect.apply(Temporal.Now.${name},null,[]).toString()===Reflect.apply(Temporal.Now.${name},undefined,[]).toString()`),true);
    assert.throws(()=>run(`new Temporal.Now.${name}()`));
  }
  assert.equal(run("'plainDateTime' in Temporal.Now"),false);
  assert.equal(run("Temporal.Now.timeZoneId({toString(){throw new Error('ignored')}})"),"Europe/Berlin");
});
test("I18: известные optional legacy Now методы сохраняют calendar и подставляют второй аргумент",()=>{
  const {run,report}=temporalPage({extra:`
    globalThis.legacy=[];
    Temporal.Now.plainDateTime=function(calendar,timeZone){legacy.push({calendar,timeZone});return originalNow.plainDateTimeISO(timeZone).withCalendar(calendar)};
  `});
  assert.equal(report.time,"installed");
  assert.equal(run("Temporal.Now.plainDateTime('gregory').calendarId"),"gregory");
  assert.deepEqual(json(run,"legacy.at(-1)"),{calendar:"gregory",timeZone:"Europe/Berlin"});
  run("Temporal.Now.plainDateTime('iso8601','UTC')");
  assert.deepEqual(json(run,"legacy.at(-1)"),{calendar:"iso8601",timeZone:"UTC"});
});
test("I18: отсутствующий Temporal не создаётся и не блокирует поддержанный Date/Intl",()=>{
  const {run,report}=runtimePage();
  assert.equal(run("'Temporal' in globalThis"),false);
  assert.equal(report.temporal,"absent");assert.equal(report.timeCoverage.temporal,false);
  assert.equal(report.timeCoverage.complete,true);assert.equal(report.time,"installed");
});
test("I18: неизвестный/неизменяемый Temporal отключает timezone целиком и показывает ограничение",()=>{
  for(const extra of [
    "Object.freeze(Temporal.Now)",
    "delete Temporal.Now.plainDateISO",
    "Temporal.Now.timeZone=()=>({id:systemTimeZone})"
  ]){
    const {run,report}=temporalPage({extra});
    assert.equal(report.temporal,"unsupported");assert.equal(report.time,"partial");
    assert.equal(report.timeCoverage.complete,false);assert.equal(report.timeCoverage.formatting,false);
    assert.equal(run("Date===NativeDate && Date.parse===nativeParse"),true);
    assert.equal(run("new Intl.DateTimeFormat().resolvedOptions().timeZone===systemTimeZone"),true);
    assert.equal(run("Temporal.Now.timeZoneId===originalNow.timeZoneId"),true);
    assert.equal(report.timeCompatibility.status,"not_run");assert.ok(report.reasons.length);
  }
});
test("I18: сбой Date и self-check откатывает также Temporal/Intl; успешно готовое время не обещается",()=>{
  for(const extra of [
    "Object.defineProperty(Date.prototype,'setHours',{configurable:false,writable:false})",
    "globalThis.structuredClone=()=>({date:{getTime:()=>1},invalid:{}})"
  ]){
    const {run,report}=temporalPage({extra});
    assert.equal(report.time,"error");assert.equal(report.temporal,"error");assert.equal(report.timeCoverage.complete,false);
    assert.equal(run("Date===NativeDate && Date.parse===nativeParse"),true);
    assert.equal(run("Temporal.Now.timeZoneId===originalNow.timeZoneId && Temporal.Now.plainDateTimeISO===originalNow.plainDateTimeISO"),true);
    assert.equal(run("new Intl.DateTimeFormat().resolvedOptions().timeZone===systemTimeZone"),true);
    assert.equal(run("new Intl.NumberFormat().resolvedOptions().locale"),"de-DE");
  }
});
test("I18: контрольный документ и пропущенный document_start не меняют Temporal",()=>{
  for(const options of [{host:"control.test"},{extra:"document.readyState='complete'"}]){
    const page=temporalPage(options);
    assert.equal(page.run("Date===NativeDate && Temporal.Now.timeZoneId===originalNow.timeZoneId"),true);
    if(options.host)assert.equal(page.report,null);
    else assert.equal(page.report.needsReload,true);
  }
});
