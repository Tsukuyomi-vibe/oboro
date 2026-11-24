import { execFileSync } from "node:child_process";

export function nativeDateResults(timeZone, cases) {
  const source = `
    const cases=${JSON.stringify(cases)};
    const finite=value=>Number.isFinite(value)?value:null;
    const snapshot=date=>({instant:finite(date.getTime()),iso:Number.isFinite(date.getTime())?date.toISOString():null,
      fields:['getFullYear','getMonth','getDate','getDay','getHours','getMinutes','getSeconds','getMilliseconds','getTimezoneOffset'].map(method=>finite(date[method]()))});
    const results=cases.map(item=>{
      if(item.kind==='parse')return finite(Date.parse(item.value));
      if(item.kind==='construct')return snapshot(Reflect.construct(Date,item.args));
      const date=new Date(item.start===null?NaN:item.start);
      const returned=Reflect.apply(Date.prototype[item.method],date,item.args);
      return {returned:finite(returned),...snapshot(date)};
    });
    process.stdout.write(JSON.stringify(results));
  `;
  return JSON.parse(execFileSync(process.execPath, ["-e", source], {
    env: {...process.env,TZ:timeZone},encoding:"utf8",windowsHide:true
  }));
}
export function dateSnapshotCode(expression) {
  return `(()=>{const date=${expression};const finite=n=>Number.isFinite(n)?n:null;
    return {instant:finite(date.getTime()),iso:Number.isFinite(date.getTime())?date.toISOString():null,
      fields:['getFullYear','getMonth','getDate','getDay','getHours','getMinutes','getSeconds','getMilliseconds','getTimezoneOffset'].map(method=>finite(date[method]()))}})()`;
}
