import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const bundled = await build({entryPoints:[root+"src/runtime/calendar.ts"],bundle:true,write:false,format:"esm",logLevel:"silent"});
const api=await import("data:text/javascript;base64,"+Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const local=(year,month,day,hour=0,minute=0,second=0,millisecond=0)=>({year,month,day,hour,minute,second,millisecond});

test("I13: самопроверка движка и закреплённый источник правил timezone",()=>{
  api.verifyCalendarEngine();
  assert.equal(api.CALENDAR_COMPONENT.version,"0.5.1");
  assert.match(api.CALENDAR_COMPONENT.timeZoneRules,/Intl/);
});
test("I13: UTC, зимняя/летняя Europe/Berlin и отрицательный JS offset",()=>{
  for(const [iso,hour,offset] of [["2024-01-15T12:00:00.123Z",13,-60],["2024-07-15T12:00:00.123Z",14,-120]]){
    const instant=Date.parse(iso), engine=new api.CalendarEngine("Europe/Berlin"), fields=engine.instantToLocal(instant);
    assert.equal(fields.hour,hour);assert.equal(fields.timezoneOffset,offset);assert.equal(fields.millisecond,123);
    assert.equal(engine.localToInstant(fields),instant);assert.equal(Object.isFrozen(fields),true);
  }
  assert.equal(new api.CalendarEngine("UTC").instantToLocal(0).timezoneOffset,0);
  assert.equal(Object.is(new api.CalendarEngine("UTC").instantToLocal(0).timezoneOffset,-0),false);
});
test("I13: обе стороны DST и переход суток в разных полушариях",()=>{
  for(const [zone,iso,expected] of [
    ["Europe/Berlin","2024-03-31T00:59:59.999Z",[2024,3,31,1,59,59,999,-60]],
    ["Europe/Berlin","2024-03-31T01:00:00.000Z",[2024,3,31,3,0,0,0,-120]],
    ["Europe/Berlin","2024-10-27T00:59:59.999Z",[2024,10,27,2,59,59,999,-120]],
    ["Europe/Berlin","2024-10-27T01:00:00.000Z",[2024,10,27,2,0,0,0,-60]],
    ["Asia/Tokyo","2024-01-01T23:30:00Z",[2024,1,2,8,30,0,0,-540]],
    ["America/New_York","2024-01-01T01:30:00Z",[2023,12,31,20,30,0,0,300]],
    ["Australia/Lord_Howe","2024-01-15T12:00:00Z",[2024,1,15,23,0,0,0,-660]],
    ["Australia/Lord_Howe","2024-07-15T12:00:00Z",[2024,7,15,22,30,0,0,-630]]
  ]){
    const f=new api.CalendarEngine(zone).instantToLocal(Date.parse(iso));
    assert.deepEqual([f.year,f.month,f.day,f.hour,f.minute,f.second,f.millisecond,f.timezoneOffset],expected,zone+" "+iso);
  }
});
test("I13: gap compatible/later сдвигает вперёд; earlier назад; reject отклоняет",()=>{
  const engine=new api.CalendarEngine("Europe/Berlin"), fields=local(2024,3,31,2,30);
  assert.equal(engine.localToInstant(fields),Date.parse("2024-03-31T01:30Z"));
  assert.equal(engine.localToInstant(fields,"later"),Date.parse("2024-03-31T01:30Z"));
  assert.equal(engine.localToInstant(fields,"earlier"),Date.parse("2024-03-31T00:30Z"));
  assert.throws(()=>engine.localToInstant(fields,"reject"),RangeError);
});
test("I13: overlap compatible/earlier выбирает первый instant; later второй",()=>{
  const engine=new api.CalendarEngine("Europe/Berlin"), fields=local(2024,10,27,2,30);
  assert.equal(engine.localToInstant(fields),Date.parse("2024-10-27T00:30Z"));
  assert.equal(engine.localToInstant(fields,"earlier"),Date.parse("2024-10-27T00:30Z"));
  assert.equal(engine.localToInstant(fields,"later"),Date.parse("2024-10-27T01:30Z"));
  assert.throws(()=>engine.localToInstant(fields,"reject"),RangeError);
});
test("I13: зоны без DST, четверть часа и пропущенные сутки",()=>{
  assert.equal(new api.CalendarEngine("Asia/Kathmandu").instantToLocal(Date.parse("2024-01-15T12:00Z")).timezoneOffset,-345);
  assert.equal(new api.CalendarEngine("Asia/Kolkata").instantToLocal(Date.parse("2024-07-15T12:00Z")).timezoneOffset,-330);
  const apia=new api.CalendarEngine("Pacific/Apia");
  assert.equal(apia.localToInstant(local(2011,12,30,12)),Date.parse("2011-12-30T22:00Z"));
  assert.throws(()=>apia.localToInstant(local(2011,12,30,12),"reject"));
});
test("I13: границы Date, годы до н.э., immutable cache и некорректные значения",()=>{
  const engine=new api.CalendarEngine("UTC");
  for(const instant of [-8_640_000_000_000_000,-62167219200000,-1,0,8_640_000_000_000_000]){
    const f=engine.instantToLocal(instant);assert.equal(engine.localToInstant(f),instant);assert.ok(f.dayOfWeek>=0&&f.dayOfWeek<=6);
  }
  for(const instant of [NaN,Infinity,8_640_000_000_000_001,1.5])assert.throws(()=>engine.instantToLocal(instant));
  for(const fields of [local(2024,2,30),local(2024,13,1),local(2024,1,1,24),{...local(2024,1,1),year:NaN}])assert.throws(()=>engine.localToInstant(fields));
  for(const zone of ["Not/AZone","+03:00","-02:00"])assert.throws(()=>new api.CalendarEngine(zone));
});
