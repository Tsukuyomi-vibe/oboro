import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { runtimeBundle } from "../scripts/runtime-build.mjs";
import { syntheticI02Evidence, SYNTHETIC_CHROME } from "./helpers/i02-evidence.mjs";
import { fakePageReport } from "./helpers/page-report.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = await runtimeBundle(root);
const result = await build({ stdin: { contents: `export * from './src/activation/coordinator.ts'; export * from './src/activation/backend.ts'; export * from './src/activation/capabilities.ts'; export * from './src/activation/frames.ts'; export * from './src/runtime/compiler.ts'; export * from './src/runtime/types.ts'; export * from './src/profile/repository.ts'; export * from './src/profile/example.ts'; export * from './src/profile/types.ts'; export * from './src/sites/policy.ts'; export * from './src/sites/repository.ts'; export * from './src/control/queue.ts';`, resolveDir: root }, define: { __REGION_RUNTIME_BUNDLE__: JSON.stringify(source) }, bundle: true, write: false, format: "esm", platform: "browser", logLevel: "silent" });
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const clone = (value) => JSON.parse(JSON.stringify(value));
const id = "a".repeat(32);
const defaultPolicy = () => api.createSitePolicy({ mode: "selected_sites", include: [{ host: "example.com", schemes: ["https"], includeSubdomains: false }], exclude: [] }, 1);
function memory(initial = {}, events = []) {
  let data = clone(initial);
  const faults={onWrite:null,fail:null,failAfter:null};
  return { faults, snapshot: () => clone(data), get: async (key) => clone(Object.hasOwn(data, key) ? { [key]: data[key] } : {}), set: async (items) => { events.push(`write:${Object.keys(items).join(',')}`);if(faults.fail?.(items))throw Error('synthetic persistence failure');data = clone({ ...data, ...items });faults.onWrite?.(clone(items),clone(data));if(faults.failAfter?.(items))throw Error('synthetic lost write acknowledgment'); } };
}
function sender(tabId = 7, frameId = 0, documentId = "doc", url = "https://example.com/") { return { id, tab: { id: tabId }, frameId, documentId, documentLifecycle: "active", url, origin: new URL(url).origin }; }
function report(snapshot, overrides = {}) { return fakePageReport(snapshot, overrides); }

function harness(options = {}) {
  const events = []; const flags = { complete: true, available: true, match: true, fullPermissions: true, ...options };
  const data = { [api.SITE_POLICY_KEY]: defaultPolicy() };
  if (!options.noProfile) data[api.PROFILE_STORAGE_KEY] = api.getExampleProfile();
  if (!options.noProof) data[api.CAPABILITY_EVIDENCE_KEY] = { report: syntheticI02Evidence() };
  Object.assign(data,options.initialData);
  const local = memory(data, events); const session = memory(options.initialSession??{}); const frames = new api.FrameRegistry(session);
  let installed = clone(options.initialInstalled??{ main: [], bridge: [], rules: [] }); let counter = 0; let coordinator;
  const profiles = new api.ProfileRepository(local, () => coordinator.invalidate("profile changed"));
  const sites = new api.SitePolicyRepository(local, () => coordinator.invalidate("policy changed"));
  const backend = {
    readOwned: async () => { events.push("read-owned"); return clone(installed); },
    install: async (plan) => { events.push("install"); installed = { main: plan.mainScript ? [plan.mainScript] : [], bridge: plan.bridgeScript ? [plan.bridgeScript] : [], rules: plan.networkRules }; if (flags.failInstall) throw new Error("synthetic install failure"); },
    restore: async (previous) => { events.push("restore"); if (flags.failRestore) throw new Error("synthetic rollback failure"); installed = clone(previous); },
    clear: async () => { events.push("clear"); if (flags.failClear) throw new Error("synthetic clear failure"); installed = { main: [], bridge: [], rules: [] }; },
    registrationsMatch: async (plan) => flags.match && JSON.stringify(installed)===JSON.stringify({main:plan.mainScript?[plan.mainScript]:[],bridge:plan.bridgeScript?[plan.bridgeScript]:[],rules:plan.networkRules}),
    reloadSelected: async (snapshot) => {
      events.push("reload"); if (flags.failReload) throw new Error("synthetic reload failure");
      const doc = `${snapshot.activationId}-doc`;
      frames.observe({ tabId: 7, frameId: 0, parentFrameId: -1, documentId: doc, url: "https://example.com/", transitionType: "reload" }, snapshot);
      if (flags.complete) { frames.accept(sender(7, 0, doc), report(snapshot, flags.reportOverrides), snapshot, id); frames.complete(7, doc); }
      return { targets: [7], manualTabs: [], reasons: [] };
    },
    waitForDocuments: async (snapshot, targets) => frames.verification(snapshot, targets),
    resync: async (snapshot) => {
      const doc = frames.list().find(entry=>entry.tabId===7&&entry.frameId===0&&entry.lifecycle==='active')?.documentId??`${snapshot.activationId}-doc`;
      frames.observe({ tabId: 7, frameId: 0, parentFrameId: -1, documentId: doc, url: "https://example.com/" }, snapshot);
      if(flags.complete){frames.accept(sender(7, 0, doc), report(snapshot, flags.reportOverrides), snapshot, id);frames.complete(7, doc);}return [7];
    }
  };
  const dependencies = {
    storage: local, backend, frames, loadProfile: () => profiles.load(), loadPolicy: () => sites.load(),
    origins: async () => flags.origins??["https://example.com/*"], contains: async () => flags.fullPermissions,
    capabilities: async () => ({ available: flags.available, reasons: flags.available ? [] : ["userScripts unavailable"], environment: { exactChromeVersion: flags.chromeVersion??SYNTHETIC_CHROME } }),
    setEnabled: async (enabled) => { events.push(`enabled:${enabled}`); }, id: () => `${options.idPrefix??'activation'}-${++counter}`,buildVersion:options.buildVersion??'test-build-1'
  };
  coordinator = new api.ActivationCoordinator(dependencies);
  return { coordinator, dependencies, frames, local, session, backend, profiles, sites, flags, events, installed: () => clone(installed), restart: () => { coordinator = new api.ActivationCoordinator(dependencies); return coordinator; } };
}

