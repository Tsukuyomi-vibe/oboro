import example from "../../examples/berlin.regional-profile.json";
import type { ProfileDraft, RegionalProfile } from "./types";
import { parseRegionalProfile, profileToDraft } from "./validation";

export function getExampleProfile(): RegionalProfile {
  return parseRegionalProfile(example);
}

export function getExampleProfileDraft(): ProfileDraft {
  return profileToDraft(getExampleProfile());
}
