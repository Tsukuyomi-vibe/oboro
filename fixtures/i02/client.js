/* This script runs after the immutable first-read snapshot has been captured. */
void (async () => {
  const firstRead = window.__REGION_I02_FIRST_READ__;
  const network = window.__REGION_I02_NETWORK__;
  const show = (id, value) => { document.getElementById(id).textContent = JSON.stringify(value, null, 2); };
  show("first-read", firstRead);
  show("network", network);
  show("external-script", window.__REGION_I02_EXTERNAL_SCRIPT__ ?? null);
  const geoButton = document.getElementById("request-geolocation");
  const geoOptions = () => ({ timeout: Number(document.getElementById("geo-timeout").value), maximumAge: Number(document.getElementById("geo-maximum-age").value), enableHighAccuracy: document.getElementById("geo-high-accuracy").checked });
  const positionData = (position) => ({ coords: Object.fromEntries(["latitude", "longitude", "accuracy", "altitude", "altitudeAccuracy", "speed", "heading"].map((key) => [key, position.coords[key]])), timestamp: position.timestamp, deltaFromNow: Date.now() - position.timestamp });
  geoButton.addEventListener("click", () => {
    if (!navigator.geolocation) { show("geo-result", { error: "Нативный API недоступен в этом контексте." }); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      show("geo-result", positionData(position));
    }, (error) => show("geo-result", { code: error.code, message: error.message }), geoOptions());
  });
  const watchButton = document.getElementById("watch-geolocation");
  const clearButton = document.getElementById("clear-geolocation");
  let watchId = null;
  const watchEvents = [];
  const recordWatch = (event) => { watchEvents.push(event); if (watchEvents.length > 50) watchEvents.shift(); show("geo-watch-result", watchEvents); };
  watchButton.addEventListener("click", () => {
    if (!navigator.geolocation || watchId !== null) return;
    watchButton.disabled = true; clearButton.disabled = false;
    watchId = navigator.geolocation.watchPosition((position) => recordWatch({ success: positionData(position) }), (error) => {
      recordWatch({ error: { code: error.code, message: error.message } });
      if (error.code === 1) { watchId = null; watchButton.disabled = false; clearButton.disabled = true; }
    }, geoOptions());
  });
  const clearWatch = () => {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; watchButton.disabled = false; clearButton.disabled = true;
  };
  clearButton.addEventListener("click", () => { clearWatch(); recordWatch({ cleared: true }); });
  window.addEventListener("pagehide", clearWatch);
  const keyboardEvents = [];
  const recordKeyboard = (value) => { keyboardEvents.push(value); if (keyboardEvents.length > 30) keyboardEvents.shift(); show("keyboard-events", keyboardEvents); };
  document.getElementById("request-keyboard").addEventListener("click", async () => {
    if (!navigator.keyboard?.getLayoutMap) { show("keyboard-result", { status: "unsupported" }); return; }
    try {
      const map = await navigator.keyboard.getLayoutMap();
      show("keyboard-result", { size: map.size, entries: [...map], keyY: map.get("KeyY"), keyZ: map.get("KeyZ"), readonly: typeof map.set === "undefined" });
    } catch (error) { show("keyboard-result", { error: error.name, message: error.message }); }
  });
  navigator.keyboard?.addEventListener("layoutchange", () => recordKeyboard({ event: "layoutchange" }));
  for (const type of ["keydown", "keyup", "compositionstart", "compositionupdate", "compositionend", "input"]) document.getElementById("keyboard-input").addEventListener(type, (event) => {
    recordKeyboard({ event: type, key: event.key, code: event.code, isComposing: event.isComposing, data: event.data });
  });
  const hosts = window.__REGION_I02_HOSTS__;
  const echoes = await Promise.all(hosts.map(async (host) => {
    const target = `${location.protocol}//${host}:${location.port}/api/echo?run=${firstRead.runId}`;
    try {
      const response = await fetch(target, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { host, ok: true, request: await response.json() };
    } catch (error) { return { host, ok: false, error: String(error) }; }
  }));
  show("fetch-results", echoes);
  let browser = { userAgent: navigator.userAgent, fullVersionList: null, error: null };
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const details = await navigator.userAgentData.getHighEntropyValues(["fullVersionList"]);
      browser.fullVersionList = details.fullVersionList ?? null;
    }
  } catch (error) { browser.error = String(error); }
  try {
    const response = await fetch(`/api/observations?run=${firstRead.runId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit",
      body: JSON.stringify({ firstRead, browser, echoes, externalScript: window.__REGION_I02_EXTERNAL_SCRIPT__ ?? null })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    document.getElementById("capture-status").textContent = "Наблюдение записано на сервере.";
  } catch (error) {
    document.getElementById("capture-status").textContent = `Ошибка записи: ${String(error)}`;
  }
})();