test("I08: M0 требует исходные доказательства, текущий build и проверенный toggle; status=CONFIRMED не достаточно", () => {
  assert.equal(api.validateCapabilityEvidence(syntheticI02Evidence(), SYNTHETIC_CHROME).chromeVersion, SYNTHETIC_CHROME);
  assert.throws(() => api.validateCapabilityEvidence(syntheticI02Evidence(), "123.0.4567.89"));
  assert.throws(() => api.validateCapabilityEvidence({ format: "region-i02-evidence-v1", status: "CONFIRMED" }, SYNTHETIC_CHROME));
  const partial = syntheticI02Evidence(); partial.serverReports.armed.observations.splice(0, 1);
  assert.throws(() => api.validateCapabilityEvidence(partial, SYNTHETIC_CHROME));
  const toggle = syntheticI02Evidence(); toggle.session.inspections[0].extensionId = "c".repeat(32);
  assert.throws(() => api.validateCapabilityEvidence(toggle, SYNTHETIC_CHROME));
});
test("I08: без M0, профиля или реального API регистрации не устанавливаются", async () => {
  for (const options of [{ noProof: true }, { noProfile: true }, { available: false }]) {
    const h = harness(options); const state = await h.coordinator.apply();
    assert.equal(state.status, "LIMITED"); assert.equal(state.committed, null); assert.ok(!h.events.includes("install"));
    assert.equal((await h.coordinator.disable()).status, "OFF");
  }
});
test("I08: prepare → register/rules → reload → verify → commit; повтор без дубликатов", async () => {
  const h = harness(); const state = await h.coordinator.apply();
  assert.equal(state.status, "READY"); assert.equal(state.pending, null);
  assert.deepEqual(state.committed, { activationId: "activation-1", profileRevision: 1, policyRevision: 1 });
  assert.ok(h.events.indexOf("install") < h.events.indexOf("reload"));
  assert.equal((await h.coordinator.apply()).status, "READY");
  assert.equal(h.installed().main.length, 1); assert.equal(h.installed().bridge.length, 1); assert.equal(h.installed().rules.length, 1);
});
test("I08: неполная проверка не получает READY или committed новой версии", async () => {
  const h = harness({ complete: false }); const state = await h.coordinator.apply();
  assert.equal(state.status, "LIMITED"); assert.equal(state.pending.activationId, "activation-1"); assert.equal(state.committed, null);
  const snapshot = h.coordinator.activeSnapshot; const doc = `${snapshot.activationId}-doc`;
  h.frames.accept(sender(7, 0, doc), report(snapshot), snapshot, id); h.frames.complete(7, doc);
  await h.coordinator.refreshCoverage(); assert.equal(h.coordinator.view().status, "READY");
});
test("I08: частичный доступ остаётся LIMITED после последующих подтверждений", async () => {
  const h = harness({ fullPermissions: false });
  assert.equal((await h.coordinator.apply()).status, "LIMITED");
  await h.coordinator.refreshCoverage(); assert.equal(h.coordinator.view().status, "LIMITED");
});
test("I08: сбой установки, проверки и перезагрузки откатывает только собственную конфигурацию", async () => {
  for (const failure of ["failInstall", "failReload", "match"]) {
    const h = harness(); await h.coordinator.apply(); const before = h.installed();
    h.flags[failure] = failure === "match" ? false : true;
    const failed = await h.coordinator.apply();
    assert.equal(failed.status, "ERROR"); assert.deepEqual(h.installed(), failure==='match'?{main:[],bridge:[],rules:[]}:before); assert.ok(h.events.includes("restore"));
  }
  const broken = harness({ failInstall: true, failClear: true });
  assert.equal((await broken.coordinator.apply()).status, "ERROR"); assert.notEqual(broken.coordinator.view().pending, null);
});
test("I08: OFF снимает будущие подмены, документы требуют reload; ошибка очистки не объявляет OFF", async () => {
  const h = harness(); await h.coordinator.apply();
  assert.equal((await h.coordinator.disable()).status, "NEEDS_RELOAD"); assert.equal(h.installed().main.length, 0); assert.equal(h.installed().rules.length, 0);
  h.frames.observe({ tabId: 7, frameId: 0, documentId: "native-doc", parentFrameId: -1, url: "https://example.com/", transitionType: "reload" }, null);
  await h.coordinator.refreshCoverage(); assert.equal(h.coordinator.view().status, "OFF");
  const failing = harness(); await failing.coordinator.apply(); failing.flags.failClear = true;
  assert.equal((await failing.coordinator.disable()).status, "ERROR");
});
test("I08/I09: изменение профиля и удаление сайта снимают старые регистрации до записи", async () => {
  const h = harness(); await h.coordinator.apply();
  const queue = new api.ConfigurationQueue();
  await queue.run(() => h.profiles.save({ ...api.getExampleProfileDraft(), name: "Новая версия" }, 1));
  assert.equal(h.installed().rules.length, 0); assert.equal(h.coordinator.activeSnapshot, null);
  assert.equal((await h.profiles.load()).revision, 2);
  await h.coordinator.apply();
  await queue.run(() => h.sites.save({ mode: "selected_sites", include: [], exclude: [] }, 1));
  assert.equal(h.installed().main.length, 0); assert.equal((await h.coordinator.apply()).status, "OUT_OF_SCOPE");
});
test("I08: normal worker restart проверяет сохранённые регистрации; pending не становится READY", async () => {
  const h = harness(); await h.coordinator.apply();
  const restarted = h.restart(); await restarted.initialize(); assert.equal(restarted.view().status, "READY");
  const interrupted = harness({ complete: false }); await interrupted.coordinator.apply();
  const next = interrupted.restart(); await next.initialize(); assert.equal(next.view().status, "LIMITED"); assert.equal(interrupted.installed().rules.length, 1);
  assert.notEqual(next.view().pending,null);interrupted.flags.complete=true;const resumed=interrupted.restart();await resumed.initialize();assert.equal(resumed.view().status,'READY');assert.equal(resumed.view().pending,null);
});
test("I08/I09: навигация выбранной вкладки на посторонний сайт убирает старый target", async () => {
  const h = harness(); await h.coordinator.apply();
  h.frames.observe({ tabId: 7, frameId: 0, documentId: "control-doc", parentFrameId: -1, url: "https://control.test/" }, h.coordinator.activeSnapshot);
  await h.coordinator.rootNavigated(7, "https://control.test/");
  assert.deepEqual(h.coordinator.view().targets, []);
  assert.equal(h.coordinator.view().status, "READY");
  assert.equal(h.frames.list()[0].status, "OUT_OF_SCOPE");
});
test("I08/I09: ошибка снятия подмены не выдаёт удаление сайта за успех", async () => {
  const h = harness(); await h.coordinator.apply(); h.flags.failClear = true;
  await assert.rejects(h.sites.save({ mode: "selected_sites", include: [], exclude: [] }, 1));
  assert.equal((await h.sites.load()).include.length, 1); assert.equal(h.coordinator.view().status, "ERROR");
});
test("I09: native sender определяет документ и origin; stale ack и посторонний sender отвергаются", () => {
  const frames = new api.FrameRegistry(memory());
  const snapshot = api.createRuntimeSnapshot(api.getExampleProfile(), defaultPolicy(), ["https://example.com/*"], "a", true);
  frames.observe({ tabId: 7, frameId: 0, documentId: "new", parentFrameId: -1, url: "https://example.com/" }, snapshot);
  assert.equal(frames.accept(sender(7, 0, "old"), report(snapshot), snapshot, id), false);
  assert.equal(frames.accept({ ...sender(7, 0, "new"), id: "other" }, report(snapshot), snapshot, id), false);
  assert.equal(frames.accept(sender(7, 0, "new", "https://unselected.test/"), report(snapshot), snapshot, id), false);
  assert.equal(frames.accept(sender(7, 0, "new"), report(snapshot), snapshot, id), true);
  frames.complete(7, "new"); assert.equal(frames.verification(snapshot, [7]).complete, true);
  assert.equal(frames.list()[0].origin, "https://example.com"); assert.equal(frames.list()[0].telemetryTrusted, false);
});
test("I09: unselected iframe/opaque контексты не получают версию; выбранный iframe независим от parent", () => {
  const frames = new api.FrameRegistry(memory());
  const snapshot = api.createRuntimeSnapshot(api.getExampleProfile(), defaultPolicy(), ["https://example.com/*"], "a", true);
  frames.observe({ tabId: 7, frameId: 0, documentId: "parent", parentFrameId: -1, url: "https://control.test/" }, snapshot, true);
  frames.observe({ tabId: 7, frameId: 2, documentId: "child", parentFrameId: 0, url: "https://example.com/" }, snapshot);
  frames.observe({ tabId: 7, frameId: 3, documentId: "opaque", parentFrameId: 0, url: "about:blank" }, snapshot);
  assert.equal(frames.accept(sender(7, 2, "child"), report(snapshot), snapshot, id), true);
  assert.equal(frames.list().find((entry) => entry.documentId === "parent").status, "OUT_OF_SCOPE");
  assert.equal(frames.list().find((entry) => entry.documentId === "opaque").status, "UNSUPPORTED");
  assert.ok(frames.verification(snapshot, []).reasons.some((reason) => reason.includes("host permission")));
  assert.equal(frames.list().find((entry) => entry.documentId === "parent").profileRevision, null);
});
test("I09: late/mismatched acknowledgement требует перезагрузки, профиль из сообщения не принимается", () => {
  const frames = new api.FrameRegistry(memory());
  const snapshot = api.createRuntimeSnapshot(api.getExampleProfile(), defaultPolicy(), ["https://example.com/*"], "a", true);
  frames.observe({ tabId: 7, frameId: 0, documentId: "doc", parentFrameId: -1, url: "https://example.com/" }, snapshot);
  assert.equal(frames.accept(sender(), report(snapshot, { profileRevision: 999 }), snapshot, id), false);
  frames.accept(sender(), report(snapshot, { readyState: "complete" }), snapshot, id);
  assert.equal(frames.list()[0].status, "NEEDS_RELOAD"); assert.equal(snapshot.profile.revision, 1);
  assert.equal(frames.accept(sender(), { channel: "regional-control:v1", operation: "activation.apply" }, snapshot, id), false);
});
test("I08: нативный adapter сохраняет посторонние rules/scripts и сравнивает action без порядка JSON-ключей", async () => {
  let main = [{ id: "foreign-script" }]; let bridge = [{ id: "foreign-bridge" }]; let rules = [{ id: 12, priority: 1, action: { type: "block" }, condition: { urlFilter: "foreign" } }];
  globalThis.chrome = {
    userScripts: { getScripts: async ({ ids }) => clone(main.filter((entry) => ids.includes(entry.id))), unregister: async ({ ids }) => { main = main.filter((entry) => !ids.includes(entry.id)); }, register: async (entries) => { main.push(...clone(entries)); } },
    scripting: { getRegisteredContentScripts: async ({ ids }) => clone(bridge.filter((entry) => ids.includes(entry.id))), unregisterContentScripts: async ({ ids }) => { bridge = bridge.filter((entry) => !ids.includes(entry.id)); }, registerContentScripts: async (entries) => { bridge.push(...clone(entries)); } },
    declarativeNetRequest: { getDynamicRules: async () => clone(rules), updateDynamicRules: async ({ removeRuleIds = [], addRules = [] }) => { rules = rules.filter((entry) => !removeRuleIds.includes(entry.id)); rules.push(...clone(addRules)); } }
  };
  const backend = new api.ChromeActivationBackend(new api.FrameRegistry(memory()));
  const snapshot = api.createRuntimeSnapshot(api.getExampleProfile(), defaultPolicy(), ["https://example.com/*"], "a", true);
  const plan = api.compileActivation(snapshot);
  await backend.install(plan); await backend.install(plan);
  assert.equal(main.length, 2); assert.equal(bridge.length, 2); assert.equal(rules.length, 2);
  const owned = rules.find((entry) => api.ownsNetworkRule(entry.id));
  owned.action = { requestHeaders: [{ value: owned.action.requestHeaders[0].value, operation: "set", header: "accept-language" }], type: "modifyHeaders" };
  assert.equal(await backend.registrationsMatch(plan), true);
  await backend.clear(); assert.deepEqual(main, [{ id: "foreign-script" }]); assert.deepEqual(bridge, [{ id: "foreign-bridge" }]); assert.equal(rules[0].id, 12);
});

