import { registerToolExtension } from '../services/tools/extensions';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';
import { readProFromKeychain } from '../services/proLicenseService';

export async function loadProFeatures(): Promise<void> {
  let pro: any;
  try {
    pro = require('@offgrid/pro');
  } catch {
    return; // free / contributor build: package not installed
  }
  if (!pro) {
    return; // proStub.js returns null — free build via metro extraNodeModules
  }

  const isPro = await readProFromKeychain();
  if (!isPro) {
    return; // paid features stay dormant until the user purchases
  }

  pro.activate({ registerToolExtension, registerScreen, registerSettingsSection });
}
