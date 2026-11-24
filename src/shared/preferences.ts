export interface ExtensionPreferences {
  masterEnabled: boolean;
}

export const PREFERENCES_KEY = "extensionPreferences";

export function parsePreferences(value: unknown): ExtensionPreferences {
  return {
    masterEnabled:
      typeof value === "object" &&
      value !== null &&
      "masterEnabled" in value &&
      value.masterEnabled === true
  };
}

export async function readPreferences(): Promise<ExtensionPreferences> {
  const stored = await chrome.storage.local.get(PREFERENCES_KEY);
  return parsePreferences(stored[PREFERENCES_KEY]);
}

export async function setMasterEnabled(masterEnabled: boolean): Promise<void> {
  await chrome.storage.local.set({
    [PREFERENCES_KEY]: { masterEnabled } satisfies ExtensionPreferences
  });
}

export async function initializePreferences(): Promise<void> {
  const stored = await chrome.storage.local.get(PREFERENCES_KEY);
  if (stored[PREFERENCES_KEY] === undefined) {
    await setMasterEnabled(false);
  }
}