test("I18: полный проверенный TimeRuntime допускает READY, частичный не коммитится", async () => {
  const h=harness(); const state=await h.coordinator.apply();
  assert.equal(state.status,"READY"); assert.notEqual(state.committed,null); assert.equal(state.pending,null);
  assert.equal(api.TIME_RUNTIME_COMPLETE,true);
  const limited=harness({reportOverrides:{time:"partial",timeCompatibility:{status:"not_run",structuredClone:"not_run",checks:[],failures:["synthetic unsupported Temporal"]}}});
  const partial=await limited.coordinator.apply();
  assert.equal(partial.status,"LIMITED");assert.equal(partial.committed,null);assert.notEqual(partial.pending,null);
  await limited.coordinator.refreshCoverage();
  assert.equal(limited.coordinator.view().status,"LIMITED");
});
test("I12/I14: ошибка locale/time в документе не проходит проверку покрытия", () => {
  for(const broken of [{locale:"error"},{time:"error"},{timeCoverage:{formatting:false,localRead:false,construction:false,parse:false,localSetters:false,temporal:false,complete:false}}]){
    const frames=new api.FrameRegistry(memory());
    const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),["https://example.com/*"],"a",true);
    frames.observe({tabId:7,frameId:0,documentId:"doc",parentFrameId:-1,url:"https://example.com/"},snapshot);
    frames.accept(sender(),report(snapshot,broken),snapshot,id); frames.complete(7,"doc");
    assert.equal(frames.verification(snapshot,[7]).complete,false);
  }
});

