import { useSyncExternalStore, type ComponentType } from 'react';

export interface RegisteredScreen {
  name: string;
  component: ComponentType<any>;
}

// Immutable list: registerScreen replaces the array with a new reference, so
// useSyncExternalStore detects a change by identity — no version counter needed.
// Mirrors slotRegistry, where useSlot's snapshot is a value that changes.
let screens: RegisteredScreen[] = [];
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const l of listeners) l();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function registerScreen(screen: RegisteredScreen): void {
  // Dedupe by name. loadProFeatures can run more than once (dev Fast Refresh, or
  // a future re-activate-on-purchase without restart); duplicate route names
  // crash the navigator (the duplicate-screen render bug). First wins. Mirrors
  // the guard in sectionRegistry.
  if (screens.some(s => s.name === screen.name)) return;
  screens = [...screens, screen];
  emitChange();
}

/** Remove a dynamically-owned route when its feature entitlement is revoked. */
export function unregisterScreen(name: string): void {
  const next = screens.filter(screen => screen.name !== name);
  if (next.length === screens.length) return;
  screens = next;
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
  return useSyncExternalStore(subscribe, () =>
    screens.some(s => s.name === name),
  );
}

/**
 * Reactive read of the full registered-screen list. The navigator subscribes via
 * useSyncExternalStore so a screen registered AFTER it mounted — Pro activated at
 * runtime, which re-runs loadProFeatures — re-renders the navigator and mounts the
 * route live, with no app restart. This is what makes navigate('McpServers') work
 * the instant a license activates.
 */
export function useRegisteredScreens(): RegisteredScreen[] {
  return useSyncExternalStore(subscribe, () => screens);
}

export function _clearScreensForTesting(): void {
  screens = [];
  emitChange();
}
