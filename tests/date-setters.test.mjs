import test from "node:test";
import assert from "node:assert/strict";
import {runtimePage} from "./helpers/runtime-page.mjs";
import {nativeDateResults,dateSnapshotCode} from "./helpers/date-oracle.mjs";
const json=(run,expression)=>JSON.parse(run("JSON.stringify("+expression+")"));
const methods={
  setDate:[[1],[0],[32],[-10],[1.9],["15"]],
  setFullYear:[[2025],[99],[2024,1,30],[-1,0,1]],
  setHours:[[0],[24],[-25],[2,30],[2,30,70,1001]],
  setMilliseconds:[[0],[1001],[-1],[12.9]],
  setMinutes:[[0],[90],[-1],[30,70,-1]],
  setMonth:[[1],[12],[-1],[1,29],[1,31]],
  setSeconds:[[0],[61],[-1],[30,1500]],
  setYear:[[24],[99],[100],[2024],[-1]]
};
const setterCode=item=>`(()=>{const d=new Date(${item.start===null?"NaN":item.start});const returned=d.${item.method}(...${JSON.stringify(item.args)});return {returned:Number.isFinite(returned)?returned:null,...(${dateSnapshotCode("d")})}})()`;

test("I17: каждый локальный setter совпадает с native Date в шести целевых зонах",()=>{
  const starts=["2024-01-31T11:34:56.789Z","2024-07-15T12:34:56.789Z","2024-10-27T01:30:00.123Z"].map(Date.parse);
  const cases=starts.flatMap(start=>Object.entries(methods).flatMap(([method,variants])=>variants.map(args=>({kind:"setter",start,method,args}))));
  for(const zone of ["UTC","Europe/Berlin","America/New_York","Asia/Kathmandu","Australia/Lord_Howe","Pacific/Apia"]){
    const expected=nativeDateResults(zone,cases),{run}=runtimePage({timeZone:zone});
    for(let index=0;index<cases.length;index++)assert.deepEqual(json(run,setterCode(cases[index])),expected[index],zone+" "+JSON.stringify(cases[index]));
  }
});
test("I17: setDate/setMonth переходят через DST и нормализуют конец месяца",()=>{
  const {run}=runtimePage();
  assert.equal(run("const d=new Date(2024,2,30,12);const before=d.getTime();globalThis.daysReturn=d.setDate(d.getDate()+1);d.getTime()-before"),23*3600000);
  assert.equal(run("daysReturn"),Date.parse("2024-03-31T10:00Z"));
  assert.equal(run("const d=new Date(2024,9,26,12);const before=d.getTime();d.setDate(d.getDate()+1);d.getTime()-before"),25*3600000);
  assert.equal(run("const d=new Date(2024,0,31,12);d.setMonth(1);d.toISOString()"),"2024-03-02T11:00:00.000Z");
  assert.equal(run("const d=new Date(2023,0,31,12);d.setMonth(1);d.toISOString()"),"2023-03-03T11:00:00.000Z");
});
test("I17: setHours gap/overlap и no-op setter во втором повторённом часу",()=>{
  const {run}=runtimePage();
  assert.equal(run("const d=new Date(2024,2,31);d.setHours(2,30);d.toISOString()"),"2024-03-31T01:30:00.000Z");
  assert.equal(run("const d=new Date(2024,9,27);d.setHours(2,30);d.toISOString()"),"2024-10-27T00:30:00.000Z");
  for(const method of ["setDate","setMonth","setFullYear","setHours","setMinutes","setSeconds","setMilliseconds"]){
    const getter={setDate:"getDate",setMonth:"getMonth",setFullYear:"getFullYear",setHours:"getHours",setMinutes:"getMinutes",setSeconds:"getSeconds",setMilliseconds:"getMilliseconds"}[method];
    assert.equal(run(`const d=new Date('2024-10-27T01:30:00.123Z');d.${method}(d.${getter}());d.toISOString()`),"2024-10-27T00:30:00.123Z",method);
  }
});
test("I17: invalid Date восстанавливается только setFullYear/setYear с локальной базой 00:00",()=>{
  for(const zone of ["Europe/Berlin","America/New_York","Asia/Kathmandu"]){
    const {run}=runtimePage({timeZone:zone});
    const cases=[{kind:"setter",start:null,method:"setFullYear",args:[2024]},{kind:"setter",start:null,method:"setFullYear",args:[99,1,28]},{kind:"setter",start:null,method:"setYear",args:[24]}];
    const expected=nativeDateResults(zone,cases);
    for(let index=0;index<cases.length;index++)assert.deepEqual(json(run,setterCode(cases[index])),expected[index],zone+" "+cases[index].method);
    for(const method of ["setDate","setHours","setMilliseconds","setMinutes","setMonth","setSeconds"])assert.equal(run(`const d=new Date(NaN);const returned=d.${method}(1);Number.isNaN(returned)&&Number.isNaN(d.getTime())`),true,method);
  }
});
test("I17: missing отличается от undefined; все числа преобразуются даже для invalid Date",()=>{
  const {run}=runtimePage();
  assert.equal(run("const d=new Date(2024,0,1,12,34);d.setHours(13);d.getMinutes()"),34);
  assert.equal(run("const d=new Date(2024,0,1);Number.isNaN(d.setHours(13,undefined))&&Number.isNaN(d.getTime())"),true);
  assert.equal(run("const d=new Date(2024,0,1);Number.isNaN(d.setDate())"),true);
  assert.equal(run("globalThis.order=[];const d=new Date(NaN);const a=(n)=>({valueOf(){order.push(n);return 1}});d.setHours(a('h'),a('m'),a('s'),a('ms'));order.join(',')"),"h,m,s,ms");
  assert.throws(()=>run("new Date(NaN).setHours(1,{valueOf(){throw new Error('coercion')}})"),/coercion/);
  assert.equal(run("const d=new Date(2024,0,1);d.setMonth(1,1,{valueOf(){throw new Error('extra')}});d.getMonth()"),1);
});
test("I17: setter читает старый timestamp; coercion может менять receiver без потери семантики",()=>{
  const {run}=runtimePage();
  assert.equal(run("const d=new Date(2024,0,15,12,34,56,789);d.setHours({valueOf(){d.setTime(0);return 13}});d.toISOString()"),"2024-01-15T12:34:56.789Z");
  for(const method of ["setDate","setHours","setMilliseconds","setMinutes","setMonth","setSeconds"]){
    assert.equal(run(`const d=new Date(NaN);const returned=d.${method}({valueOf(){d.setTime(123);return 1}});Number.isNaN(returned)&&d.getTime()===123`),true,method);
  }
  assert.equal(run("const d=new Date(2024,0,1);try{d.setHours({valueOf(){d.setTime(123);throw new Error('stop')}})}catch{}d.getTime()"),123);
});
test("I17: non-finite результаты пишут Invalid Date, Symbol/BigInt бросают без записи",()=>{
  const {run}=runtimePage();
  for(const method of Object.keys(methods)){
    for(const value of ["NaN","Infinity","-Infinity"])assert.equal(run(`const d=new Date(123);Number.isNaN(d.${method}(${value}))&&Number.isNaN(d.getTime())`),true,method+" "+value);
    for(const value of ["Symbol()","1n"]){
      assert.throws(()=>run(`globalThis.d=new Date(123);d.${method}(${value})`),undefined,method+" "+value);
      assert.equal(run("d.getTime()"),123);
    }
  }
});
test("I17: UTC-setters и setTime сохраняют нативные функции и поведение",()=>{
  const {run}=runtimePage();
  for(const method of ["setTime","setUTCDate","setUTCFullYear","setUTCHours","setUTCMilliseconds","setUTCMinutes","setUTCMonth","setUTCSeconds"]){
    assert.equal(run(`Date.prototype.${method}===original.${method}`),true,method);
    assert.equal(run(`const a=new Date('2024-10-27T01:30:00Z');const b=new Date(a);const first=a.${method}(24);const second=original.${method}.call(b,24);Object.is(first,second)&&Object.is(a.getTime(),b.getTime())`),true,method);
  }
});
test("I17: receiver, cross-realm, frozen Date, subclass и дескрипторы",()=>{
  const {run}=runtimePage({foreignDate:new Date("2024-01-15T12:00:00Z")});
  for(const method of Object.keys(methods)){
    assert.throws(()=>run(`Date.prototype.${method}.call({},1)`),undefined,method);
    assert.equal(run(`Object.getOwnPropertyDescriptor(Date.prototype,'${method}').enumerable`),false);
    assert.equal(run(`Date.prototype.${method}.length===original.${method}.length && Date.prototype.${method}.name===original.${method}.name`),true);
  }
  assert.equal(run("Date.prototype.setHours.call(foreignDate,14);foreignDate.toISOString()"),"2024-01-15T13:00:00.000Z");
  assert.equal(run("const d=Object.freeze(new Date(2024,0,1));d.setHours(12);d.getHours()"),12);
  assert.equal(run("class LocalDate extends Date{};const d=new LocalDate(2024,0,1);d.setMonth(1);d instanceof LocalDate && d.getMonth()===1"),true);
  assert.equal(run("globalThis.touched=0;try{Date.prototype.setHours.call({}, {valueOf(){touched++;return 1}})}catch{}touched"),0);
});
test("I17: TimeClip на границах и дата с историческим offset",()=>{
  for(const zone of ["UTC","Europe/Berlin","America/New_York"]){
    const cases=[-8640000000000000,8640000000000000,Date.parse("1900-01-01T00:00Z")].flatMap(start=>[
      {kind:"setter",start,method:"setHours",args:[0]},{kind:"setter",start,method:"setDate",args:[13]},
      {kind:"setter",start,method:"setMilliseconds",args:[1001]},{kind:"setter",start,method:"setMonth",args:[8]}]);
    const expected=nativeDateResults(zone,cases),{run}=runtimePage({timeZone:zone});
    for(let index=0;index<cases.length;index++)assert.deepEqual(json(run,setterCode(cases[index])),expected[index],zone+" "+JSON.stringify(cases[index]));
  }
});
test("I17: Date-модуль устанавливается атомарно; старое покрытие не выдаётся за новое",()=>{
  const {report}=runtimePage();
  for(const key of ["formatting","localRead","construction","parse","localSetters"])assert.equal(report.timeCoverage[key],true,key);
  assert.equal(report.timeCoverage.temporal,false);assert.equal(report.timeCoverage.complete,true);assert.equal(report.temporal,"absent");
  for(const extra of ["Object.defineProperty(Date.prototype,'setHours',{writable:false,configurable:false})","Object.defineProperty(Date,'parse',{writable:false,configurable:false})"]){
    const page=runtimePage({extra});
    assert.equal(page.report.time,"error");
    assert.equal(page.report.timeCoverage.construction,false);assert.equal(page.report.timeCoverage.localSetters,false);
    assert.equal(page.run("Date===NativeDate && Date.prototype.getHours===original.getHours"),true);
  }
});