test("I16/I17: отчёт старого Date-runtime не подтверждает новое покрытие",()=>{
  const frames=new api.FrameRegistry(memory());
  const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),["https://example.com/*"],"a",true);
  frames.observe({tabId:7,frameId:0,documentId:"doc",parentFrameId:-1,url:"https://example.com/"},snapshot);
  const oldCoverage={...report(snapshot).timeCoverage,construction:false,parse:false,localSetters:false};
  assert.equal(frames.accept(sender(),report(snapshot,{timeCoverage:oldCoverage}),snapshot,id),true);
  frames.complete(7,"doc");
  assert.equal(frames.list()[0].status,"LIMITED");
  assert.equal(frames.verification(snapshot,[7]).complete,false);
});

test("I18: Temporal absence допустим; неподтверждённые/противоречивые результаты не проходят verify",()=>{
  const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),["https://example.com/*"],"a",true);
  const base=report(snapshot);
  const cases=[
    [{temporal:"absent",timeCoverage:{...base.timeCoverage,temporal:false}},true],
    [{temporal:"installed",timeCoverage:{...base.timeCoverage,temporal:true}},true],
    [{temporal:"unsupported"},false],
    [{temporal:"installed",timeCoverage:{...base.timeCoverage,temporal:false}},false],
    [{temporal:"absent",timeCoverage:{...base.timeCoverage,temporal:true}},false],
    [{timeCoverage:{...base.timeCoverage,complete:false}},false],
    [{timeCompatibility:{...base.timeCompatibility,status:"not_run"}},false],
    [{timeCompatibility:{...base.timeCompatibility,structuredClone:"failed"}},false],
    [{timeCompatibility:{...base.timeCompatibility,failures:["contradiction"]}},false]
  ];
  for(const [overrides,expected]of cases){
    const frames=new api.FrameRegistry(memory());
    frames.observe({tabId:7,frameId:0,documentId:"doc",parentFrameId:-1,url:"https://example.com/"},snapshot);
    assert.equal(frames.accept(sender(),report(snapshot,overrides),snapshot,id),true);
    frames.complete(7,"doc");
    assert.equal(frames.verification(snapshot,[7]).complete,expected,JSON.stringify(overrides));
  }
});
test("I18: старый report без compatibility отвергается, diagnostics snapshot не меняет реестр",()=>{
  const frames=new api.FrameRegistry(memory());
  const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),["https://example.com/*"],"a",true);
  frames.observe({tabId:7,frameId:0,documentId:"doc",parentFrameId:-1,url:"https://example.com/"},snapshot);
  const legacy=report(snapshot);delete legacy.timeCompatibility;delete legacy.temporal;
  assert.equal(frames.accept(sender(),legacy,snapshot,id),false);
  frames.accept(sender(),report(snapshot),snapshot,id);
  const view=frames.list();view[0].timeCompatibility.checks.push("changed");
  assert.deepEqual(frames.list()[0].timeCompatibility.checks,["synthetic-unit-ack"]);
});

