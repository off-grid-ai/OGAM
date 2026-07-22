import { unregisterToolExtension } from '../services/tools/extensions';
import { unregisterScreen } from '../navigation/screenRegistry';
import { unregisterSettingsSection } from '../components/settings/sectionRegistry';
import { unregisterSlot } from './slotRegistry';
import { unregisterHook } from './hookRegistry';

/** Reactively remove paid behavior after an entitlement is revoked. */
export function unloadProFeatures(): void {
  const { useAppStore } = require('../stores/appStore');
  useAppStore.getState().setProActive(false);

  let pro: any;
  try {
    pro = require('@offgrid/pro');
  } catch {
    return;
  }
  if (typeof pro?.deactivate !== 'function') return;
  pro.deactivate({
    unregisterToolExtension,
    unregisterScreen,
    unregisterSettingsSection,
    unregisterSlot,
    unregisterHook,
  });
}
