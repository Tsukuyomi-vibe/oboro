import test from "node:test";
import assert from "node:assert/strict";
import { geoPage } from "./helpers/geolocation-page.mjs";
const watch = "navigator.geolocation.watchPosition(p=>calls.push(p),e=>calls.push(e))";

test("watchers keep native IDs, async delivery and independent cancellation", async () => {
  const page = geoPage();const first = page.run(watch), second = page.run(watch);
  assert.equal(first, 101); assert.equal(second, 102); assert.deepEqual(page.calls(), []);
  await page.flush(); assert.deepEqual(page.calls().map(p=>p.coords.latitude), [52.52,52.52]);
  page.run("navigator.geolocation.clearWatch(" + first + ");nativeCoords.accuracy=500;nativeCoords.altitude=99;nativeCoords.altitudeAccuracy=null;nativeCoords.speed=12;nativeCoords.heading=180;emitNativePosition()");
  await page.flush(100);
  assert.equal(page.calls().length, 3);
  assert.deepEqual(page.calls()[2].coords, { latitude:52.52,longitude:13.405,accuracy:500,altitude:99,altitudeAccuracy:null,speed:12,heading:180 });
  page.run("navigator.geolocation.clearWatch(" + second + ")"); assert.equal(page.run("nativeWatchCount()"), 0);
});

test("clearWatch cancels pending native successes and errors with one ID conversion", async () => {
  for (const permission of ["granted", "denied"]) {
    const page = geoPage({ permission }); page.run("globalThis.id=" + watch);
    page.run("globalThis.conversions=0;navigator.geolocation.clearWatch({valueOf(){conversions++;return id}})");
    await page.flush(); assert.deepEqual(page.calls(), []); assert.equal(page.run("conversions"), 1); assert.equal(page.pending(), 0);
  }
});

test("pagehide clears watches and suppresses stale get callbacks; pageshow accepts new requests", async () => {
  const page = geoPage({ delay: 100 }); page.run(watch); page.run(watch);
  page.run("navigator.geolocation.getCurrentPosition(p=>calls.push(p));emitWindow('pagehide')");
  await page.flush(100); assert.deepEqual(page.calls(), []); assert.equal(page.run("nativeWatchCount()"), 0);
  assert.equal(page.run("nativeClears"), 2);
  page.run("emitWindow('pageshow');navigator.geolocation.getCurrentPosition(p=>calls.push(p))");
  await page.flush(100); assert.equal(page.calls()[0].coords.latitude, 52.52);
});

test("a later native error remains the same object and can be cancelled", async () => {
  const page = geoPage(); page.run("globalThis.id=" + watch); await page.flush();
  page.run("nativeMode='unavailable';emitNativePosition()"); await page.flush();
  assert.equal(page.run("calls[1]===nativeError"), true); assert.equal(page.run("calls[1].code"), 2);
  page.run("navigator.geolocation.clearWatch(id);emitNativePosition()"); await page.flush(); assert.equal(page.calls().length, 2);
});

test("many cancelled watches leave no native resources; native receiver/ID validation remains", async () => {
  const page = geoPage();
  for (const code of ["navigator.geolocation.clearWatch()", "navigator.geolocation.clearWatch(1n)", "Geolocation.prototype.clearWatch.call({},1)", "navigator.geolocation.watchPosition(null)"]) assert.throws(()=>page.run(code));
  for (let i=0;i<100;i++) { const id=page.run(watch); page.run("navigator.geolocation.clearWatch(" + id + ")"); }
  await page.flush(); assert.equal(page.pending(), 0); assert.equal(page.run("nativeWatchCount()"), 0); assert.deepEqual(page.calls(), []);
});

test("callbacks preserve native this and do not receive wrapper internals", async () => {
  const page = geoPage();
  page.run("navigator.geolocation.getCurrentPosition(function(position){'use strict';calls.push({nativeThis:this===undefined,lat:position.coords.latitude})})");
  await page.flush(); assert.deepEqual(page.calls(), [{nativeThis:true,lat:52.52}]);
});