test("I19: READY требует подтверждения выбранной карты; native/unsupported/error и старый ACK не подменяют успех",()=>{
  for(const layout of ['native','de-qwertz']){
    const snapshot=api.createRuntimeSnapshot({...api.getExampleProfile(),keyboardLayout:layout},defaultPolicy(),['https://example.com/*'],'keyboard-ack',true);
    for(const keyboard of ['native','installed','unsupported','error','not_checked']){
      const frames=new api.FrameRegistry(memory());
      frames.observe({tabId:7,frameId:0,documentId:'doc',parentFrameId:-1,url:'https://example.com/'},snapshot);
      const value=report(snapshot,{keyboard,keyboardLayout:layout,keyboardReason:keyboard==='unsupported'?'native API unavailable':null});
      assert.equal(frames.accept(sender(),value,snapshot,id),true);frames.complete(7,'doc');
      assert.equal(frames.verification(snapshot,[7]).complete,keyboard===(layout==='native'?'native':'installed'));
      const old={...value};delete old.keyboard;assert.equal(frames.accept(sender(),old,snapshot,id),false);
      assert.equal(frames.accept(sender(),{...value,keyboardLayout:'unknown'},snapshot,id),false);
      if(keyboard==='unsupported')assert.ok(frames.verification(snapshot,[7]).reasons.some(reason=>reason.includes('native API unavailable')));
    }
  }
});

test('I21: durable prepared после частичной установки очищается без ложного commit',async()=>{
  const h=harness();let prepared;
  h.local.faults.onWrite=(items,data)=>{if(items.activationJournal?.kind==='apply'&&items.activationJournal.phase==='prepared')prepared=clone(data)};
  await h.coordinator.apply();const installed=h.installed();assert.ok(prepared.activationJournal);
  assert.equal(JSON.stringify(prepared.activationJournal).includes('RegionRuntime'),false);
  for(const partial of [{...installed,rules:[]},{...installed,main:[]},installed]){
    const recovered=harness({initialData:prepared,initialInstalled:partial,idPrefix:'recovered'});await recovered.coordinator.initialize();
    assert.equal(recovered.coordinator.view().status,'ERROR');assert.equal(recovered.coordinator.view().committed,null);
    assert.deepEqual(recovered.installed(),{main:[],bridge:[],rules:[]});assert.equal(recovered.local.snapshot().activationJournal,null);
  }
});

