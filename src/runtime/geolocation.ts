import type { GeolocationOverrides } from "../profile/types";

function valuesObject(prototype: object, values: Record<string, number | null>): GeolocationCoordinates {
  const object = Object.create(prototype) as GeolocationCoordinates;
  for (const [key, value] of Object.entries(values)) Object.defineProperty(object, key, { value, enumerable: true });
  Object.defineProperty(object, "toJSON", { value: () => ({ ...values }) });
  return Object.freeze(object);
}

function overlayPosition(position: GeolocationPosition, profile: GeolocationOverrides): GeolocationPosition {
  const native = position.coords;
  // Only these two coordinates can come from a profile. All other fields and
  // the timestamp always come from this native response, including old profiles.
  const coords = valuesObject(globalThis.GeolocationCoordinates?.prototype ?? Object.prototype, {
    latitude: profile.latitude ?? native.latitude, longitude: profile.longitude ?? native.longitude,
    accuracy: native.accuracy, altitude: native.altitude, altitudeAccuracy: native.altitudeAccuracy,
    speed: native.speed, heading: native.heading
  });
  const timestamp = position.timestamp;
  const result = Object.create(globalThis.GeolocationPosition?.prototype ?? Object.prototype) as GeolocationPosition;
  Object.defineProperties(result, {
    coords: { value: coords, enumerable: true }, timestamp: { value: timestamp, enumerable: true },
    toJSON: { value: () => ({ coords: coords.toJSON(), timestamp }) }
  });
  return Object.freeze(result);
}

export function installGeolocationRuntime(profile: GeolocationOverrides): { status: "native" | "installed" | "unsupported"; reason?: string; dispose?: () => void } {
  if (profile.latitude === undefined && profile.longitude === undefined) return { status: "native" };
  if (!window.isSecureContext || !navigator.geolocation) return { status: "unsupported", reason: "Геолокация доступна только при наличии нативного API в secure context." };
  const geo = navigator.geolocation;
  const prototype = Object.getPrototypeOf(geo) as object;
  const methods = ["getCurrentPosition", "watchPosition", "clearWatch"] as const;
  const descriptors = methods.map((method) => Object.getOwnPropertyDescriptor(prototype, method));
  if (descriptors.some((item) => !item?.configurable || typeof item.value !== "function")) return { status: "unsupported", reason: "Нативные методы геолокации недоступны для переопределения." };
  const nativeGet = descriptors[0]!.value as Geolocation["getCurrentPosition"];
  const nativeWatch = descriptors[1]!.value as Geolocation["watchPosition"];
  const nativeClear = descriptors[2]!.value as Geolocation["clearWatch"];
  let active = true; let epoch = 0;
  const watches = new Set<number>();
  function getCurrentPosition(this: Geolocation, success: PositionCallback, error?: PositionErrorCallback | null, _input?: PositionOptions): void {
    const args = Array.from(arguments);
    if (this !== geo || typeof success !== "function" || error != null && typeof error !== "function") { Reflect.apply(nativeGet, this, args); return; }
    const started = epoch;
    args[0] = function (this: unknown, position: GeolocationPosition): void { if (active && epoch === started) Reflect.apply(success, this, [overlayPosition(position, profile)]); };
    if (error) args[1] = function (this: unknown, result: GeolocationPositionError): void { if (active && epoch === started) Reflect.apply(error, this, [result]); };
    Reflect.apply(nativeGet, geo, args);
  }
  function watchPosition(this: Geolocation, success: PositionCallback, error?: PositionErrorCallback | null, _input?: PositionOptions): number {
    const args = Array.from(arguments);
    if (this !== geo || typeof success !== "function" || error != null && typeof error !== "function") return Reflect.apply(nativeWatch, this, args) as number;
    const started = epoch; let id: number | undefined;
    args[0] = function (this: unknown, position: GeolocationPosition): void {
      if (active && epoch === started && (id === undefined || watches.has(id))) Reflect.apply(success, this, [overlayPosition(position, profile)]);
    };
    if (error) args[1] = function (this: unknown, result: GeolocationPositionError): void {
      if (active && epoch === started && (id === undefined || watches.has(id))) Reflect.apply(error, this, [result]);
    };
    id = Reflect.apply(nativeWatch, geo, args) as number;
    if (active && epoch === started) watches.add(id); else nativeClear.call(geo, id);
    return id;
  }
  function clearWatch(this: Geolocation, watchId: number): void {
    if (this !== geo || !arguments.length) { Reflect.apply(nativeClear, this, Array.from(arguments)); return; }
    const id = +(watchId as number) >> 0;
    nativeClear.call(geo, id); watches.delete(id);
  }
  const replacements = [getCurrentPosition, watchPosition, clearWatch];
  const applied: number[] = [];
  try {
    for (const [index, method] of methods.entries()) {
      Object.defineProperty(replacements[index], "length", { value: descriptors[index]!.value.length });
      Object.defineProperty(prototype, method, { ...descriptors[index], value: replacements[index] });
      applied.push(index);
    }
  } catch (error) {
    for (const index of applied.reverse()) Object.defineProperty(prototype, methods[index]!, descriptors[index]!);
    throw error;
  }
  const dispose = (): void => { active = false; epoch++; for (const id of watches) nativeClear.call(geo, id); watches.clear(); };
  window.addEventListener("pagehide", dispose); window.addEventListener("pageshow", () => { active = true; });
  return { status: "installed", dispose };
}
