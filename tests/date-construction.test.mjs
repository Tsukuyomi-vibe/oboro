import test from "node:test";
import assert from "node:assert/strict";
import {runtimePage} from "./helpers/runtime-page.mjs";
import {nativeDateResults,dateSnapshotCode} from "./helpers/date-oracle.mjs";
const json=(run,expression)=>JSON.parse(run("JSON.stringify("+expression+")"));
const zones=["UTC","Europe/Berlin","America/New_York","Asia/Kathmandu","Australia/Lord_Howe","Pacific/Apia"];

test("I16: конструктор компонентов совпадает с независимым native Date в целевой зоне",()=>{
  const cases=[
    [2024,0,15,12,34,56,789],[2024,6,15,12,34,56,789],[2024,2,31,2,30],[2024,9,27,2,30],
    [2024,2,10,2,30],[2024,10,3,1,30],[2024,9,6,2,15],[2011,11,30,12],
    [0,0,1],[99,11,31,23,59],[100,0,1],[-1,0,1],[2024,-1,0,-25,90,-1,1500],
    [2024,1,30],[2023,1,29],[2024,0,0],[2024.9,1.9,2.9,-0.9,3.9,4.9,5.9],
    [2024,12],[2024,0,1,24],[2024,0,1,-48],[2024,0,1,0,0,0,-1]
  ].map(args=>({kind:"construct",args}));
  for(const zone of zones){
    const expected=nativeDateResults(zone,cases),{run}=runtimePage({timeZone:zone});
    for(let index=0;index<cases.length;index++)assert.deepEqual(json(run,dateSnapshotCode(`new Date(...${JSON.stringify(cases[index].args)})`)),expected[index],zone+" "+JSON.stringify(cases[index].args));
  }
});
test("I16: date-only=UTC, date-time=профиль, explicit offset сохраняется",()=>{
  const values=["2024","2024-02","2024-02-29","2024T12:00","2024-02T12:00",
    "2024-01-15T12:34","2024-07-15T12:34:56.789","2024-03-31T02:30","2024-10-27T02:30",
    "2024-03-10T02:30","2024-11-03T01:30","2011-12-30T12:00",
    "2024-01-01T00:00Z","2024-01-01T12:34:56.789+05:45","2024-01-01T12:00-03:30",
    "2024-01-01T12:00+0300","2024-01-01T24:00","2024-01-01T12:00:00.1","2024-01-01T12:00:00.123456789",
    "0000-01-01T00:00","0050-01-01","-000001-01-01T00:00Z","+010000-01-01T00:00Z"];
  for(const zone of zones){
    const expected=nativeDateResults(zone,values.map(value=>({kind:"parse",value}))),{run}=runtimePage({timeZone:zone});
    for(let index=0;index<values.length;index++){
      const value=JSON.stringify(values[index]);
      assert.equal(run(`Date.parse(${value})`),expected[index],zone+" "+values[index]);
      assert.equal(run(`new Date(${value}).getTime()`),expected[index],zone+" constructor "+values[index]);
    }
  }
});
test("I16: DST gap/overlap имеют фиксированные независимые эталоны",()=>{
  const {run}=runtimePage();
  assert.equal(run("new Date(2024,2,31,2,30).toISOString()"),"2024-03-31T01:30:00.000Z");
  assert.equal(run("new Date(2024,2,31,2,30).getHours()"),3);
  assert.equal(run("Date.parse('2024-10-27T02:30')"),Date.parse("2024-10-27T00:30Z"));
  assert.equal(run("new Date(2024,9,27,2,30).getTimezoneOffset()"),-120);
  assert.equal(run("Date.parse('2024-10-27T02:30+01:00')"),Date.parse("2024-10-27T01:30Z"));
});
test("I16: timestamp, Date copy и ToPrimitive не используют строковый local fallback",()=>{
  const {run}=runtimePage({foreignDate:new Date("2024-01-15T12:00:00Z")});
  assert.equal(run("new Date(1700000000123).getTime()"),1700000000123);
  assert.equal(run("new Date(null).getTime()"),0);assert.equal(run("new Date(true).getTime()"),1);
  assert.equal(run("new Date(-0.5).getTime()"),0);
  assert.equal(run("new Date(foreignDate).getTime()"),1705320000000);
  assert.equal(run("globalThis.copy=new Date(123); copy[Symbol.toPrimitive]=()=>{throw new Error('must not coerce Date')}; new Date(copy).getTime()"),123);
  assert.equal(run("globalThis.hints=[];new Date({[Symbol.toPrimitive](hint){hints.push(hint);return '2024-01-15T12:00'}}).toISOString()"),"2024-01-15T11:00:00.000Z");
  assert.deepEqual(json(run,"hints"),["default"]);
  assert.equal(run("Date.parse({[Symbol.toPrimitive](hint){hints.push(hint);return '2024-01-15T12:00'}})"),Date.parse("2024-01-15T11:00Z"));
  assert.deepEqual(json(run,"hints"),["default","string"]);
  assert.equal(run("new Date({valueOf(){return 42}}).getTime()"),42);
  assert.equal(run("Number.isNaN(new Date(undefined).getTime())"),true);
  for(const code of ["new Date(1n)","new Date(Symbol())","Date.parse(Symbol())","new Date({[Symbol.toPrimitive](){return {}}})","new Date({[Symbol.toPrimitive]:42})"])assert.throws(()=>run(code),undefined,code);
});
test("I16: native порядок coercion, пропуск/undefined и игнорирование лишних аргументов",()=>{
  const {run}=runtimePage();
  assert.equal(run("globalThis.order=[];const arg=(name,value)=>({valueOf(){order.push(name);return value}});new Date(arg('y',NaN),arg('m',0),arg('d',1));order.join(',')"),"y,m,d");
  assert.equal(run("Number.isNaN(new Date(2024,0,undefined).getTime())"),true);
  assert.equal(run("new Date(2024,0).getDate()"),1);
  assert.equal(run("new Date(99.9,0).getFullYear()"),1999);
  assert.equal(run("new Date(2024,0,1,0,0,0,0,{valueOf(){throw new Error('ignored')}}).getFullYear()"),2024);
  assert.equal(run("globalThis.steps=[];const target=new Proxy(function(){},{get(t,k,r){if(k==='prototype')steps.push('prototype');return Reflect.get(t,k,r)}});Reflect.construct(Date,[{valueOf(){steps.push('year');return 2024}},{valueOf(){steps.push('month');return 0}}],target);steps.join(',')"),"year,month,prototype");
  assert.throws(()=>run("new Date(NaN,{valueOf(){throw new Error('still converted')}})"),/still converted/);
});
test("I16: TimeClip после timezone conversion на обеих границах Date",()=>{
  for(const zone of ["UTC","Europe/Berlin","America/New_York","Asia/Kathmandu"]){
    const {run}=runtimePage({timeZone:zone});
    const cases=[[275760,8,13,1],[-271821,3,19,23],[275760,8,13,0],[-271821,3,20,0],[275760,8,14,0],[-271821,3,18,0]].map(args=>({kind:"construct",args}));
    const expected=nativeDateResults(zone,cases);
    for(let index=0;index<cases.length;index++)assert.deepEqual(json(run,dateSnapshotCode(`new Date(...${JSON.stringify(cases[index].args)})`)),expected[index],zone+" "+JSON.stringify(cases[index].args));
  }
  const {run}=runtimePage();
  assert.equal(run("Date.parse('+275760-09-13T01:00:00+01:00')"),8640000000000000);
  assert.equal(run("Date.parse('-271821-04-19T23:00:00-01:00')"),-8640000000000000);
  for(const value of ["+275760-09-13T00:00:00.001Z","-271821-04-19T23:59:59.999Z"])assert.equal(run(`Number.isNaN(Date.parse(${JSON.stringify(value)}))`),true);
});
test("I16: invalid ISO и неизвестные Chrome-строки отклоняются без native fallback",()=>{
  const {run}=runtimePage();
  for(const value of ["-000000-01-01","2024-00-01","2024-13-01","2024-01-00","2024-01-32","2024-01-01T25:00","2024-01-01T24:01","2024-01-01T24:00:00.0001","2024-01-01T12:60","2024-01-01T12:00:60","2024-01-01T00:00+24:00","2024-01-01T00:00+01:60","01/02/2024","January 2, 2024","2024-1-1","2024-01-01 12:00","2024-01-01t12:00z"," 2024-01-01 ","2024-01-01T00:00[Europe/Berlin]"]){
    assert.equal(run(`Number.isNaN(Date.parse(${JSON.stringify(value)}))`),true,value);
    assert.equal(run(`Number.isNaN(new Date(${JSON.stringify(value)}).getTime())`),true,value);
  }
  for(const code of ["new Date(2024,Infinity)","new Date(Infinity,0)","new Date(2024,0,NaN)","new Date(2024,0,1,0,0,0,Infinity)"])assert.equal(run(`Number.isNaN((${code}).getTime())`),true);
});
test("I16: Date.parse строк Date/UTC, descriptors, subclass и контрольный документ",()=>{
  for(const zone of ["UTC","Europe/Berlin","America/New_York"]){
    const {run}=runtimePage({timeZone:zone});
    for(const iso of ["2024-01-15T12:00:00Z","2024-07-15T12:00:00Z"]){
      run(`globalThis.d=new Date('${iso}')`);
      assert.equal(run("Date.parse(d.toString())===d.getTime()"),true);
      assert.equal(run("Date.parse(d.toUTCString())===d.getTime()"),true);
    }
    assert.equal(run("class Derived extends Date {}; const d=new Derived(2024,0,15,12);d instanceof Derived && d instanceof Date && d.constructor===Derived"),true);
    assert.equal(run("Date.parse.name==='parse' && Date.parse.length===1 && !Object.getOwnPropertyDescriptor(Date,'parse').enumerable"),true);
    assert.throws(()=>run("new Date.parse('2024-01-01')"));
  }
  const control=runtimePage({host:"control.test"});
  assert.equal(control.run("Date===NativeDate && Date.parse===nativeParse"),true);
  assert.equal(control.report,null);
});