test('I21: прерванная замена восстанавливает только актуальный предыдущий снимок',async()=>{
  const h=harness();await h.coordinator.apply();let prepared;
  h.local.faults.onWrite=(items,data)=>{if(items.activationJournal?.phase==='prepared'&&items.activationJournal.kind==='apply')prepared=clone(data)};
  await h.coordinator.apply();const current=h.installed();
  const recovered=harness({initialData:prepared,initialInstalled:current});await recovered.coordinator.initialize();
  assert.equal(recovered.coordinator.view().recovery,'rolled_back');assert.equal(recovered.coordinator.view().status,'ERROR');
  assert.equal(recovered.local.snapshot().activationSnapshot.activationId,'activation-1');assert.equal(recovered.installed().main.length,1);
  const changed=clone(prepared);changed.regionalProfile={...changed.regionalProfile,revision:2,name:'new profile'};
  const stale=harness({initialData:changed,initialInstalled:current});await stale.coordinator.initialize();
  assert.equal(stale.installed().main.length,0);assert.equal(stale.coordinator.activeSnapshot,null);
});

test('I21: awaiting_documents возобновляется только после свежего ACK и совпадения фактических правил',async()=>{
  const h=harness({complete:false});await h.coordinator.apply();
  const recovered=harness({initialData:h.local.snapshot(),initialSession:h.session.snapshot(),initialInstalled:h.installed(),complete:false});
  await recovered.coordinator.initialize();assert.notEqual(recovered.coordinator.view().status,'READY');assert.notEqual(recovered.coordinator.view().pending,null);
  recovered.flags.complete=true;await recovered.coordinator.reconcileAfterUpdate();
  assert.equal(recovered.coordinator.view().status,'READY');assert.equal(recovered.local.snapshot().activationJournal,null);
});

test('I21: прерванный OFF и осиротевшие регистрации завершают очистку даже без activeSnapshot',async()=>{
  const h=harness();await h.coordinator.apply();let intent;
  h.local.faults.onWrite=(items,data)=>{if(items.activationJournal?.kind==='clear')intent=clone(data)};
  const installed=h.installed();await h.coordinator.disable();
  const recovered=harness({initialData:intent,initialInstalled:installed});await recovered.coordinator.initialize();
  assert.equal(recovered.coordinator.view().enabled,false);assert.equal(recovered.installed().main.length,0);assert.equal(recovered.local.snapshot().activationJournal,null);
  const orphan=harness({initialInstalled:installed});await orphan.coordinator.initialize();
  assert.equal(orphan.coordinator.view().status,'OFF');assert.equal(orphan.installed().rules.length,0);
  const disabled=harness({initialInstalled:installed});await disabled.coordinator.disable();
  assert.equal(disabled.installed().main.length,0);await disabled.coordinator.disable();assert.equal(disabled.installed().rules.length,0);
});

test('I21: событие доступа во время register отменяет commit и не восстанавливает отозванную область',async()=>{
  const h=harness();await h.coordinator.apply();const install=h.backend.install;
  h.backend.install=async plan=>{await install(plan);h.flags.origins=[];h.coordinator.environmentChanged()};
  const state=await h.coordinator.apply();assert.equal(state.status,'ERROR');assert.equal(state.committed,null);
  assert.equal(h.installed().main.length,0);assert.equal(h.installed().rules.length,0);
});

test('I21: ошибка durable prepare не запускает register, ошибка commit не оставляет READY',async()=>{
  for(const stage of ['prepared','commit']){
    const h=harness();let failed=false;
    h.local.faults.fail=items=>{const hit=stage==='prepared'?items.activationJournal?.kind==='apply'&&items.activationJournal.phase==='prepared':items.activationState?.status==='READY';if(hit&&!failed){failed=true;return true}return false};
    const state=await h.coordinator.apply();assert.equal(state.status,'ERROR');assert.equal(state.committed,null);assert.equal(h.installed().main.length,0);
    if(stage==='prepared')assert.equal(h.events.includes('install'),false);
  }
});

test('I21: новая сборка пересоздаёт регистрации с новым activationId, старый ACK требует reload',async()=>{
  const h=harness();await h.coordinator.apply();const saved=h.local.snapshot();
  const updated=harness({initialData:saved,initialSession:h.session.snapshot(),initialInstalled:h.installed(),buildVersion:'test-build-2',idPrefix:'updated',reportOverrides:{activationId:'activation-1'}});
  await updated.coordinator.initialize();const state=updated.coordinator.view();
  assert.equal(state.status,'NEEDS_RELOAD');assert.equal(state.recovery,'rebuilt');assert.equal(state.pending.activationId,'updated-1');
  assert.equal(updated.installed().main.length,1);assert.equal(updated.coordinator.activeSnapshot.activationId,'updated-1');
  updated.flags.reportOverrides={};await updated.backend.reloadSelected(updated.coordinator.activeSnapshot);await updated.coordinator.refreshCoverage();assert.equal(updated.coordinator.view().status,'READY');
});

