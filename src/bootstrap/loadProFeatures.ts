import { registerToolExtension } from '../services/tools/extensions';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';
import { registerSlot } from './slotRegistry';
import { registerHook } from './hookRegistry';
import { readProFromKeychain } from '../services/proLicenseService';

export async function loadProFeatures(isPro?: boolean): Promise<void> {
  let pro: any;
  try {
    pro = require('@offgrid/pro');
  } catch {
    return; // free / contributor build: package not installed
  }
  if (!pro) {
    return; // proStub.js returns null — free build via metro extraNodeModules
  }

  // DEV ONLY: unlock pro features locally (audio mode, MCP) without a purchase so
  // they can be tested on simulators/dev builds. __DEV__ is false in release
  // builds, so this can never unlock pro in production. The Settings "Turn off
  // Pro (DEV)" toggle sets devProDisabled to exercise the free → Pro flow in a
  // debug build.
  const { useAppStore } = require('../stores/appStore');
  const DEV_UNLOCK_PRO = __DEV__ && !useAppStore.getState().devProDisabled;

  // The boot path already read the entitlement in checkProStatus(); reuse it to
  // avoid a second keychain round-trip. Fall back to a read for standalone callers.
  const active = (isPro ?? (await readProFromKeychain())) || DEV_UNLOCK_PRO;
  if (!active) {
    return; // paid features stay dormant until the user purchases
  }

  pro.activate({ registerToolExtension, registerScreen, registerSettingsSection, registerSlot, registerHook });

  // Inject native OAuth adapters so MCP servers can use OAuth (browser sign-in +
  // Keychain token storage + PKCE crypto). Required before any OAuth connect;
  // until this runs the OAuth option stays hidden in the UI. Loaded lazily so
  // free builds never pull in the native crypto/browser libs.
  if (typeof pro.configureOAuthAdapters === 'function') {
    try {
      const { mcpOAuthNativeAdapters } = require('../services/mcpOAuthNativeAdapters');
      pro.configureOAuthAdapters(mcpOAuthNativeAdapters);
    } catch (err) {
      // Non-fatal: header/none MCP auth still works; OAuth simply stays unavailable.
      console.warn('[pro] MCP OAuth adapters not configured:', err);
    }
  }
}
