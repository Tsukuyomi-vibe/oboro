# oboro

**English** | [Русский](README.ru.md)

A Chrome Manifest V3 extension that applies a regional profile to sites you select. Configure browser languages, geolocation, formatting locale, time zone and keyboard layout map in one place.

Version: **0.3.1**. The interface defaults to English; Russian remains available. Both language and theme choices are saved locally.

**Native Chrome Stable/Beta acceptance is still incomplete.** Activation requires a complete, successful Oboro Check report for your exact Chrome version. Building the extension or passing automated tests does not satisfy this requirement.

## Features

| Setting | Effect |
| --- | --- |
| Preferred languages | `navigator.language`, `navigator.languages` and the `Accept-Language` request header |
| Geolocation | Fixed latitude, longitude, accuracy, altitude, altitude accuracy, speed and heading |
| Formatting locale | Default locale for supported `Intl` constructors and locale-sensitive number, date and string methods |
| Time zone | Default zone for Date/Intl and supported existing Temporal.Now methods; local date construction, parsing, getters and setters |
| Keyboard map | Native map, US QWERTY, DE QWERTZ or RU JCUKEN through the available `Keyboard.getLayoutMap()` API |
| Site scope | Explicit site selection or all sites with granted access, with exclusions and optional subdomains |

Explicit locale/time-zone arguments and absolute timestamps retain their behavior. Typing, keyboard events, shortcuts and IME retain their system behavior. The [full data reference](info.md) lists individual fields, APIs and limitations in Russian.

## Build and install

Requirements:

- Node.js 22.22.2+ within 22.x, 24.15.0+ within 24.x, or 26+, with npm.
- Chrome 120+ as the manifest minimum. Actual API availability and early execution require compatibility checks.

From the project root:

```powershell
npm ci
npm run check
```

This checks types, builds both extensions and runs the automated tests.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the generated **dist** folder.
3. Open oboro from the extensions menu, then select **Open settings**.
4. Allow user scripts in the extension details if Chrome shows that setting. Reload the extension after changing it.
5. Complete the compatibility check before applying a profile.

For later updates, rebuild the project, click the reload button on the existing extension card and reopen its settings. Keep the installation folder unchanged to retain the same unpacked extension identity. Reload previously processed pages after updating.

## Use a profile

1. Fill in the regional profile or click **Use Berlin example**, then **Save profile**. The example only fills the form. Empty optional geolocation fields mean unknown; zero remains a value.
2. Choose **Selected sites only** or **All sites with granted access**, then save the mode. Add hosts, schemes, subdomain rules and exclusions. An empty selection enables no sites; exclusions take priority.
3. Complete [Oboro Check](docs/probe-package-readme.en.md). Import the full JSON report into the main extension after removing the diagnostic probe and disabling the diagnostic extension.
4. Click **Apply and reload selected pages**. Selected top-level pages reload; an existing cross-site iframe may require reloading its parent page manually.
5. Review status and document coverage. Missing permissions, unsupported APIs or incomplete checks are reported explicitly.

Selecting a site and granting Chrome access are separate actions. In the default selected-sites mode, granting access alone does not select a site. All-sites mode also selects future access grants, except exclusions.

Unsaved edits block applying from that settings page. Saving a changed profile requires applying it again. Conflicts or unconfirmed writes keep your draft and require loading the saved state again.

To restore native APIs, turn off the master switch and reload previously processed pages. The switch removes future registrations and network rules; existing documents keep their wrappers until reload.

## Interface language and theme

Use **Language → English / Русский** at the bottom of the popup or the top of settings and diagnostics. Changes apply immediately and persist across reopening. Open pages of the same extension synchronize the choice without discarding form edits.

The interface language is independent of the languages and locale in the regional profile. Main and diagnostic extensions have separate local preferences.

Choose **System**, **Light** or **Dark** for the theme. An explicit choice takes priority over the operating-system theme and is saved locally.

## Compatibility and limits

- The extension does not change your IP address, network route or website storage.
- Site Dedicated, Shared and Service Workers have no baseline API overrides.
- Opaque or unverified about:blank/srcdoc/blob contexts are skipped.
- BFCache restores an existing document; it does not apply a new profile revision. A reload may be needed to resume geolocation watches or remove old wrappers.
- Ambiguous date strings such as `01/02/2024` return `NaN` / Invalid Date. Supported ISO forms and explicit offsets follow the documented parsing policy.
- Missing Temporal, structuredClone and keyboard APIs are not added. Unsupported time behavior is rolled back; a failed self-check does not count as full time coverage.
- Document diagnostics cover observed contexts. They do not prove the absence of every leak or make the extension undetectable.

API overrides follow the document's scope. Request headers follow the destination's scope; Chrome may also require access to the initiator.

## Permissions and privacy

| Permission | Purpose |
| --- | --- |
| `storage` | Local profile, site policy, activation and diagnostics |
| `activeTab` | Identify the current site when opening the popup |
| `userScripts` | Early MAIN-world installation |
| `scripting` | Isolated diagnostic bridge |
| `declarativeNetRequestWithHostAccess` | Set Accept-Language where access is granted |
| `webNavigation` | Observe documents, frames and navigation |
| Optional HTTP/HTTPS host access | Request a specific site's access after a user action |

The main extension has no analytics or external data-collection endpoint. Profiles and preferences are stored locally. Page-facing diagnostics do not publish your site permission list, profile name, shared activation identifier or internal revision numbers. See [privacy details](docs/privacy.md) in Russian.

Oboro Check reports can contain real browser language, time zone, version and request times. Keep those exports private. The package process keeps only an anonymous verification summary and does not save raw console logs.

## Development

| Command | Purpose |
| --- | --- |
| `npm run build` | Typecheck and build the main extension into dist |
| `npm run build:probe` | Typecheck and build the diagnostic extension into dist-probe |
| `npm test` | Run VM, DOM, backend and loopback HTTP tests |
| `npm run check` | Typecheck, build both extensions, check their assets/permissions and run tests |
| `npm run fixture` | Start the local compatibility fixture; stop with Ctrl+C |
| `npm run package:core` | Run all checks, audit packages and create ZIPs with SHA-256 checksums |

Generated packages are placed in `artifacts/release/`. They are unsigned and unpublished. Runtime dependency versions are pinned in package-lock.json; bundled licenses are included in `dist/third-party/`.

The [.gitignore](.gitignore) excludes dependencies, builds, archives, logs, browser profiles, diagnostic exports and local credentials. The Berlin profile in examples is synthetic. Ignore rules do not remove files that are already tracked; inspect staged changes before publishing.

## Documentation

- [Russian README](README.ru.md)
- [Main package installation guide](docs/core-package-readme.en.md)
- [Diagnostic package guide](docs/probe-package-readme.en.md)
- [Full data reference](info.md), [privacy](docs/privacy.md), [release notes](docs/releases/0.3.1.md) — Russian
- [Native acceptance matrix](docs/core-acceptance-matrix.json) and [implementation status](docs/i21-i23-validation-status.json)
