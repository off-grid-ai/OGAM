import { useSyncExternalStore, type ComponentType } from 'react';

export interface RegisteredScreen {
  name: string;
  component: ComponentType<any>;
}

const screens: RegisteredScreen[] = [];
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const l of listeners) l();
}

export function registerScreen(screen: RegisteredScreen): void {
  // Dedupe by name. loadProFeatures can run more than once (dev Fast Refresh, or
  // a future re-activate-on-purchase without restart); duplicate route names
  // crash the navigator (the duplicate-screen render bug). First wins. Mirrors
  // the guard in sectionRegistry.
  if (screens.some(s => s.name === screen.name)) return;
  screens.push(screen);
  emitChange();
}

export function getRegisteredScreens(): RegisteredScreen[] {
  return screens;
}

/**
 * Reactive read of whether a screen with the given name is registered.
 * Subscribes via useSyncExternalStore so a screen registered AFTER a consumer
 * mounted (e.g. Pro activated at runtime, which re-runs loadProFeatures) makes
 * the consumer re-render. Mirrors useSlot in slotRegistry.
 */
export function useHasRegisteredScreen(name: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => screens.some(s => s.name === name),
  );
}

export function _clearScreensForTesting(): void {
  screens.length = 0;
  emitChange();
}
