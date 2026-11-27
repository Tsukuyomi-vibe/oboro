# Configuration files and compatibility

The main extension exports **oboro-config**, currently schema **3** (oboro 0.3.3). Export is a read-only operation on saved settings. [English usage](../README.md#configuration-backup) · [Русская инструкция](../README.ru.md#резервная-копия-конфигурации) · [JSON Schema v3](../schemas/oboro-config.v3.schema.json) · [Retained JSON Schema v2](../schemas/oboro-config.v2.schema.json) · [Retained JSON Schema v1](../schemas/oboro-config.v1.schema.json).

## Portable contract

Files are UTF-8 JSON, limited to **1 MiB of UTF-8 bytes**. The filename is `oboro-config-<manifest.version>.json`. These root fields are required:

| Field | Meaning |
| --- | --- |
| `format` | Literal `oboro-config` |
| `schemaVersion` | Positive integer selecting the published schema reader; currently 3 |
| `oboroVersion` | Exporter's `chrome.runtime.getManifest().version`, independent of schema selection |
| `config.profile` | Normalized profile draft, or null to clear the profile |
| `config.sitePolicy` | Selection mode, include and exclude rules |
| `config.ui` | Interface language en/ru and theme system/light/dark |
| `permissionHints.origins` | HTTP/HTTPS host-access hints; never authority to grant permissions |

Only `config.profile.name` is required when a profile exists. Latitude, longitude, preferred languages, formatting locale and named time zone are independent optional overrides. Accuracy, altitude, altitude accuracy, speed and heading are no longer configurable. An omitted value means **use the receiving browser's native value**. No default is read from the exporting computer and written into the file. Empty UI inputs omit the corresponding property; they do not become zero, null, an empty language list or a copied browser value. Zero is an explicit override. The keyboard layout defaults to the `native` marker, which keeps the receiving PC's map without capturing it.

For example, this v3 profile overrides only latitude on every PC:

```json
{
  "name": "123",
  "geolocation": { "latitude": 52.52 },
  "keyboardLayout": "native"
}
```

Longitude, accuracy, altitude, altitude accuracy, speed and heading are merged from each native geolocation response. Its timestamp, permission decisions and errors are preserved. If the browser cannot obtain a position, partial geolocation reports its native error; it cannot invent the omitted values. An empty geolocation object leaves the API untouched. Every coordinate override now requires a native position; the former seven-field synthetic-position path has been removed.

Missing `languages` leaves both navigator languages and Accept-Language unchanged. Missing `locale` keeps the browser's formatting locale even if a time zone is set. Missing `timeZone` keeps native local time even if a formatting locale is set. Missing/native keyboard layout keeps the native map. Derived navigator language is present only when languages are set, and is recomputed from their first normalized tag.

V3 accepts only `latitude` and `longitude` in `geolocation`; the five retired keys are rejected as unknown fields. `null`, `unknown`, empty strings and non-finite numbers are invalid coordinates. Optional internal profile properties are omitted; `geolocation: {}` and `keyboardLayout: "native"` are canonical native markers.

The external schema is independent of `RegionalProfile.schemaVersion`, `SitePolicy.schemaVersion`, and their local edit counters. Local `revision`, `policyRevision` and the profile revision clock are not serialized. They are assigned from the receiving installation when importing; clearing/recreating a profile does not reuse an earlier revision.

Only declared settings are serialized. No activation state, runtime snapshots, rollback journals, capability reports, document/tab IDs, shared activation IDs, proof material, timestamps, computer names, account names or local paths are added. User-provided profile names, coordinates and site lists remain private user data. Downloads are local, and `oboro-config-*.json` is ignored by Git. Synthetic regression fixtures have different filenames and remain tracked.

## Compatibility policy

1. Retain every published schema reader and its regression fixtures. App releases can share the same portable schema.
2. A supported schema is accepted even if oboroVersion names a newer exporter. App-version comparison is not a compatibility gate.
3. A future schema is rejected before writes with a request to update oboro. Unknown fields and unsupported values are rejected. The explicit v1/v2 migration exception discards the five retired geolocation settings, as explained in the import preview.
4. A changed field structure, enum meaning or default behavior requires a new external schema and a pure migration from previously supported schemas into the current DTO. Preserve the original source schema/app version in the import preview.
5. Validate both the source representation and the migrated result. Keep migrations free of storage writes, Chrome permission requests and activation effects.
6. Keep published schemas v1/v2 and their fixtures unchanged when introducing v3. Add the v3 schema, reader/migrations and round-trip/old-file regression cases. Internal storage or journal changes require their own recovery/migration rules.

The registry retains strict v1/v2 source validators and adds v3. After validating an old source, pure migrations keep latitude/longitude and all non-geolocation settings while dropping accuracy, altitude, altitude accuracy, speed and heading. A v2 file containing only retired geo fields becomes `geolocation: {}` and requests no geolocation override. Preview identifies the original schema and explains this removal. New exports never contain those settings. Stored profiles v1/v2 normalize in memory to v3 without writes on read; normal edits/imports persist v3. Published schemas and fixtures v1/v2 remain unchanged.

## Legacy profile adapter

Standalone regional-profile v1, v2 and v3 shapes, including their local schemaVersion/revision and derived language when languages exist, are recognized separately. V1/v2 adapters discard the retired geo settings and preserve the supported overrides. V3 rejects retired keys. Missing keyboardLayout keeps native behavior. These files never recorded an exporter app version, so the preview shows that version as unknown. The adapter strips local revision and derived language and restores only the profile; site policy, permission hints and UI preferences are preserved. All new full exports record the actual exporting oboro version.

## Preview and save

Preview performs no settings writes or permission requests. The worker retains the validated candidate with a snapshot of current saved settings. A preview expires after ten minutes, after worker restart, after successful import, or when its token is consumed. Up to eight previews can be retained. A changed saved snapshot causes a conflict instead of overwriting another editor's work.

The user reviews changed fields and explicitly confirms replacement. Unsaved profile or selection-mode edits block replacement and remain in their forms. The export button remains available for saved values. All-sites mode explicitly warns that it uses this Chrome's current grants, including addresses outside the file; importing does not revoke existing access.

Before writing, the activation coordinator must confirm that future overrides are disabled and registrations cleared. A durable journal stores the previous coherent settings, then the new settings are written and read back. The journal is cleared and verified before success is acknowledged. A failed/partial/unconfirmed write attempts rollback. Pending recovery is retried before worker commands and at startup; incomplete recovery blocks subsequent configuration mutations and is never reported as success. Corrupt journals are preserved rather than guessed at.

UI language/theme are delivered through a durable worker record and applied to the existing localStorage preferences by an extension page. A per-origin acknowledgment prevents replaying an old import over subsequent manual choices. If the page closes, the next popup/options page finishes the UI restoration. A UI storage/transport failure is reported separately from a verified profile/policy import; no reload is used to discard drafts.

Successful import leaves the master switch off. Existing pages may retain old wrappers until reload. Permission hints and selected-site rules populate a separate **Grant missing access** button; Chrome permission requests occur directly in that button's user gesture. Applying requires a separate action and the existing exact-Chrome compatibility gate. Diagnostic evidence is not imported from configuration JSON.

## Verification

`tests/config.test.mjs` covers frozen v1/v2 migration, v3 round-trips and rejection of retired fields, legacy normalization, version discrimination, UTF-8 limits, unknown fields, export privacy, revision monotonicity, conflicts and recovery under failed/partial/ambiguous storage writes. `tests/config-ui.test.mjs` exercises actual UI/worker bundles, native placeholders after partial imports, removal of old language rules, previews, UI restoration, cleanup, access gestures and the compatibility gate. `tests/partial-profile.test.mjs` checks every optional input and runtime module, partial get/watch responses and the same latitude-only JSON in two separate Node processes with different host locale/time zone/geolocation/keyboard providers. These are synthetic regression checks; native Chrome acceptance remains separate.
