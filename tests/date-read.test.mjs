import test from "node:test";
import assert from "node:assert/strict";
import { runtimePage } from "./helpers/runtime-page.mjs";
const fields="['getFullYear','getMonth','getDate','getDay','getHours','getMinutes','getSeconds','getMilliseconds','getTimezoneOffset'].map(key=>d[key]())";
const json=(run,expression)=>JSON.parse(run("JSON.stringify("+expression+")"));

test("I15: локальные getters согласованы зимой/летом с одним неизменённым instant",()=>{
  const {run,report}=runtimePage();
  assert.equal(report.time,"installed");assert.equal(report.locale,"installed");assert.equal(report.timeCoverage.localRead,true);assert.equal(report.timeCoverage.complete,true);
  for(const [iso,hour,offset] of [["2024-01-15T12:34:56.789Z",13,-60],["2024-07-15T12:34:56.789Z",14,-120]]){
    run(`globalThis.d=new Date('${iso}')`);
    assert.deepEqual(json(run,fields),[2024,iso.includes("-01-")?0:6,15,1,hour,34,56,789,offset]);
    assert.equal(run("d.getYear()"),124);
    assert.equal(run("d.getTime()"),Date.parse(iso));assert.equal(run("d.toISOString()"),iso);
  }
});
test("I15: Date строки содержат локальную дату/время и правильный знак GMT offset",()=>{
  for(const [zone,iso,date,time] of [
    ["Europe/Berlin","2024-01-15T12:00:00Z","Mon Jan 15 2024","13:00:00 GMT+0100"],
    ["Europe/Berlin","2024-07-15T12:00:00Z","Mon Jul 15 2024","14:00:00 GMT+0200"],
    ["America/New_York","2024-01-01T01:30:00Z","Sun Dec 31 2023","20:30:00 GMT-0500"],
    ["Asia/Kathmandu","2024-01-15T12:00:00Z","Mon Jan 15 2024","17:45:00 GMT+0545"]
  ]){
    const {run}=runtimePage({timeZone:zone});run(`globalThis.d=new Date('${iso}')`);
    assert.equal(run("d.toDateString()"),date);
    assert.ok(run("d.toTimeString()").startsWith(time+" ("));
    assert.equal(run("d.toString()"),date+" "+run("d.toTimeString()"));
    assert.equal(run("String(d)"),run("d.toString()"));
  }
});
test("I15: локальные чтения с обеих сторон DST gap и overlap",()=>{
  const {run}=runtimePage();
  for(const [iso,expected] of [
    ["2024-03-31T00:59:59Z",[1,59,-60]],
    ["2024-03-31T01:00:00Z",[3,0,-120]],
    ["2024-10-27T00:59:59Z",[2,59,-120]],
    ["2024-10-27T01:00:00Z",[2,0,-60]]
  ]){
    run(`globalThis.d=new Date('${iso}')`);
    assert.deepEqual(json(run,"[d.getHours(),d.getMinutes(),d.getTimezoneOffset()]"),expected);
    assert.equal(run("new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'numeric',hourCycle:'h23'}).format(d)"),String(expected[0]).padStart(2,"0")+":"+String(expected[1]).padStart(2,"0"));
  }
});
test("I15: Date.now/getTime/valueOf, UTC API и performance.now остаются нативными",()=>{
  const {run}=runtimePage();
  for(const expression of ["Date.now===nativeNow","Date.UTC===nativeUTC","Date.prototype.getTime===original.getTime","Date.prototype.valueOf===original.valueOf","Date.prototype.toISOString===original.toISOString","Date.prototype.toJSON===original.toJSON","Date.prototype.toUTCString===original.toUTCString","performance.now===originalPerformance"])assert.equal(run(expression),true,expression);
  run("globalThis.d=new Date('2024-07-15T12:34:56.789Z')");
  for(const key of ["getUTCFullYear","getUTCMonth","getUTCDate","getUTCDay","getUTCHours","getUTCMinutes","getUTCSeconds","getUTCMilliseconds"])assert.equal(run(`d.${key}() === original.${key}.call(d)`),true,key);
  assert.equal(run("+d"),1721046896789);assert.equal(run("JSON.stringify(d)"),'"2024-07-15T12:34:56.789Z"');
  assert.equal(run("d.toGMTString()"),"Mon, 15 Jul 2024 12:34:56 GMT");
});
test("I15: Invalid Date и проверки receiver не превращаются в произвольные значения",()=>{
  const {run}=runtimePage();
  for(const key of ["getFullYear","getYear","getMonth","getDate","getDay","getHours","getMinutes","getSeconds","getMilliseconds","getTimezoneOffset"]){
    assert.equal(run(`Number.isNaN(new Date(NaN).${key}())`),true);
    assert.throws(()=>run(`Date.prototype.${key}.call({})`));
  }
  for(const key of ["toString","toDateString","toTimeString"]){
    assert.equal(run(`new Date(NaN).${key}()`),"Invalid Date");
    assert.throws(()=>run(`Date.prototype.${key}.call({})`));
  }
  assert.throws(()=>run("new Date(NaN).toISOString()"));
});
test("I15: Date() без new использует профиль, игнорирует аргументы и не рекурсирует",()=>{
  const {run}=runtimePage({extra:"Date.now=()=>1705320000000; globalThis.nativeNow=Date.now;"});
  assert.ok(run("Date()").startsWith("Mon Jan 15 2024 13:00:00 GMT+0100"));
  assert.equal(run("Date.call(null,{toString(){throw new Error('must not coerce')}})"),run("Date()"));
  assert.equal(run("Date.now===nativeNow"),true);
  run("Date.now=()=>0");
  assert.ok(run("Date()").startsWith("Mon Jan 15 2024 13:00:00 GMT+0100"));
  assert.equal(run("Date.length"),7);assert.equal(run("Date.name"),"Date");
});
test("I15: cross-realm Date, subclass, descriptor flags и constructor identity",()=>{
  const {run}=runtimePage({foreignDate:new Date("2024-07-15T12:00:00Z")});
  assert.equal(run("Date.prototype.getHours.call(foreignDate)"),14);
  assert.equal(run("class Extended extends Date {}; globalThis.ext=new Extended(0); ext instanceof Extended && ext instanceof Date && ext.getTime()===0"),true);
  assert.equal(run("new Date(0).constructor===Date"),true);
  for(const key of ["getHours","getTimezoneOffset","toString"]){
    assert.equal(run(`Object.getOwnPropertyDescriptor(Date.prototype,'${key}').enumerable`),false);
    assert.equal(run(`Object.getOwnPropertyDescriptor(Date.prototype,'${key}').configurable`),true);
    assert.equal(run(`Date.prototype.${key}.length`),0);
  }
});
test("I15: годы 0/до н.э., исторические секунды offset и границы Date",()=>{
  const utc=runtimePage({timeZone:"UTC"});
  assert.equal(utc.run("new Date('0000-01-01T00:00:00Z').getFullYear()"),0);
  assert.ok(utc.run("new Date('-000001-01-01T00:00:00Z').toDateString()").endsWith("-0001"));
  for(const instant of [-8640000000000000,8640000000000000]){
    assert.equal(utc.run(`new Date(${instant}).getTime()`),instant);
    assert.ok(utc.run(`new Date(${instant}).toString()`).includes("GMT+0000"));
  }
  const paris=runtimePage({timeZone:"Europe/Paris"});
  assert.deepEqual(json(paris.run,"(()=>{const d=new Date('1900-01-01T00:00:00Z');return [d.getHours(),d.getMinutes(),d.getSeconds(),d.getTimezoneOffset()]})()"),[0,9,21,-9]);
});
test("I18: Date покрыт, отсутствие Temporal не добавляет API и не мешает готовности",()=>{
  const {run,report}=runtimePage();
  for(const key of ["construction","parse","localSetters"])assert.equal(report.timeCoverage[key],true,key);
  assert.equal(report.timeCoverage.temporal,false);assert.equal(report.timeCoverage.complete,true);
  assert.equal(report.temporal,"absent");assert.equal(report.timeCompatibility.status,"passed");
  assert.equal(run("new Date(2024,0,15,12).toISOString()"),"2024-01-15T11:00:00.000Z");
  assert.equal(run("Date.prototype.setHours===original.setHours"),false);
  assert.equal(run("typeof Temporal"),"undefined");
});
test("I12–I15: контрольный/исключённый документ остаётся нативным, поздняя установка пропускается",()=>{
  const control=runtimePage({host:"control.test"});
  assert.equal(control.report,null);
  assert.equal(control.run("Date===NativeDate && Intl.DateTimeFormat===NativeDateTimeFormat"),true);
  const late=runtimePage({extra:"document.readyState='complete'"});
  assert.equal(late.report.needsReload,true);assert.equal(late.run("Date===NativeDate && Intl.DateTimeFormat===NativeDateTimeFormat"),true);
});

test("I15: ошибка календаря/неизменяемого Date не объявляется успешной подменой",()=>{
  const invalid=runtimePage({timeZone:"Not/AZone"});
  assert.equal(invalid.report.time,"error");assert.equal(invalid.report.timeCoverage.localRead,false);
  assert.equal(invalid.run("Date===NativeDate"),true);
  const locked=runtimePage({extra:"Object.defineProperty(Date.prototype,'getHours',{writable:false,configurable:false})"});
  assert.equal(locked.report.time,"error");assert.equal(locked.report.timeCoverage.formatting,false);assert.equal(locked.report.timeCoverage.localRead,false);
  assert.equal(locked.run("Date===NativeDate && Date.prototype.getMonth===original.getMonth"),true);
});
