import logger from '../utils/logger';
import { registerToolExtension } from '../services/tools/extensions';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';
import { registerSlot } from './slotRegistry';
import { registerHook } from './hookRegistry';
import {
  getProLicenseInfo,
  registerProEntitlementProvider,
} from '../services/proLicenseService';
import { proEntitlementLifecycle } from '../services/proEntitlementLifecycle';
import { selectHasProAccess } from '../stores/proAccessSlice';
import { registerMobileApplicationPorts } from '../services/composition/application';

export async function loadProFeatures(isPro?: boolean): Promise<boolean> {
  let pro: any;
  try {
    logger.log('[BOOT-PRO] require(@offgrid/pro)');
    pro = require('@offgrid/pro');
  } catch {
    return false; // free / contributor build: package not installed
  }
  logger.log('[BOOT-PRO] require returned');
  if (!pro) {
    return false; // proStub.js returns null — free build via metro extraNodeModules
  }
  if (typeof pro.prepareMobileApplicationPorts === 'function') {
    await pro.prepareMobileApplicationPorts();
  }
  if (typeof pro.createMobileApplicationPorts === 'function') {
    registerMobileApplicationPorts(pro.createMobileApplicationPorts);
  }
  if (typeof pro.configureProEntitlementProvider === 'function') {
    pro.configureProEntitlementProvider(
      registerProEntitlementProvider,
      async () => {
        await loadProFeatures(true);
      },
    );
  }
  logger.log('[BOOT-PRO] proEntitlementLifecycle.start');
  await proEntitlementLifecycle.start();

  // DEV ONLY: unlock pro features locally (audio mode, MCP) without a purchase so
  // they can be tested on simulators/dev builds. __DEV__ is false in release
  // builds, so this can never unlock pro in production. The Settings "Turn off
  // Pro (DEV)" toggle sets devProDisabled to exercise the free → Pro flow in a
  // debug build.
  const { useAppStore } = require('../stores/appStore');
  const DEV_UNLOCK_PRO = __DEV__ && !useAppStore.getState().devProDisabled;

  logger.log('[BOOT-PRO] getProLicenseInfo');
  const licenseInfo = await getProLicenseInfo();
  const credentialActive = isPro ?? licenseInfo.isPro;
  const credentialSaved =
    isPro === true || (licenseInfo.credentialSaved ?? licenseInfo.isPro);
  const expired = licenseInfo.expired === true;
  const active = (credentialActive || DEV_UNLOCK_PRO) && !expired;
  // Single source of truth for "Pro is unlocked" — every upsell gate reads this, so a
  // keychain- or dev-unlocked Pro user never sees the upgrade prompt.
  useAppStore.getState().setHasRegisteredPro(credentialActive);
  useAppStore.getState().setHasSavedProCredential(credentialSaved);
  useAppStore.getState().setProActive(active);
  useAppStore.getState().setHasExpiredProCredential(expired);
  // A credential is not access. If the roster last told us this device is deactivated, the paid bundle
  // must not load at all - loading it and then hiding the entry points leaves every Pro service running.
  const admitted = selectHasProAccess(useAppStore.getState()) || DEV_UNLOCK_PRO;
  if (typeof pro.activateSyncBootstrap === 'function') {
    pro.activateSyncBootstrap({
      registerScreen,
      registerSlot,
      registerHook,
      onEntitlementImported: async () => {
        useAppStore.getState().setHasRegisteredPro(true);
        await loadProFeatures(true);
      },
    });
  }
  if (!active || !admitted) {
    // Sync stays reachable on purpose even here: claiming a seat again, by key or from a paired device,
    // goes through the mesh runtime, so tearing it down would strand a deactivated device with no way back.
    return false; // every other paid feature stays dormant
  }

  logger.log('[BOOT-PRO] pro.activate');
  pro.activate({
    registerToolExtension,
    registerScreen,
    registerSettingsSection,
    registerSlot,
    registerHook,
  });

  // Inject native OAuth adapters so MCP servers can use OAuth (browser sign-in +
  // Keychain token storage + PKCE crypto). Required before any OAuth connect;
  // until this runs the OAuth option stays hidden in the UI. Loaded lazily so
  // free builds never pull in the native crypto/browser libs.
  if (typeof pro.configureOAuthAdapters === 'function') {
    try {
      const {
        mcpOAuthNativeAdapters,
      } = require('../services/mcpOAuthNativeAdapters');
      pro.configureOAuthAdapters(mcpOAuthNativeAdapters);
    } catch (err) {
      // Non-fatal: header/none MCP auth still works; OAuth simply stays unavailable.
      console.warn('[pro] MCP OAuth adapters not configured:', err);
    }
  }
  logger.log('[BOOT-PRO] done');
  return true;
}
