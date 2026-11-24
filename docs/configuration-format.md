# Configuration files and compatibility

The main extension exports **oboro-config**, currently schema **1**. Export is a read-only operation on saved settings. [English usage](../README.md#configuration-backup) · [Русская инструкция](../README.ru.md#резервная-копия-конфигурации) · [JSON Schema v1](../schemas/oboro-config.v1.schema.json).

## Portable contract

Files are UTF-8 JSON, limited to **1 MiB of UTF-8 bytes**. The filename is `oboro-config-<manifest.version>.json`. These root fields are required:

| Field | Meaning |
| --- | --- |
| `format` | Literal `oboro-config` |
| `schemaVersion` | Positive integer selecting the published schema reader; currently 1 |
| `oboroVersion` | Exporter's `chrome.runtime.getManifest().version`, independent of schema selection |
| `config.profile` | Normalized profile draft, or null to clear the profile |
| `config.sitePolicy` | Selection mode, include and exclude rules |
| `config.ui` | Interface language en/ru and theme system/light/dark |
| `permissionHints.origins` | HTTP/HTTPS host-access hints; never authority to grant permissions |

Profile data includes name, all seven geolocation fields, preferred languages, formatting locale, named time zone and keyboard layout ID. Unknown optional geolocation fields normalize to null; zero is preserved. An omitted optional keyboardLayout means native, retaining the behavior of older profiles. The derived navigator language is recomputed from the first normalized language tag.

The external schema is independent of `RegionalProfile.schemaVersion`, `SitePolicy.schemaVersion`, and their local edit counters. Local `revision`, `policyRevision` and the profile revision clock are not serialized. They are assigned from the receiving installation when importing; clearing/recreating a profile does not reuse an earlier revision.

Only declared settings are serialized. No activation state, runtime snapshots, rollback journals, capability reports, document/tab IDs, shared activation IDs, proof material, timestamps, computer names, account names or local paths are added. User-provided profile names, coordinates and site lists remain private user data. Downloads are local, and `oboro-config-*.json` is ignored by Git. Synthetic regression fixtures have different filenames and remain tracked.

## Compatibility policy

1. Retain every published schema reader and its regression fixtures. App releases can share the same portable schema.
2. A supported schema is accepted even if oboroVersion names a newer exporter. App-version comparison is not a compatibility gate.
3. A future schema is rejected before writes with a request to update oboro. Invalid/unknown fields and unsupported values are not silently discarded or substituted.
4. A changed field structure, enum meaning or default behavior requires a new external schema and a pure migration from previously supported schemas into the current DTO. Preserve the original source schema/app version in the import preview.
5. Validate both the source representation and the migrated result. Keep migrations free of storage writes, Chrome permission requests and activation effects.
6. Keep schema v1 and its v1 fixture unchanged when introducing v2. Add the v2 schema, reader/migration and round-trip/old-file regression cases. Internal storage or journal changes require their own recovery/migration rules.

In the current release the registry contains the v1 reader; there is no invented v0 or speculative v2 conversion. Native Intl support, host rules and finite numbers are validated by the existing runtime-independent validators in addition to the JSON Schema's structural constraints.

## Legacy profile adapter

The existing regional-profile v1 shape, including schemaVersion/revision/language and optionally keyboardLayout, is recognized separately. Missing keyboardLayout keeps native behavior. It never recorded an exporter app version, so the preview shows that version as unknown. The adapter strips local revision and derived language and restores only the profile; site policy, permission hints and UI preferences are preserved. All new full exports record the actual exporting oboro version.

## Preview and save

Preview performs no settings writes or permission requests. The worker retains the validated candidate with a snapshot of current saved settings. A preview expires after ten minutes, after worker restart, after successful import, or when its token is consumed. Up to eight previews can be retained. A changed saved snapshot causes a conflict instead of overwriting another editor's work.

The user reviews changed fields and explicitly confirms replacement. Unsaved profile or selection-mode edits block replacement and remain in their forms. The export button remains available for saved values. All-sites mode explicitly warns that it uses this Chrome's current grants, including addresses outside the file; importing does not revoke existing access.

Before writing, the activation coordinator must confirm that future overrides are disabled and registrations cleared. A durable journal stores the previous coherent settings, then the new settings are written and read back. The journal is cleared and verified before success is acknowledged. A failed/partial/unconfirmed write attempts rollback. Pending recovery is retried before worker commands and at startup; incomplete recovery blocks subsequent configuration mutations and is never reported as success. Corrupt journals are preserved rather than guessed at.

UI language/theme are delivered through a durable worker record and applied to the existing localStorage preferences by an extension page. A per-origin acknowledgment prevents replaying an old import over subsequent manual choices. If the page closes, the next popup/options page finishes the UI restoration. A UI storage/transport failure is reported separately from a verified profile/policy import; no reload is used to discard drafts.

Successful import leaves the master switch off. Existing pages may retain old wrappers until reload. Permission hints and selected-site rules populate a separate **Grant missing access** button; Chrome permission requests occur directly in that button's user gesture. Applying requires a separate action and the existing exact-Chrome compatibility gate. Diagnostic evidence is not imported from configuration JSON.

## Verification

`tests/config.test.mjs` covers the frozen v1 contract, legacy normalization, version discrimination, UTF-8 limits, unknown fields, export privacy, revision monotonicity, conflicts and recovery under failed/partial/ambiguous storage writes. `tests/config-ui.test.mjs` exercises the actual UI and worker bundles with synthetic Chrome APIs, downloads, previews, UI restoration, active cleanup, access gestures and the mandatory compatibility gate. These checks do not establish native Chrome browser acceptance.
