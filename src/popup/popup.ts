import { mountOptionsButton } from "../ui/settings";
import { mountActivationControls } from "../ui/activation";
import { mountCurrentSiteAction } from "../ui/sites";
import { mountUiPreferences } from "../ui/config-preferences";

mountActivationControls();
mountOptionsButton();
mountCurrentSiteAction();
void mountUiPreferences();
