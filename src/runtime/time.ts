import type { RegionalProfile } from "../profile/types";
import type { RuntimeReport, TimeCompatibility } from "./types";
import { CalendarEngine, verifyCalendarEngine } from "./calendar";
import { installLocaleRuntime } from "./locale";
import { installDateRuntime } from "./date";
import { installTemporalRuntime } from "./temporal";
import { createTimeVerifier } from "./time-compatibility";

const emptyCoverage = () => Object.freeze({ formatting: false, localRead: false, construction: false, parse: false, localSetters: false, temporal: false, complete: false });
export function emptyTimeCompatibility(failures: readonly string[] = []): Readonly<TimeCompatibility> {
  return Object.freeze({ status: "not_run", structuredClone: "not_run", checks: Object.freeze([]), failures: Object.freeze([...failures]) });
}
type TimeInstallation = Pick<RuntimeReport, "locale" | "time" | "temporal" | "timeCoverage" | "timeCompatibility" | "reasons">;
export function installTimeRuntime(profile: RegionalProfile): TimeInstallation {
  const result: TimeInstallation = {
    locale: "error", time: "error", temporal: "not_checked", timeCoverage: emptyCoverage(),
    timeCompatibility: emptyTimeCompatibility(), reasons: []
  };
  const rollback: (() => void)[] = [];
  let restoreFailed = false;
  try {
    verifyCalendarEngine();
    const calendar = new CalendarEngine(profile.timeZone);
    const verify = createTimeVerifier(calendar, profile.locale);
    const temporal = installTemporalRuntime(calendar.timeZone);
    result.temporal = temporal.status;
    if (temporal.status !== "installed" && temporal.status !== "absent") {
      result.time = temporal.status === "unsupported" ? "partial" : "error";
      result.timeCompatibility = emptyTimeCompatibility([temporal.reason ?? "Temporal.Now не поддержан."]);
      throw new Error(temporal.reason ?? "Temporal.Now не поддержан.");
    }
    rollback.push(temporal.rollback);
    rollback.push(installLocaleRuntime(profile.locale, calendar.timeZone));
    rollback.push(installDateRuntime(calendar));
    const compatibility = verify(temporal.status);
    result.timeCompatibility = compatibility;
    if (compatibility.status !== "passed") throw new Error(compatibility.failures.join(" "));
    result.locale = "installed"; result.time = "installed";
    result.timeCoverage = Object.freeze({ formatting: true, localRead: true, construction: true, parse: true, localSetters: true, temporal: temporal.status === "installed", complete: true });
    return result;
  } catch (error) {
    result.reasons.push(error instanceof Error ? error.message : "Ошибка модуля времени.");
    for (const undo of rollback.reverse()) {
      try { undo(); } catch { restoreFailed = true; }
    }
    if (result.temporal === "installed") result.temporal = "error";
    if (result.timeCompatibility.status === "not_run" && !result.timeCompatibility.failures.length) result.timeCompatibility = emptyTimeCompatibility(result.reasons);
    if (restoreFailed) {
      result.time = "error"; result.reasons.push("Откат времени не завершён; перезагрузите документ.");
      return result;
    }
    // Locale-only formatting remains useful when timezone installation fails;
    // it does not introduce a mixed Date/Intl/Temporal timezone configuration.
    try { installLocaleRuntime(profile.locale); result.locale = "installed"; }
    catch (localeError) { result.reasons.push(localeError instanceof Error ? localeError.message : "Ошибка locale."); }
    return result;
  }
}
