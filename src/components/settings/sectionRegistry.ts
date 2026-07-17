import { useSyncExternalStore, type ComponentType } from 'react';

/**
 * Settings-section seam. Pro registers extra Settings sections during activation; core
 * renders whatever is registered. Registration is REACTIVE (same pattern as slotRegistry):
 * a section registered AFTER the Settings screen mounted — e.g. Pro unlocked at runtime
 * via a license key, which re-runs loadProFeatures — makes the screen re-render and show
 * the section live, with no app restart. (Before this, the screen read getSettingsSections()
 * once at render, so an activated Pro user still saw the section missing until relaunch.)
 */
const sections: ComponentType<any>[] = [];
const listeners = new Set<() => void>();

// useSyncExternalStore requires a STABLE snapshot reference between changes (returning a
// fresh array each call would loop). Rebuild it only when the set actually changes.
let sectionsSnapshot: ComponentType<any>[] = [];

function emitChange(): void {
  sectionsSnapshot = [...sections];
  for (const l of listeners) l();
}

export function registerSettingsSection(component: ComponentType<any>): void {
  if (sections.includes(component)) return; // no-op re-register (dev Fast Refresh)
  sections.push(component);
  emitChange();
}

/** Remove a feature-owned section and update every mounted Settings screen. */
export function unregisterSettingsSection(component: ComponentType<any>): void {
  const index = sections.indexOf(component);
  if (index === -1) return;
  sections.splice(index, 1);
  emitChange();
}

export function getSettingsSections(): ComponentType<any>[] {
  return sections;
}

/** Reactive read — re-renders the consumer when a section is (de)registered. */
export function useSettingsSections(): ComponentType<any>[] {
  return useSyncExternalStore(
    onStoreChange => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => sectionsSnapshot,
  );
}

export function _clearSectionsForTesting(): void {
  sections.length = 0;
  emitChange();
}