test('I21: потеря userScripts или смена точного Chrome build снимает READY при проверке',async()=>{
  for(const field of ['available','chromeVersion']){
    const h=harness();await h.coordinator.apply();h.flags[field]=field==='available'?false:'999.0.0.999';
    await h.coordinator.audit();assert.notEqual(h.coordinator.view().status,'READY');assert.equal(h.installed().rules.length,0);assert.equal(h.coordinator.activeSnapshot,null);
  }
});

test('I21: параллельные команды через общую очередь не обходят незавершённый apply',async()=>{
  const h=harness();const queue=new api.ConfigurationQueue();let release;const gate=new Promise(resolve=>{release=resolve});
  const install=h.backend.install;h.backend.install=async plan=>{await gate;return install(plan)};
  const first=queue.run(()=>h.coordinator.apply());const second=queue.run(()=>h.coordinator.disable());
  await new Promise(setImmediate);assert.equal(h.events.includes('enabled:false'),false);release();await Promise.all([first,second]);
  assert.equal(h.coordinator.view().enabled,false);assert.equal(h.installed().main.length,0);assert.equal(h.installed().rules.length,0);
});

test('I22: BFCache сохраняет старую версию, pageshow не становится применением новой',()=>{
  const frames=new api.FrameRegistry(memory());
  const first=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'first',true);
  const second=api.createRuntimeSnapshot({...api.getExampleProfile(),revision:2},defaultPolicy(),first.grantedOrigins,'second',true);
  const nav=(documentId,url='https://example.com/')=>({tabId:7,frameId:0,parentFrameId:-1,documentId,url});
  frames.observe(nav('old'),first);frames.accept(sender(7,0,'old'),report(first),first,id);frames.complete(7,'old');
  assert.equal(frames.context({...sender(7,0,'old'),documentLifecycle:'cached'},'pagehide',true,first,id),true);
  assert.equal(frames.list()[0].lifecycle,'cached');
  frames.observe(nav('control','https://control.test/'),first);frames.markReload(second);
  assert.equal(frames.context(sender(7,0,'old'),'pageshow',true,second,id),true);
  frames.accept(sender(7,0,'old'),report(first),second,id);
  const old=frames.list().find(entry=>entry.documentId==='old');
  assert.equal(old.profileRevision,1);assert.equal(old.expectedProfileRevision,2);assert.equal(old.status,'NEEDS_RELOAD');
  assert.equal(frames.verification(second,[7]).complete,false);
  frames.observe({...nav('fresh'),transitionType:'reload'},second);frames.accept(sender(7,0,'fresh'),report(second),second,id);frames.complete(7,'fresh');
  assert.equal(frames.verification(second,[7]).complete,true);
});

test('I22: BFCache той же версии допустим, OFF сохраняет reload для кэшированного документа',()=>{
  const frames=new api.FrameRegistry(memory());const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'cache',true);
  frames.observe({tabId:7,frameId:0,parentFrameId:-1,documentId:'cached',url:'https://example.com/'},snapshot);
  frames.accept(sender(7,0,'cached'),report(snapshot),snapshot,id);frames.complete(7,'cached');
  frames.context(sender(7,0,'cached'),'pagehide',true,snapshot,id);frames.context(sender(7,0,'cached'),'pageshow',true,snapshot,id);
  assert.equal(frames.verification(snapshot,[7]).complete,true);
  frames.context(sender(7,0,'cached'),'pagehide',true,snapshot,id);frames.markReload();
  frames.context(sender(7,0,'cached'),'pageshow',true,null,id);assert.equal(frames.needsReload,true);
  assert.equal(frames.list()[0].expectedProfileRevision,null);
  frames.observe({tabId:7,frameId:0,parentFrameId:-1,documentId:'native',url:'https://example.com/',transitionType:'reload'},null);
  assert.equal(frames.needsReload,false);
});

test('I22: новая вкладка требует native completion, SPA сохраняет documentId и установленную версию',()=>{
  const frames=new api.FrameRegistry(memory());const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'spa',true);
  const nav=(tabId,documentId,url='https://example.com/')=>({tabId,frameId:0,parentFrameId:-1,documentId,url});
  frames.observe(nav(7,'main'),snapshot);frames.accept(sender(7,0,'main'),report(snapshot),snapshot,id);frames.complete(7,'main');
  frames.observe(nav(7,'main','https://example.com/route#fragment'),snapshot,false,'history');
  assert.equal(frames.verification(snapshot,[7]).complete,true);assert.equal(frames.list()[0].lastEvent,'history');
  frames.observe(nav(8,'new-window'),snapshot);frames.accept(sender(8,0,'new-window'),report(snapshot),snapshot,id);
  assert.equal(frames.verification(snapshot,[7]).complete,false);frames.complete(8,'new-window');assert.equal(frames.verification(snapshot,[7]).complete,true);
});