test("I16: экстремальное взаимное переполнение следует native MakeDay, без собственной границы входов",()=>{
  const cases=[[1000000000,-11999976360,1],[1000000,-11976360,1],[1970,0,1000000000,-23999999976],
    [2024,0,1,0,0,0,-8640000000000000],[99,0,1,0,0,0,8630000000000000]].map(args=>({kind:"construct",args}));
  const expected=nativeDateResults("UTC",cases),{run}=runtimePage({timeZone:"UTC"});
  for(let index=0;index<cases.length;index++)assert.deepEqual(json(run,dateSnapshotCode(`new Date(...${JSON.stringify(cases[index].args)})`)),expected[index],JSON.stringify(cases[index].args));
});

test("I16/I17: первый скрипт стенда фиксирует конструктор, парсинг и setters выбранного документа",async()=>{
  const {readFile}=await import("node:fs/promises");
  const first=await readFile(new URL("../fixtures/i02/first-read.js",import.meta.url),"utf8");
  const selected=runtimePage();
  selected.run("window.top=window;document.currentScript={dataset:{requestId:'unit-date',runId:'unit-date'}}");
  selected.run(first);
  const operations=json(selected.run,"window.__REGION_I02_FIRST_READ__.dateOperations");
  const values=new Map(operations.map(item=>[item.name,item]));
  assert.equal(values.get("components-winter").timestamp,Date.parse("2024-01-15T11:00Z"));
  assert.equal(values.get("components-gap").timestamp,Date.parse("2024-03-31T01:30Z"));
  assert.equal(values.get("parse-date-only").timestamp,Date.parse("2024-01-15T00:00Z"));
  assert.equal(values.get("parse-local").timestamp,Date.parse("2024-01-15T11:00Z"));
  assert.equal(values.get("parse-explicit-UTC").timestamp,Date.parse("2024-01-15T12:00Z"));
  assert.equal(values.get("ambiguous-string-rejected").rejected,true);
  assert.equal(values.get("setDate").elapsedHours,23);
  assert.equal(selected.run("Object.isFrozen(window.__REGION_I02_FIRST_READ__.dateOperations)&&window.__REGION_I02_FIRST_READ__.dateOperations.every(Object.isFrozen)"),true);
  const control=runtimePage({host:"control.test"});
  control.run("window.top=window;document.currentScript={dataset:{requestId:'control-date',runId:'unit-date'}}");
  control.run(first);
  assert.equal(control.run("window.__REGION_I02_FIRST_READ__.regionalRuntime"),null);
  assert.equal(control.run("Date===NativeDate && Date.parse===nativeParse"),true);
});
