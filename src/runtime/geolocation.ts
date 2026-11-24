import type { RegionalGeolocation } from "../profile/types";

const MAX_UINT32 = 4294967295;
export function clampGeoMilliseconds(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  const number = +(value as number);
  if (Number.isNaN(number) || number <= 0) return 0;
  if (number >= MAX_UINT32) return MAX_UINT32;
  const floor = Math.floor(number); const fraction = number - floor;
  return fraction === 0.5 ? floor % 2 ? floor + 1 : floor : Math.round(number);
}
function options(value: unknown): PositionOptions {
  if (value !== undefined && value !== null && typeof value !== "object" && typeof value !== "function") throw new TypeError("PositionOptions must be an object.");
  const source = (value ?? {}) as Record<string, unknown>;
  const enableHighAccuracy = Boolean(source.enableHighAccuracy);
  const maximumAge = clampGeoMilliseconds(source.maximumAge, 0);
  const timeout = clampGeoMilliseconds(source.timeout, MAX_UINT32);
  return { enableHighAccuracy, maximumAge, timeout };
}
function valuesObject<T extends object>(prototype: object, values: T, toJSON = true): T {
  const object = Object.create(prototype) as T;
  for (const [key, value] of Object.entries(values)) Object.defineProperty(object, key, { value, enumerable: true });
  if (toJSON) Object.defineProperty(object, "toJSON", { value: () => ({ ...values }) });
  return Object.freeze(object);
}
export function syntheticPosition(profile: RegionalGeolocation, timestamp: number): GeolocationPosition {
  const values = {
    latitude: profile.latitude, longitude: profile.longitude, accuracy: profile.accuracy,
    altitude: profile.altitude, altitudeAccuracy: profile.altitudeAccuracy,
    speed: profile.speed, heading: profile.speed === 0 ? null : profile.heading
  };
  const coords = valuesObject(globalThis.GeolocationCoordinates?.prototype ?? Object.prototype, values) as GeolocationCoordinates;
  const result = Object.create(globalThis.GeolocationPosition?.prototype ?? Object.prototype) as GeolocationPosition;
  Object.defineProperties(result, {
    coords: { value: coords, enumerable: true }, timestamp: { value: timestamp, enumerable: true },
    toJSON: { value: () => ({ coords: { ...values }, timestamp }) }
  });
  return Object.freeze(result);
}
function positionError(code: number): GeolocationPositionError {
  const message = code === 1 ? "Geolocation permission denied." : code === 3 ? "Geolocation request timed out." : "Geolocation position unavailable.";
  return valuesObject(globalThis.GeolocationPositionError?.prototype ?? Object.prototype, { code, message, PERMISSION_DENIED: 1 as const, POSITION_UNAVAILABLE: 2 as const, TIMEOUT: 3 as const }, false) as GeolocationPositionError;
}

interface GeoRequest {
  watchId: number | null;
  success: PositionCallback;
  error: PositionErrorCallback | null | undefined;
  options: PositionOptions;
  active: boolean;
  delivered: boolean;
  permission: PermissionStatus | null;
  nativeWatch: number | null;
  tasks: Set<number>;
  cleanup: (() => void)[];
}

