# oboro for Chrome — 0.3.1

**English** | [Русский](core-package-readme.md)

Oboro applies a regional profile to selected sites. The package includes the main dist build, English and Russian installation guides, a data reference, bundled dependency licenses and an anonymous verification summary.

**Native Chrome Stable/Beta acceptance is still incomplete.** A complete, successful Oboro Check report for your exact Chrome version is required before overrides can be enabled. See the [acceptance matrix](core-acceptance-matrix.json).

## Install or update

1. Extract oboro-0.3.1.zip and open chrome://extensions in Chrome.
2. Enable Developer mode, click Load unpacked and select the **dist** folder from the extracted package.
3. To update an existing unpacked installation, replace files in its current dist folder, click reload on its extension card and reopen settings. Keep the same installation path to retain its identity and settings.
4. Allow user scripts in extension details if Chrome shows that setting. Reload the extension after changing it.
5. Open the popup and select **Open settings**. The interface defaults to English. **Language → Русский** switches it to Russian and saves the choice. Language and theme controls are at the top of settings and the bottom of the popup. The interface language is independent of the regional profile.
6. Fill in a profile or use the Berlin example, then save it. Select sites and grant access. An empty selection enables nothing; exclusions take priority.
7. Use the separate **oboro-probe-0.3.1.zip** package to complete Oboro Check. Remove the probe, confirm cleanup, disable the diagnostic extension and import the full JSON report into the main extension.
8. Select **Apply and reload selected pages**. An existing selected cross-site iframe may need its parent page reloaded manually.

After updating, reload previously processed pages to remove old wrappers and diagnostic objects. The page-facing report does not publish your permission list, profile name, shared activation identifier or internal revisions. See [privacy](privacy.md) and the [data reference](../info.md), both in Russian.

## Configuration backup

Open **Configuration backup** in settings and click **Export saved configuration** to download `oboro-config-<version>.json`. It includes saved profile/site/UI settings, permission hints, mandatory oboroVersion and an independent schemaVersion. Unsaved drafts and runtime/diagnostic state are excluded. The file contains private coordinates and sites; keep it private.

Choose a JSON file, review changes and confirm **Import these settings**. Legacy v1 profile files restore only the profile. Full import leaves overrides off, retains existing Chrome permissions and offers a separate button for missing access. All-sites mode uses the current browser's grants. Apply separately after checking compatibility; previously processed pages need a reload. Future schemas are rejected without changing settings; interrupted writes have a rollback journal. [Format contract](configuration-format.md) and [v1 schema](../schemas/oboro-config.v1.schema.json).

## Disable and coverage limits

The master switch removes future script registrations and network rules. Reload previously processed documents to restore native APIs. If cleanup is incomplete, use **Disable and retry cleanup**.

Date, Intl and supported existing Temporal.Now use the profile time zone by default. Explicit zones and absolute timestamps are preserved. Ambiguous date strings such as 01/02/2024 return Invalid Date/NaN. Missing Temporal is not created. Keyboard-map overrides retain native typing, events, shortcuts and IME behavior.

IP addresses, network routes, website storage and site workers are not changed. Opaque or unverified contexts are skipped. BFCache returns an existing profile revision and may require reloading to resume geolocation watches. Document diagnostics do not prove the absence of every leak or make the extension undetectable.

Settings are stored locally. Raw Oboro Check reports may contain real browser details; keep them private. Generated packages contain an anonymous verification summary rather than raw console logs. The packages are unsigned and unpublished. [Release notes](releases/0.3.1.md) are available in Russian.
