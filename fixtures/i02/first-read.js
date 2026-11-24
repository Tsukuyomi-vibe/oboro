(() => {
  const source = window.__REGION_I02_PROBE__;
  const marker = source && typeof source === "object" ? Object.freeze({
    runId: source.runId,
    readyState: source.readyState,
    href: source.href
  }) : null;
  const formats = new Intl.DateTimeFormat().resolvedOptions();
  const markerReader = window[Symbol.for("regional-profile.runtime.v1")];
  const runtime = typeof markerReader === "function" ? markerReader() : null;
  const dates = Object.freeze(["2024-01-15T12:34:56.789Z", "2024-07-15T12:34:56.789Z", "2024-03-31T01:00:00.000Z", "2024-10-27T01:00:00.000Z"].map((iso) => {
    const date = new Date(iso);
    return Object.freeze({ iso, timestamp: date.getTime(), utc: date.toISOString(), local: date.toString(),
      fields: Object.freeze([date.getFullYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]), offset: date.getTimezoneOffset(),
      formatted: date.toLocaleString(), explicitUTC: date.toLocaleString("en-US", { timeZone: "UTC" }) });
  }));
  const dateOperations = Object.freeze([
    { name: "components-winter", timestamp: new Date(2024, 0, 15, 12).getTime() },
    { name: "components-gap", timestamp: new Date(2024, 2, 31, 2, 30).getTime() },
    { name: "parse-date-only", timestamp: Date.parse("2024-01-15") },
    { name: "parse-local", timestamp: Date.parse("2024-01-15T12:00") },
    { name: "parse-explicit-UTC", timestamp: Date.parse("2024-01-15T12:00Z") },
    { name: "ambiguous-string-rejected", rejected: Number.isNaN(Date.parse("01/02/2024")) },
    ...["setDate", "setMonth", "setHours"].map((method) => {
      const date = new Date(2024, 2, 30, 12);
      const before = date.getTime();
      const returned = date[method](method === "setDate" ? 31 : method === "setMonth" ? 9 : 25);
      return { name: method, timestamp: date.getTime(), returned, elapsedHours: (returned - before) / 3_600_000, local: date.toString() };
    })
  ].map(Object.freeze));
  const temporal = (() => {
    const api = globalThis.Temporal;
    if (api === undefined) return Object.freeze({ status: "absent" });
    try {
      const instant = api.Now.instant();
      const zoned = api.Now.zonedDateTimeISO();
      return Object.freeze({ status: "available", timeZoneId: api.Now.timeZoneId(),
        instant: instant.toString(), epochNanoseconds: String(instant.epochNanoseconds),
        zoned: zoned.toString(), zonedTimeZoneId: zoned.timeZoneId, zonedEpochNanoseconds: String(zoned.epochNanoseconds),
        plainDateTime: api.Now.plainDateTimeISO().toString(), plainDate: api.Now.plainDateISO().toString(),
        plainTime: api.Now.plainTimeISO().toString(), explicitUTC: api.Now.zonedDateTimeISO("UTC").timeZoneId });
    } catch (error) { return Object.freeze({ status: "error", error: String(error) }); }
  })();
  const dateInterchange = (() => {
    class ProbeDate extends Date {}
    const date = new ProbeDate(1705320000123);
    const json = JSON.stringify({ date, invalid: new Date(NaN) });
    let clone;
    if (typeof globalThis.structuredClone === "undefined") clone = { status: "absent" };
    else try {
      const copied = globalThis.structuredClone({ date, invalid: new Date(NaN) });
      clone = { status: "available", timestamp: copied.date.getTime(), iso: copied.date.toISOString(),
        localHours: copied.date.getHours(), sourceLocalHours: date.getHours(),
        receivingDatePrototype: Object.getPrototypeOf(copied.date) === Date.prototype,
        subclassRemoved: !(copied.date instanceof ProbeDate), invalidPreserved: Number.isNaN(copied.invalid.getTime()) };
    } catch (error) { clone = { status: "error", error: String(error) }; }
    return Object.freeze({ json, structuredClone: Object.freeze(clone) });
  })();
  Object.defineProperty(window, "__REGION_I02_FIRST_READ__", {
    value: Object.freeze({
      requestId: document.currentScript.dataset.requestId,
      runId: document.currentScript.dataset.runId,
      href: location.href,
      documentOrigin: globalThis.origin,
      frame: window === window.top ? "top" : "frame",
      readyState: document.readyState,
      secureContext: window.isSecureContext,
      language: navigator.language,
      languages: Object.freeze([...navigator.languages]),
      locale: formats.locale,
      timezone: formats.timeZone,
      timezoneOffset: new Date().getTimezoneOffset(),
      userAgent: navigator.userAgent,
      numberSample: (1234567.89).toLocaleString(),
      explicitNumberSample: (1234567.89).toLocaleString("en-US"),
      dates,
      dateOperations,
      temporal,
      dateInterchange,
      keyboardApiAvailable: typeof navigator.keyboard?.getLayoutMap === "function",
      marker,
      regionalRuntime: runtime ? Object.freeze({ implementation: runtime.implementation, readyState: runtime.readyState, languages: runtime.languages, geolocation: runtime.geolocation, locale: runtime.locale, time: runtime.time, temporal: runtime.temporal,
        timeCoverage: Object.freeze({ ...runtime.timeCoverage }), timeCompatibility: runtime.timeCompatibility ? Object.freeze({ ...runtime.timeCompatibility,
          checks: Object.freeze([...runtime.timeCompatibility.checks]), failures: Object.freeze([...runtime.timeCompatibility.failures]) }) : null,
        keyboard: runtime.keyboard, keyboardLayout: runtime.keyboardLayout, keyboardReason: runtime.keyboardReason,
        needsReload: runtime.needsReload }) : null
    }),
    writable: false,
    configurable: false
  });
})();