export function installGeolocationRuntime(profile: RegionalGeolocation): { status: "installed" | "unsupported"; reason?: string; dispose?: () => void } {
  if (!window.isSecureContext || !navigator.geolocation) return { status: "unsupported", reason: "Геолокация доступна только при наличии нативного API в secure context." };
  const geo = navigator.geolocation;
  const prototype = Object.getPrototypeOf(geo) as object;
  const methods = ["getCurrentPosition", "watchPosition", "clearWatch"] as const;
  const descriptors = methods.map((method) => Object.getOwnPropertyDescriptor(prototype, method));
  if (descriptors.some((item) => !item?.configurable || typeof item.value !== "function")) return { status: "unsupported", reason: "Нативные методы геолокации недоступны для переопределения." };
  const nativeGet = descriptors[0]!.value as Geolocation["getCurrentPosition"];
  const nativeWatch = descriptors[1]!.value as Geolocation["watchPosition"];
  const nativeClear = descriptors[2]!.value as Geolocation["clearWatch"];
  const query = navigator.permissions?.query?.bind(navigator.permissions);
  const now = Date.now.bind(Date);
  const schedule = window.setTimeout.bind(window);
  const cancel = window.clearTimeout.bind(window);
  const coordinates = Object.freeze({ ...profile });
  const requests = new Set<GeoRequest>();
  const watches = new Map<number, GeoRequest>();
  let nextWatchId = 1;
  let activeDocument = true;
  let cache: { position: GeolocationPosition; highAccuracy: boolean } | null = null;

  function task(request: GeoRequest, callback: () => void): void {
    const id = schedule(() => { request.tasks.delete(id); if (request.active) callback(); }, 0);
    request.tasks.add(id);
  }
  function stopNative(request: GeoRequest): void {
    if (request.nativeWatch !== null) {
      nativeClear.call(geo, request.nativeWatch);
      request.nativeWatch = null;
    }
  }
  function stop(request: GeoRequest): void {
    request.active = false;
    for (const id of request.tasks) cancel(id);
    request.tasks.clear();
    stopNative(request);
    for (const cleanup of request.cleanup) cleanup();
    request.cleanup.length = 0;
    requests.delete(request);
    if (request.watchId !== null) watches.delete(request.watchId);
  }
  function fail(request: GeoRequest, code: number): void {
    if (!request.active) return;
    stopNative(request);
    // Keep the task cancellable by clearWatch, including errors already queued.
    task(request, () => {
      const callback = request.error;
      if (request.watchId === null || code === 1) stop(request);
      else request.delivered = true; // TIMEOUT/UNAVAILABLE do not cancel a watch.
      callback?.(positionError(code));
    });
  }
  function visible(request: GeoRequest, callback: () => void): void {
    if (document.visibilityState !== "hidden") { callback(); return; }
    const resume = (): void => {
      if (!request.active || document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", resume);
      callback();
    };
    document.addEventListener("visibilitychange", resume);
    request.cleanup.push(() => document.removeEventListener("visibilitychange", resume));
  }
  function acquire(request: GeoRequest, nativeGranted = false): void {
    if (!request.active || request.delivered) return;
    visible(request, () => {
      const permission = request.permission;
      if (!permission || permission.state === "denied" || (!nativeGranted && permission.state !== "granted")) { fail(request, 1); return; }
      const acquisitionTime = now();
      const candidate = request.options.maximumAge! > 0 && cache && cache.highAccuracy === request.options.enableHighAccuracy && now() - cache.position.timestamp <= request.options.maximumAge! ? cache.position : null;
      if (!candidate && request.options.timeout === 0) { fail(request, 3); return; }
      task(request, () => {
        if (request.delivered) return;
        if (permission.state === "denied" || (!nativeGranted && permission.state !== "granted")) { cache = null; fail(request, 1); return; }
        if (document.visibilityState === "hidden") { acquire(request, nativeGranted); return; }
        if (!candidate && now() - acquisitionTime > request.options.timeout!) { fail(request, 3); return; }
        const position = candidate ?? syntheticPosition(coordinates, now());
        cache = { position, highAccuracy: request.options.enableHighAccuracy! };
        request.delivered = true;
        if (request.watchId === null) stop(request);
        Reflect.apply(request.success, undefined, [position]);
        // A fixed profile has no position changes to poll. Permission changes and
        // clearWatch/pagehide are event driven; there is no recurring timer.
      });
    });
  }
  function begin(request: GeoRequest): void {
    if (!activeDocument) { fail(request, 2); return; }
    const policy = (document as Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean }; featurePolicy?: { allowsFeature(feature: string): boolean } }).permissionsPolicy
      ?? (document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy;
    try { if (policy && !policy.allowsFeature("geolocation")) { fail(request, 1); return; } } catch { fail(request, 2); return; }
    visible(request, () => {
      if (!query) { fail(request, 2); return; }
      let checked: Promise<PermissionStatus>;
      try { checked = query({ name: "geolocation" }); } catch { fail(request, 2); return; }
      void checked.then((permission) => {
        if (!request.active) return;
        request.permission = permission;
        if (permission.state === "denied") { cache = null; fail(request, 1); return; }
        const changed = (): void => {
          if (!request.active) return;
          if (permission.state !== "granted") { cache = null; fail(request, 1); }
        };
        permission.addEventListener?.("change", changed);
        request.cleanup.push(() => permission.removeEventListener?.("change", changed));
        if (permission.state === "granted") { acquire(request); return; }
        if (permission.state !== "prompt") { fail(request, 2); return; }
        const success = (): void => {
          if (!request.active) return;
          stopNative(request);
          acquire(request, true);
        };
        const error = (result: GeolocationPositionError): void => {
          if (request.active) fail(request, [1, 2, 3].includes(result.code) ? result.code : 2);
        };
        try {
          // Only the native API may open the browser permission dialog.
          // Its position argument is deliberately never inspected.
          if (request.watchId === null) nativeGet.call(geo, success, error, request.options);
          else {
            const id = nativeWatch.call(geo, success, error, request.options);
            request.nativeWatch = id;
            if (!request.active) stopNative(request);
          }
        } catch { fail(request, 2); }
      }, () => { if (request.active) fail(request, 2); });
    });
  }
  function create(success: PositionCallback, error: PositionErrorCallback | null | undefined, input: PositionOptions | undefined, watchId: number | null): GeoRequest {
    if (typeof success !== "function" || (error != null && typeof error !== "function")) throw new TypeError("Geolocation callbacks must be functions.");
    const request: GeoRequest = { watchId, success, error, options: options(input), active: true, delivered: false, permission: null, nativeWatch: null, tasks: new Set(), cleanup: [] };
    requests.add(request);
    return request;
  }
  function getCurrentPosition(this: Geolocation, success: PositionCallback, error?: PositionErrorCallback | null, input?: PositionOptions): void {
    if (this !== geo) throw new TypeError("Illegal invocation");
    const request = create(success, error, input, null);
    begin(request);
  }
  function watchPosition(this: Geolocation, success: PositionCallback, error?: PositionErrorCallback | null, input?: PositionOptions): number {
    if (this !== geo) throw new TypeError("Illegal invocation");
    while (watches.has(nextWatchId)) nextWatchId = nextWatchId === 2147483647 ? 1 : nextWatchId + 1;
    const id = nextWatchId;
    const request = create(success, error, input, id);
    nextWatchId = id === 2147483647 ? 1 : id + 1;
    watches.set(id, request);
    begin(request);
    return activeDocument ? id : 0;
  }
  function clearWatch(this: Geolocation, watchId: number): void {
    if (this !== geo) throw new TypeError("Illegal invocation");
    if (!arguments.length) throw new TypeError("clearWatch requires a watch ID.");
    const id = +(watchId as number) >> 0;
    const request = watches.get(id);
    if (request) stop(request);
  }
  const replacements = [getCurrentPosition, watchPosition, clearWatch];
  for (let index = 0; index < methods.length; index++) {
    Object.defineProperty(replacements[index], "length", { value: descriptors[index]!.value.length });
    Object.defineProperty(prototype, methods[index]!, { ...descriptors[index], value: replacements[index] });
  }
  const dispose = (): void => { activeDocument = false; for (const request of requests) stop(request); cache = null; };
  window.addEventListener("pagehide", dispose);
  window.addEventListener("pageshow", () => { activeDocument = true; });
  return { status: "installed", dispose };
}
