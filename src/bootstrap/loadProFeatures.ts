import logger from '../utils/logger';
import { registerToolExtension } from '../services/tools/extensions';
import { registerScreen } from '../navigation/screenRegistry';
import { registerSettingsSection } from '../components/settings/sectionRegistry';
import { registerSlot } from './slotRegistry';
import { registerHook } from './hookRegistry';
import {
  getProLicenseInfo,
  registerProEntitlementProvider,
  type ProLicenseInfo,
} from '../services/proLicenseService';
import { proEntitlementLifecycle } from '../services/proEntitlementLifecycle';

/**
 * Bring the optional pro bundle (@offgrid/pro) into the app.
 *
 * Nothing here is gated. Off Grid AI is free: if the bundle is in this build, it activates - voice mode,
 * personas, MCP tools, Personal Mesh sync, the lot - for everyone, with no licence, key, or purchase.
 * Registration used to depend on a verified credential and the licensed-device roster's admission for
 * this device, which meant a build could be fully capable and still refuse to switch on. It cannot any
 * more. What follows a load is only a report of what was loaded, so the Settings surface can say whether
 * this build carries the bundle at all.
 *
 * The bundle is optional, not conditional on payment: an open-core build (the default in this repo, where
 * `pro/` is a submodule that is not checked out) resolves `@offgrid/pro` to the null stub, and this function
 * returns false. Every Pro entry point in core handles that - it reads the registries, so an absent bundle
 * shows a feature-less build rather than a route to a purchase, of which there are none left.
 *
 * The licence lifecycle below is deliberately kept: `revalidateProEntitlement` is how the provider keeps its
 * cached credential and the licensed-device roster current, and mesh pairing between your own devices still
 * needs a device identity. It no longer decides anything: an unreachable provider, an expired credential, or
 * a device the roster calls inactive changes what the app displays, never what the app lets you do.
 */
export async function loadProFeatures(): Promise<boolean> {
  let pro: any;
  try {
    logger.log('[BOOT-PRO] require(@offgrid/pro)');
    pro = require('@offgrid/pro');
  } catch {
    return false; // free / contributor build: package not installed
  }
  logger.log('[BOOT-PRO] require returned');
  if (!pro) {
    return false; // proStub.js returns null — build without the bundle
  }
  if (typeof pro.configureProEntitlementProvider === 'function') {
    pro.configureProEntitlementProvider(registerProEntitlementProvider);
  }
  logger.log('[BOOT-PRO] proEntitlementLifecycle.start');
  await proEntitlementLifecycle.start();

  logger.log('[BOOT-PRO] getProLicenseInfo');
  const licenseInfo: ProLicenseInfo = await getProLicenseInfo();
  // A read-only projection of what this install holds, so Settings and the Pro features screen can be
  // honest about it. Nothing branches on these values. Required lazily, as before, so the bootstrap
  // keeps no static edge into the store.
  const { useAppStore } = require('../stores/appStore');
  useAppStore.getState().setHasRegisteredPro(licenseInfo.isPro);
  useAppStore
    .getState()
    .setHasSavedProCredential(licenseInfo.credentialSaved ?? licenseInfo.isPro);
  useAppStore.getState().setProActive(licenseInfo.isPro);
  useAppStore
    .getState()
    .setHasExpiredProCredential(licenseInfo.expired === true);

  // The restricted Sync bootstrap is registered before activation so a build whose bundle is missing can
  // still participate in the mesh it may later be handed a role in.
  if (typeof pro.activateSyncBootstrap === 'function') {
    pro.activateSyncBootstrap({
      registerScreen,
      registerSlot,
      registerHook,
      onEntitlementImported: async () => {
        useAppStore.getState().setHasRegisteredPro(true);
        await loadProFeatures();
      },
    });
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
  // builds without the bundle never pull in the native crypto/browser libs.
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
