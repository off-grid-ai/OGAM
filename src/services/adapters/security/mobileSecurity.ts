// The one passphrase owner on the phone. Screens send intent here and render what comes back;
// they never write the lock flag or the stored passphrase themselves.
import { useSyncExternalStore } from 'react';
import { createSecurityFacade, type SecuritySnapshot } from '@offgrid/application';
import { mobileSecurityCredentialPort } from './mobileSecurityCredentialPort';
import { mobileSecurityStatePort } from './mobileSecurityStatePort';

export const mobileSecurity = createSecurityFacade({
  credentials: mobileSecurityCredentialPort,
  state: mobileSecurityStatePort,
});

// The owner builds a fresh snapshot on every read, so the value a screen reads is kept here and
// replaced only when the owner publishes. Handing React a new object on each read would make it
// re-render forever. This listener is registered first, so the held value is already the new one
// by the time a screen is told to read again.
let held: SecuritySnapshot = mobileSecurity.snapshot();
mobileSecurity.subscribe(next => {
  held = next;
});

/** Every screen reads the same snapshot, so the lock and the stored passphrase cannot disagree. */
export function useSecuritySnapshot(): SecuritySnapshot {
  return useSyncExternalStore(
    listener => mobileSecurity.subscribe(() => listener()),
    () => held,
  );
}
