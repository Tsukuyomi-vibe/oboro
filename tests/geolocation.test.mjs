import test from "node:test";
import assert from "node:assert/strict";
import { geoPage } from "./helpers/geolocation-page.mjs";
const get = "navigator.geolocation.getCurrentPosition(p=>calls.push(p),e=>calls.push(e))";

test("geolocation replaces latitude/longitude and preserves all five native fields, timestamp and readonly JSON", async () => {
  const page = geoPage(); page.run(get); assert.deepEqual(page.calls(), []);
  await page.flush();
  assert.deepEqual(page.json("calls[0].coords"), { latitude: 52.52, longitude: 13.405, accuracy: 17, altitude: 40, altitudeAccuracy: 3, speed: 0, heading: 92 });
  assert.equal(page.run("calls[0].timestamp===nativePosition.timestamp"), true);
  assert.deepEqual(page.json("calls[0].toJSON().coords"), page.json("calls[0].coords"));
  assert.equal(page.run("Object.isFrozen(calls[0])&&Object.isFrozen(calls[0].coords)&&calls[0] instanceof GeolocationPosition"), true);
  assert.equal(page.run("nativeCalls"), 1);
});

test("retired values in an obsolete runtime input never override native readings", async () => {
  const page = geoPage({ profile: { latitude: 0, longitude: 0, accuracy: 999, altitude: -5, altitudeAccuracy: null, speed: 40, heading: 270 } });
  page.run(get); await page.flush();
  assert.deepEqual(page.json("calls[0].coords"), { latitude: 0, longitude: 0, accuracy: 17, altitude: 40, altitudeAccuracy: 3, speed: 0, heading: 92 });
});

test("empty or retired-only geolocation input leaves native API identity and position unchanged", async () => {
  for (const profile of [{}, { accuracy: 999, altitude: 0, altitudeAccuracy: 2, speed: 4, heading: 270 }]) {
    const page = geoPage({ profile }); assert.equal(page.run("installed.status"), "native");
    assert.equal(page.run("navigator.geolocation.getCurrentPosition===originalGet"), true);
    page.run(get); await page.flush(); assert.equal(page.run("calls[0]===nativePosition"), true);
  }
});

test("native denial, Permissions Policy, unavailable and timeout errors pass through unchanged", async () => {
  for (const [options, code] of [[{ permission: "denied" }, 1], [{ policyAllowed: false }, 1], [{ nativeMode: "unavailable" }, 2], [{ nativeMode: "timeout" }, 3]]) {
    const page = geoPage(options); page.run(get); await page.flush();
    assert.equal(page.run("calls[0]===nativeError"), true); assert.equal(page.run("calls[0].code"), code);
    assert.equal(page.run("nativeCalls"), 1); assert.equal(page.run("typeof nativePosition"), "undefined");
  }
});

test("native prompt acquisition is used once and browser option objects are forwarded without inspection", async () => {
  const page = geoPage({ permission: "prompt" });
  page.run("globalThis.reads=0;globalThis.options=Object.freeze({get maximumAge(){reads++;return 25},timeout:50,enableHighAccuracy:true});navigator.geolocation.getCurrentPosition(p=>calls.push(p),null,options)");
  assert.equal(page.run("nativeOptions===options"), true); assert.equal(page.run("reads"), 0);
  await page.flush(); assert.equal(page.run("nativeCalls"), 1); assert.equal(page.run("calls[0].coords.latitude"), 52.52);
});

test("native argument/receiver errors remain observable; insecure contexts do not get wrappers", () => {
  const page = geoPage();
  for (const code of ["navigator.geolocation.getCurrentPosition()", "navigator.geolocation.getCurrentPosition(null)", "navigator.geolocation.getCurrentPosition(()=>{},1)", "Geolocation.prototype.getCurrentPosition.call({},()=>{})"]) assert.throws(() => page.run(code));
  const insecure = geoPage({ secure: false }); assert.equal(insecure.run("installed.status"), "unsupported");
  assert.equal(insecure.run("navigator.geolocation.getCurrentPosition===originalGet"), true);
});
