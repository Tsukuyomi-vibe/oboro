# Oboro Check — 0.3.1

**English** | [Русский](probe-package-readme.md)

This package includes the separate **oboro — diagnostics** extension in dist-probe and the local Oboro Check server. The diagnostic extension has access only to four fixed localhost hosts and tests early injection and network rules.

The diagnostic extension defaults to English. Use **Language → Русский** at the top of its page to switch to Russian and save the choice. Main and diagnostic extensions have separate local preferences.

1. Install a supported Node.js version: 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26+. From the extracted package, run `node fixtures/i02/server.mjs`. The server requires no npm dependencies. Stop it with Ctrl+C.
2. Disable the main extension during compatibility checks. Open the selected.localhost:8787 address shown by the server. Before installing or enabling the diagnostic extension, collect observations for all four hosts and save the server baseline JSON. The report must include iframe observations and the exact Chrome version.
3. Load **dist-probe** as an unpacked extension in chrome://extensions. Open diagnostics from its icon and import the baseline JSON collected without this build.
4. Check API availability with Chrome's user-script toggle off and on, recording each observed state. Reload the diagnostic page after changing the toggle. Prepare baseline, open all four links and collect the report. Arm the probe before navigating to all armed links, then collect again.
5. Remove the probe, open all four off links and collect again. Confirm registrations and rules were cleaned up. Export the full JSON; CONFIRMED requires complete evidence for the same exact Chrome build, including the native baseline and toggle checks.
6. Disable the diagnostic extension after cleanup. Import the full report into the main oboro 0.3.1 extension. It independently validates the report, exact Chrome version and current API availability.

System, Light and Dark themes are available in diagnostics and on the local fixture. Theme preferences are saved per origin. This fixture tests SPA navigation, BFCache, new tabs, early iframe/srcdoc/blob contexts and workers. BFCache requires an actual pageshow.persisted=true observation. Workers and opaque contexts have no baseline API overrides.

Server observations stay in memory until the process stops. Reports can include browser languages, time zone, version, extension identifiers and request times. Keep raw exports private; they are excluded from the source repository by the project's ignore rules. A successful build or automated test run does not establish native Chrome acceptance.