test('I22: native sender origin/lifecycle обязателен, sandbox opaque не получает INSTALLED',()=>{
  const frames=new api.FrameRegistry(memory());const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'origin',true);
  frames.observe({tabId:7,frameId:0,parentFrameId:-1,documentId:'opaque',url:'https://example.com/'},snapshot);
  for(const change of [{origin:'null'},{origin:undefined},{origin:'https://other.test'},{documentLifecycle:'cached'},{documentLifecycle:'prerender'}])assert.equal(frames.accept({...sender(7,0,'opaque'),...change},report(snapshot),snapshot,id),false);
  frames.context({...sender(7,0,'opaque'),origin:'null'},'initial',false,snapshot,id);
  assert.equal(frames.list()[0].status,'UNSUPPORTED');assert.equal(frames.list()[0].origin,'null');assert.equal(frames.verification(snapshot,[7]).complete,false);
  assert.equal(frames.accept(sender(7,0,'opaque'),{...report(snapshot),implementation:5},snapshot,id),false);
});

test('I22: about/blob/srcdoc и ошибки навигации показывают пробел, подтверждённое уничтожение снимает кэш',()=>{
  const frames=new api.FrameRegistry(memory());const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'gaps',true);
  frames.observe({tabId:7,frameId:0,parentFrameId:-1,documentId:'root',url:'https://example.com/'},snapshot);
  frames.accept(sender(7,0,'root'),report(snapshot),snapshot,id);frames.complete(7,'root');
  for(const [index,url]of ['about:blank','about:srcdoc','blob:https://example.com/id','data:text/html,hello'].entries())frames.observe({tabId:7,frameId:index+1,parentFrameId:0,documentId:'gap-'+index,url},snapshot);
  assert.equal(frames.verification(snapshot,[7]).complete,false);assert.equal(frames.list().filter(entry=>entry.status==='UNSUPPORTED').length,4);
  frames.reconcileTabFrames(7,['root']);assert.equal(frames.verification(snapshot,[7]).complete,true);
  frames.context(sender(7,0,'root'),'pagehide',true,snapshot,id);frames.markReload();frames.context({...sender(7,0,'root'),documentLifecycle:'cached'},'pagehide',false,snapshot,id);
  assert.equal(frames.needsReload,false);
  frames.observe({tabId:7,frameId:0,parentFrameId:-1,documentId:'failed',url:'https://example.com/'},snapshot);frames.navigationError(7,0,'failed');
  assert.equal(frames.list()[0].status,'LIMITED');assert.equal(frames.verification(snapshot,[7]).complete,false);
});

test('I21: потеря подтверждения после durable commit не оставляет успешный статус или осиротевшие правила',async()=>{
  const h=harness();let failed=false;h.local.faults.failAfter=items=>{if(!failed&&items.activationState?.status==='READY'){failed=true;return true}return false};
  await h.coordinator.apply();assert.equal(h.coordinator.view().status,'ERROR');assert.equal(h.local.snapshot().activationState.status,'ERROR');
  assert.equal(h.installed().main.length,0);assert.equal(h.installed().rules.length,0);
});

test('I22: неполная persistence диагностики не даёт complete даже при успешных модулях',()=>{
  const h=harness();const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'partial-ledger',true);
  h.frames.observe({tabId:7,frameId:0,parentFrameId:-1,documentId:'doc',url:'https://example.com/'},snapshot);h.frames.accept(sender(),report(snapshot),snapshot,id);h.frames.complete(7,'doc');
  h.frames.persistenceLimited=true;assert.equal(h.frames.verification(snapshot,[7]).complete,false);
});

test('I21: повторный неизменный ACK не вызывает цикл записей activationState и перерисовки UI',async()=>{
  const h=harness();await h.coordinator.apply();const writes=h.events.filter(event=>event.startsWith('write:')).length;
  await h.coordinator.refreshCoverage();await h.coordinator.refreshCoverage();
  assert.equal(h.coordinator.view().status,'READY');assert.equal(h.events.filter(event=>event.startsWith('write:')).length,writes);
});

test('I22: pagehide без persisted уничтожает также дочерние документы, не создавая ложный BFCache',()=>{
  const frames=new api.FrameRegistry(memory());const snapshot=api.createRuntimeSnapshot(api.getExampleProfile(),defaultPolicy(),['https://example.com/*'],'destroy',true);
  for(const frameId of [0,1]){const documentId='destroy-'+frameId;frames.observe({tabId:7,frameId,parentFrameId:frameId===0?-1:0,documentId,url:'https://example.com/'},snapshot);frames.accept(sender(7,frameId,documentId),report(snapshot),snapshot,id)}
  assert.equal(frames.list().length,2);frames.context(sender(7,0,'destroy-0'),'pagehide',false,snapshot,id);
  frames.markReload();assert.equal(frames.list().length,0);assert.equal(frames.needsReload,false);
});
