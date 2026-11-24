import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = await build({ entryPoints: [root + "src/runtime/locale.ts"], bundle: true, write: false, format: "iife", globalName: "LocaleRuntime", logLevel: "silent" });
export function formatPage(locale = "de-DE", extra = "", timeZone) {
  const context = vm.createContext({});
  vm.runInContext(`globalThis.Native = Object.fromEntries(Object.getOwnPropertyNames(Intl).map(k=>[k,Intl[k]]));
    globalThis.nativeNumber = Number.prototype.toLocaleString; globalThis.nativeBigInt = BigInt.prototype.toLocaleString;
    globalThis.nativeDates = Object.fromEntries(['toLocaleString','toLocaleDateString','toLocaleTimeString'].map(k=>[k,Date.prototype[k]]));
    globalThis.nativeCompare = String.prototype.localeCompare;
    ${extra}`, context);
  vm.runInContext(result.outputFiles[0].text, context);
  vm.runInContext(`LocaleRuntime.installLocaleRuntime(${JSON.stringify(locale)},${JSON.stringify(timeZone)})`, context);
  return (code) => vm.runInContext(code, context);
}
test("I12: числа, BigInt, массивы и денежные форматы используют locale профиля", () => {
  const run = formatPage();
  for (const code of [
    "(1234567.89).toLocaleString() === nativeNumber.call(1234567.89,'de-DE')",
    "(12345678901234567890n).toLocaleString() === nativeBigInt.call(12345678901234567890n,'de-DE')",
    "new Intl.NumberFormat().format(1234.5) === new Native.NumberFormat('de-DE').format(1234.5)",
    "[1234.5,6789].toLocaleString() === [nativeNumber.call(1234.5,'de-DE'),nativeNumber.call(6789,'de-DE')].join(',')",
    "new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(123.45) === new Native.NumberFormat('de-DE',{style:'currency',currency:'USD'}).format(123.45)"
  ]) assert.equal(run(code), true, code);
});
test("I12: даты и время в toLocale* используют locale; явные options сохраняются", () => {
  const run = formatPage();
  for (const method of ["toLocaleString","toLocaleDateString","toLocaleTimeString"]) assert.equal(run(`new Date(1700000000000).${method}() === nativeDates.${method}.call(new Date(1700000000000),'de-DE')`), true);
  const options = "{calendar:'buddhist',numberingSystem:'thai',hourCycle:'h23',timeZone:'UTC',year:'numeric',hour:'numeric'}";
  assert.equal(run(`JSON.stringify(new Intl.DateTimeFormat(undefined,${options}).resolvedOptions()) === JSON.stringify(new Native.DateTimeFormat('de-DE',${options}).resolvedOptions())`), true);
});
test("I12: явные locale и пустой locale-list имеют определённую семантику", () => {
  const run = formatPage();
  assert.equal(run("new Intl.NumberFormat('en-US').format(1234.5) === new Native.NumberFormat('en-US').format(1234.5)"), true);
  assert.equal(run("new Intl.NumberFormat([]).format(1234.5) === new Native.NumberFormat('de-DE').format(1234.5)"), true);
  assert.equal(run("(1234.5).toLocaleString([]) === nativeNumber.call(1234.5,'de-DE')"), true);
  assert.equal(run("new Intl.NumberFormat(['zz-ZZ','fr-FR']).resolvedOptions().locale"), "fr-FR");
  assert.equal(run("new Intl.DateTimeFormat('ja-JP-u-ca-japanese').resolvedOptions().calendar"), "japanese");
});
test("I12: относительное время, plurals, списки, DisplayNames, Segmenter и сортировка", () => {
  const run = formatPage();
  for (const [name,options,operation] of [
    ["PluralRules","{}","select(2)"], ["RelativeTimeFormat","{numeric:'auto'}","format(-1,'day')"],
    ["ListFormat","{style:'long',type:'conjunction'}","format(['a','b','c'])"],
    ["DisplayNames","{type:'region'}","of('DE')"], ["Collator","{}","compare('ä','z')"]
  ]) assert.equal(run(`new Intl.${name}(undefined,${options}).${operation} === new Native.${name}('de-DE',${options}).${operation}`), true, name);
  assert.equal(run("JSON.stringify([...new Intl.Segmenter(undefined,{granularity:'word'}).segment('Hallo Welt')]) === JSON.stringify([...new Native.Segmenter('de-DE',{granularity:'word'}).segment('Hallo Welt')])"), true);
  assert.equal(run("'ä'.localeCompare('z') === nativeCompare.call('ä','z','de-DE')"), true);
  const turkish = formatPage("tr-TR");
  assert.equal(turkish("'I'.toLocaleLowerCase()"), "ı");
  assert.equal(turkish("'i'.toLocaleUpperCase()"), "İ");
  assert.equal(turkish("'I'.toLocaleLowerCase('en-US')"), "i");
});
test("I12: optional Intl не создаётся, Intl.Locale не переписывается", () => {
  const run = formatPage("de-DE", "delete Intl.DurationFormat; delete Intl.Segmenter;");
  assert.equal(run("'DurationFormat' in Intl || 'Segmenter' in Intl"), false);
  assert.equal(run("Intl.Locale === Native.Locale"), true);
  assert.equal(run("new Intl.Locale('en-US').baseName"), "en-US");
});
test("I12: constructors, статические методы, callable legacy и subclass работают", () => {
  const run = formatPage();
  assert.equal(run("Intl.NumberFormat().format(1234.5) === new Native.NumberFormat('de-DE').format(1234.5)"), true);
  assert.equal(run("Intl.Collator().resolvedOptions().locale"), "de");
  assert.equal(run("class Custom extends Intl.NumberFormat {}; globalThis.custom=new Custom(); custom instanceof Custom && custom instanceof Intl.NumberFormat"), true);
  assert.equal(run("new Intl.NumberFormat().constructor === Intl.NumberFormat"), true);
  assert.equal(run("Intl.NumberFormat.length === Native.NumberFormat.length && Intl.NumberFormat.name === Native.NumberFormat.name"), true);
  assert.equal(run("JSON.stringify(Intl.NumberFormat.supportedLocalesOf(['de-DE','fr-FR'])) === JSON.stringify(Native.NumberFormat.supportedLocalesOf(['de-DE','fr-FR']))"), true);
  assert.throws(()=>run("Intl.PluralRules()"));
});
test("I12: receiver, ошибки locale/options и Invalid Date сохраняются", () => {
  const run = formatPage();
  for (const code of ["Number.prototype.toLocaleString.call({})","BigInt.prototype.toLocaleString.call(1)","Date.prototype.toLocaleString.call({})","String.prototype.localeCompare.call(null,'a')","new Intl.NumberFormat(null)","new Intl.NumberFormat('en_US')","new Intl.DateTimeFormat(undefined,{calendar:'bad_thing'})"]) assert.throws(()=>run(code), undefined, code);
  assert.equal(run("new Date(NaN).toLocaleString('not_a_locale',null)"), "Invalid Date");
  assert.equal(run("globalThis.order=[]; const a={toString(){order.push('left');return 'a'}}; const b={toString(){order.push('right');return 'b'}}; String.prototype.localeCompare.call(a,b,{get length(){order.push('locale'); return 0}}); order.join(',')"), "left,right,locale");
});

test("I14: timezone профиля по умолчанию в Intl и всех Date.toLocale*",()=>{
  const run=formatPage("de-DE","","Europe/Berlin");
  assert.equal(run("new Intl.DateTimeFormat().resolvedOptions().timeZone"),"Europe/Berlin");
  for(const [iso,hour] of [["2024-01-15T12:00Z",13],["2024-07-15T12:00Z",14]]){
    assert.equal(run(`+new Intl.DateTimeFormat(undefined,{hour:'numeric',hourCycle:'h23'}).formatToParts(new Date('${iso}')).find(p=>p.type==='hour').value`),hour);
    for(const method of ["toLocaleString","toLocaleDateString","toLocaleTimeString"])assert.equal(run(`new Date('${iso}').${method}() === nativeDates.${method}.call(new Date('${iso}'),'de-DE',{timeZone:'Europe/Berlin'})`),true);
  }
});
test("I14: явная locale независима от timezone; UTC и прочие явные зоны сохраняются",()=>{
  const run=formatPage("de-DE","","Europe/Berlin");
  assert.equal(run("new Intl.DateTimeFormat('fr-FR').resolvedOptions().locale"),"fr-FR");
  assert.equal(run("new Intl.DateTimeFormat('fr-FR').resolvedOptions().timeZone"),"Europe/Berlin");
  for(const zone of ["UTC","America/New_York","Asia/Kathmandu"])assert.equal(run(`new Intl.DateTimeFormat(undefined,{timeZone:'${zone}'}).format(1700000000000) === new Native.DateTimeFormat('de-DE',{timeZone:'${zone}'}).format(1700000000000)`),true);
  assert.equal(run("new Date(0).toLocaleString('en-US',{timeZone:'UTC'}) === nativeDates.toLocaleString.call(new Date(0),'en-US',{timeZone:'UTC'})"),true);
});
test("I14: options не меняются, frozen/унаследованные getters получают исходный receiver",()=>{
  const run=formatPage("de-DE","","Europe/Berlin");
  assert.equal(run("const opts=Object.freeze({timeZone:undefined,year:'numeric'}); new Intl.DateTimeFormat(undefined,opts).resolvedOptions().timeZone"),"Europe/Berlin");
  assert.equal(run("globalThis.reads=0; globalThis.input=Object.create({get timeZone(){reads++; if(this!==input)throw new Error('wrong receiver');return undefined}}); new Intl.DateTimeFormat(undefined,input).resolvedOptions().timeZone"),"Europe/Berlin");
  assert.equal(run("reads"),1); assert.equal(run("Object.hasOwn(input,'timeZone')"),false);
  assert.equal(run("new Intl.DateTimeFormat(undefined,{calendar:'buddhist',numberingSystem:'thai',hourCycle:'h23',hour:'numeric'}).resolvedOptions().hourCycle"),"h23");
  for(const value of ["3","true","'abc'"])assert.equal(run(`new Intl.DateTimeFormat(undefined,${value}).resolvedOptions().timeZone`),"Europe/Berlin");
});
test("I14: native ошибки options, Invalid Date и callable DateTimeFormat сохраняются",()=>{
  const run=formatPage("de-DE","","Europe/Berlin");
  for(const code of ["new Intl.DateTimeFormat(undefined,null)","new Intl.DateTimeFormat(undefined,{timeZone:null})","new Date(0).toLocaleDateString(undefined,{timeStyle:'short'})","new Date(0).toLocaleTimeString(undefined,{dateStyle:'short'})"])assert.throws(()=>run(code));
  assert.equal(run("new Date(NaN).toLocaleString(undefined,null)"),"Invalid Date");
  assert.equal(run("Intl.DateTimeFormat().resolvedOptions().timeZone"),"Europe/Berlin");
  assert.equal(run("new Intl.DateTimeFormat(undefined,Object.freeze({timeZone:'UTC'})).resolvedOptions().timeZone"),"UTC");
});
