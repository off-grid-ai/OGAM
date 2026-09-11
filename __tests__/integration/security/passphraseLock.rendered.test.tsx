/**
 * UI integration — the app lock, end to end, as the user experiences it.
 *
 * Real PassphraseSetupScreen + real LockScreen + real authService (real hashing) + real
 * useAuthStore lockout state machine. The ONLY fake is `react-native-keychain`: an in-memory
 * credential entry standing in for the OS keystore. That is the true device boundary —
 * authService touches nothing else (see src/services/authService.ts: Keychain + logger only).
 *
 * Every precondition is reached by gesture: a passphrase exists because it was typed into the
 * real setup screen and saved by the real service. Nothing calls store.setState.
 */
import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { PassphraseSetupScreen } from '../../../src/screens/PassphraseSetupScreen';
import { LockScreen } from '../../../src/screens/LockScreen';
import { useAuthStore } from '../../../src/stores/authStore';

/**
 * The keystore, faked at the native line. It holds one credential entry, exactly as the
 * platform keychain does, and hands back whatever was actually written to it.
 */
jest.mock('react-native-keychain', () => {
  let entry: { username: string; password: string } | false = false;
  // Device-boundary failure modes. A real keystore can be locked, evicted or unavailable;
  // these switches let the test put the REAL authService through those paths.
  let setFails = false;
  let setRefuses = false;
  let getFails = false;
  let gate: { promise: Promise<void>; release: () => void } | null = null;
  const passGate = async () => {
    if (gate) {
      await gate.promise;
    }
  };
  return {
    setGenericPassword: async (username: string, password: string) => {
      await passGate();
      if (setFails) {
        throw new Error('keystore unavailable');
      }
      // A real keystore can REFUSE a write without throwing — it resolves `false` and stores
      // nothing (policy denial, locked device, protection class unavailable).
      if (setRefuses) {
        return false;
      }
      entry = { username, password };
      return true;
    },
    getGenericPassword: async () => {
      await passGate();
      if (getFails) {
        throw new Error('keystore unavailable');
      }
      return entry;
    },
    resetGenericPassword: async () => {
      entry = false;
      return true;
    },
    ACCESSIBLE: { WHEN_UNLOCKED: 'WhenUnlocked', AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    __peek: () => entry,
    __failWrites: () => {
      setFails = true;
    },
    /** The keystore accepts the call but refuses to store: resolves `false`, never throws. */
    __refuseWrites: () => {
      setRefuses = true;
    },
    __failReads: () => {
      getFails = true;
    },
    /** Hold every keystore call open until the returned release() is called. */
    __stall: () => {
      let release = () => {};
      const promise = new Promise<void>(resolve => {
        release = resolve;
      });
      gate = { promise, release };
      return () => {
        gate = null;
        release();
      };
    },
    __reset: () => {
      entry = false;
      setFails = false;
      setRefuses = false;
      getFails = false;
      gate = null;
    },
  };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Keychain = require('react-native-keychain') as {
  __peek: () => { username: string; password: string } | false;
  __failWrites: () => void;
  __refuseWrites: () => void;
  __failReads: () => void;
  __stall: () => () => void;
  __reset: () => void;
};

const SETUP_NEW = 'Enter passphrase (min 6 characters)';
const SETUP_CONFIRM = 'Re-enter passphrase';
const SETUP_CURRENT = 'Enter current passphrase';
const LOCK_INPUT = 'Enter passphrase';

/** Set the app passphrase the only way a user can: through the real setup screen. */
async function enableLockThroughSetupScreen(passphrase: string): Promise<void> {
  const onComplete = jest.fn();
  const view = render(
    <PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />
  );
  fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), passphrase);
  fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), passphrase);
  fireEvent.press(view.getByText('Enable Lock'));
  await waitFor(() => expect(view.getByText('Passphrase lock enabled')).toBeTruthy());
  expect(onComplete).toHaveBeenCalled();
  view.unmount();
}

describe('App lock — setting a passphrase', () => {
  beforeEach(() => {
    Keychain.__reset();
    // Real actions only, to isolate the run — never a direct state write.
    useAuthStore.getState().resetFailedAttempts();
    useAuthStore.getState().setEnabled(false);
  });

  it('refuses a passphrase shorter than six characters', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'short');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'short');
    fireEvent.press(screen.getByText('Enable Lock'));

    await waitFor(() =>
      expect(screen.getByText('Passphrase must be at least 6 characters')).toBeTruthy()
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
  });

  it('refuses a confirmation that does not match', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'correct hose');
    fireEvent.press(screen.getByText('Enable Lock'));

    await waitFor(() => expect(screen.getByText('Passphrases do not match')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
  });

  it('refuses a passphrase longer than fifty characters', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);
    const tooLong = 'a'.repeat(51);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), tooLong);
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), tooLong);
    fireEvent.press(screen.getByText('Enable Lock'));

    await waitFor(() =>
      expect(screen.getByText('Passphrase must be 50 characters or less')).toBeTruthy()
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
  });

  it('lets the user dismiss the validation alert and try again', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'short');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'short');
    fireEvent.press(screen.getByText('Enable Lock'));
    await waitFor(() =>
      expect(screen.getByText('Passphrase must be at least 6 characters')).toBeTruthy()
    );

    fireEvent.press(screen.getByText('OK'));
    await waitFor(() =>
      expect(screen.queryByText('Passphrase must be at least 6 characters')).toBeNull()
    );

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'long enough');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'long enough');
    fireEvent.press(screen.getByText('Enable Lock'));
    await waitFor(() => expect(screen.getByText('Passphrase lock enabled')).toBeTruthy());
    expect(onComplete).toHaveBeenCalled();
  });

  it('enables the lock once a valid passphrase is confirmed', async () => {
    await enableLockThroughSetupScreen('correct horse');
    expect(useAuthStore.getState().isEnabled).toBe(true);
  });

  it('never writes the plaintext passphrase to the keychain', async () => {
    const secret = 'correct horse battery';
    await enableLockThroughSetupScreen(secret);

    const stored = Keychain.__peek();
    expect(stored).not.toBe(false);
    const entry = stored as { username: string; password: string };
    expect(entry.username).toBe('passphrase_hash');
    expect(entry.password).not.toBe(secret);
    expect(entry.password).not.toContain(secret);
    expect(entry.password).not.toContain('correct');
    expect(JSON.stringify(entry)).not.toContain(secret);
  });

  it('tells the user the save failed, and leaves the lock off, when the keystore is unavailable', async () => {
    Keychain.__failWrites();
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'correct horse');
    fireEvent.press(screen.getByText('Enable Lock'));

    await waitFor(() => expect(screen.getByText('Failed to set passphrase')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isEnabled).toBe(false);
    expect(Keychain.__peek()).toBe(false);

    // The screen comes back: the button is live again, not stuck on 'Saving...'.
    fireEvent.press(screen.getByText('OK'));
    await waitFor(() => expect(screen.getByText('Enable Lock')).toBeTruthy());
  });

  it("shows 'Saving...' while the keystore write is still in flight", async () => {
    const release = Keychain.__stall();
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'correct horse');
    fireEvent.press(screen.getByText('Enable Lock'));

    await waitFor(() => expect(screen.getByText('Saving...')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(screen.getByText('Passphrase lock enabled')).toBeTruthy());
    expect(screen.queryByText('Saving...')).toBeNull();
    expect(onComplete).toHaveBeenCalled();
  });

  it('tells the user the save failed, and leaves the lock off, when the keystore REFUSES the write', async () => {
    // The keystore does not throw here: it resolves `false` and stores nothing. If that value is
    // discarded the user is told the lock is on while no hash exists — and on the next launch
    // every passphrase is wrong and they are locked out of their own app with no recovery.
    Keychain.__refuseWrites();
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'correct horse');
    fireEvent.press(screen.getByText('Enable Lock'));

    await waitFor(() => expect(screen.getByText('Failed to set passphrase')).toBeTruthy());
    expect(screen.queryByText('Passphrase lock enabled')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isEnabled).toBe(false);
    expect(Keychain.__peek()).toBe(false);

    // The screen comes back live, not stuck on 'Saving...'.
    fireEvent.press(screen.getByText('OK'));
    await waitFor(() => expect(screen.getByText('Enable Lock')).toBeTruthy());
  });

  it('refuses the CHANGE, and keeps the old passphrase working, when the keystore refuses the write', async () => {
    await enableLockThroughSetupScreen('correct horse');
    const storedBefore = Keychain.__peek();
    Keychain.__refuseWrites();

    const onComplete = jest.fn();
    const change = render(
      <PassphraseSetupScreen isChanging onComplete={onComplete} onCancel={jest.fn()} />
    );
    fireEvent.changeText(change.getByPlaceholderText(SETUP_CURRENT), 'correct horse');
    fireEvent.changeText(change.getByPlaceholderText(SETUP_NEW), 'brand new one');
    fireEvent.changeText(change.getByPlaceholderText(SETUP_CONFIRM), 'brand new one');
    fireEvent.press(change.getAllByText('Change Passphrase').at(-1)!);

    await waitFor(() =>
      expect(change.getByText('Current passphrase is incorrect')).toBeTruthy()
    );
    expect(change.queryByText('Passphrase changed successfully')).toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toEqual(storedBefore);
    change.unmount();

    // The old passphrase still opens the app — the user was never silently cut off.
    const onUnlock = jest.fn();
    const lock = render(<LockScreen onUnlock={onUnlock} />);
    fireEvent.changeText(lock.getByPlaceholderText(LOCK_INPUT), 'correct horse');
    fireEvent.press(lock.getByText('Unlock'));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  }, 20000);

  it('backs out on Cancel without setting anything', async () => {
    const onComplete = jest.fn();
    const onCancel = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={onCancel} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'correct horse');
    fireEvent.press(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
    expect(useAuthStore.getState().isEnabled).toBe(false);
  });
});

describe('App lock — unlocking', () => {
  beforeEach(() => {
    Keychain.__reset();
    useAuthStore.getState().resetFailedAttempts();
    useAuthStore.getState().setEnabled(false);
  });

  it('shows the lock screen and unlocks on the correct passphrase', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);
    expect(screen.getByText('App Locked')).toBeTruthy();

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'correct horse');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Incorrect Passphrase')).toBeNull();
  });

  it('offers no way to unlock until something is typed', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    expect(screen.getByText('Enter your passphrase to unlock')).toBeTruthy();
    expect(screen.getByText('Your data is protected and stored locally')).toBeTruthy();
    expect(screen.queryByText('4 attempts remaining')).toBeNull();

    fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(onUnlock).not.toHaveBeenCalled());
    expect(screen.queryByText('Incorrect Passphrase')).toBeNull();
  });

  it('clears the field after a failed attempt, so the next try starts empty', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    const input = screen.getByPlaceholderText(LOCK_INPUT);
    fireEvent.changeText(input, 'wrong horse');
    fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.getByText('Incorrect Passphrase')).toBeTruthy());
    fireEvent.press(screen.getByText('OK'));

    expect(screen.getByPlaceholderText(LOCK_INPUT).props.value).toBe('');
  });

  it('rejects a wrong passphrase and counts the attempt down on screen', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong horse');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('Incorrect Passphrase')).toBeTruthy());
    expect(screen.getByText('4 attempts remaining before lockout.')).toBeTruthy();
    expect(onUnlock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('4 attempts remaining')).toBeTruthy());
  });

  it('locks the user out after five wrong attempts, and then takes no passphrase at all', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), `wrong ${attempt}`);
      fireEvent.press(screen.getByText('Unlock'));
      if (attempt < 5) {
        // eslint-disable-next-line no-await-in-loop
        await waitFor(() =>
          expect(screen.getByText(`${5 - attempt} attempt${5 - attempt === 1 ? '' : 's'} remaining`)).toBeTruthy()
        );
        fireEvent.press(screen.getByText('OK'));
      }
    }

    await waitFor(() =>
      expect(
        screen.getByText('You have been locked out for 5 minutes due to too many failed attempts.')
      ).toBeTruthy()
    );
    fireEvent.press(screen.getByText('OK'));

    // The lockout replaces the passphrase field entirely: the countdown is the whole screen.
    await waitFor(
      () => expect(screen.getByText('Too many failed attempts')).toBeTruthy(),
      { timeout: 4000 }
    );
    expect(screen.getByText('Please wait before trying again')).toBeTruthy();
    expect(screen.queryByPlaceholderText(LOCK_INPUT)).toBeNull();
    expect(screen.queryByText('Unlock')).toBeNull();
    expect(onUnlock).not.toHaveBeenCalled();
  }, 20000);

  it('will not accept the CORRECT passphrase while locked out', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onUnlock = jest.fn();
    const view = render(<LockScreen onUnlock={onUnlock} />);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      fireEvent.changeText(view.getByPlaceholderText(LOCK_INPUT), 'nope nope');
      fireEvent.press(view.getByText('Unlock'));
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(view.getByText('OK')).toBeTruthy());
      fireEvent.press(view.getByText('OK'));
    }
    view.unmount();

    // Come back to the lock screen with the right passphrase in hand: it is still barred.
    const second = render(<LockScreen onUnlock={onUnlock} />);
    await waitFor(() => expect(second.getByText('Too many failed attempts')).toBeTruthy());
    expect(second.queryByPlaceholderText(LOCK_INPUT)).toBeNull();
    expect(onUnlock).not.toHaveBeenCalled();
  }, 20000);

  it('does not open the app when the keystore cannot be read — it counts as a failed attempt', async () => {
    await enableLockThroughSetupScreen('correct horse');
    Keychain.__failReads();

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'correct horse');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('Incorrect Passphrase')).toBeTruthy());
    expect(screen.getByText('4 attempts remaining before lockout.')).toBeTruthy();
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it("shows 'Verifying...' while the keystore read is still in flight", async () => {
    await enableLockThroughSetupScreen('correct horse');
    const release = Keychain.__stall();

    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'correct horse');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('Verifying...')).toBeTruthy());
    expect(onUnlock).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Verifying...')).toBeNull();
  });
});

describe('App lock — changing the passphrase', () => {
  beforeEach(() => {
    Keychain.__reset();
    useAuthStore.getState().resetFailedAttempts();
    useAuthStore.getState().setEnabled(false);
  });

  it('refuses the change when the current passphrase is wrong', async () => {
    await enableLockThroughSetupScreen('correct horse');
    const storedBefore = Keychain.__peek();

    const onComplete = jest.fn();
    render(
      <PassphraseSetupScreen isChanging onComplete={onComplete} onCancel={jest.fn()} />
    );

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CURRENT), 'not the one');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'brand new one');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'brand new one');
    // The header title and the submit button share this text; the button is the last of them.
    fireEvent.press(screen.getAllByText('Change Passphrase').at(-1)!);

    await waitFor(() =>
      expect(screen.getByText('Current passphrase is incorrect')).toBeTruthy()
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toEqual(storedBefore);
  });

  it('changes the passphrase, and only the new one then unlocks', async () => {
    await enableLockThroughSetupScreen('correct horse');

    const onComplete = jest.fn();
    const change = render(
      <PassphraseSetupScreen isChanging onComplete={onComplete} onCancel={jest.fn()} />
    );
    fireEvent.changeText(change.getByPlaceholderText(SETUP_CURRENT), 'correct horse');
    fireEvent.changeText(change.getByPlaceholderText(SETUP_NEW), 'brand new one');
    fireEvent.changeText(change.getByPlaceholderText(SETUP_CONFIRM), 'brand new one');
    fireEvent.press(change.getAllByText('Change Passphrase').at(-1)!);
    await waitFor(() =>
      expect(change.getByText('Passphrase changed successfully')).toBeTruthy()
    );
    change.unmount();

    const onUnlock = jest.fn();
    const lock = render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(lock.getByPlaceholderText(LOCK_INPUT), 'correct horse');
    fireEvent.press(lock.getByText('Unlock'));
    await waitFor(() => expect(lock.getByText('Incorrect Passphrase')).toBeTruthy());
    expect(onUnlock).not.toHaveBeenCalled();
    fireEvent.press(lock.getByText('OK'));

    fireEvent.changeText(lock.getByPlaceholderText(LOCK_INPUT), 'brand new one');
    fireEvent.press(lock.getByText('Unlock'));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  }, 20000);

  it('refuses the change, and keeps the old passphrase, when the keystore cannot be read', async () => {
    await enableLockThroughSetupScreen('correct horse');
    const storedBefore = Keychain.__peek();
    Keychain.__failReads();

    const onComplete = jest.fn();
    render(<PassphraseSetupScreen isChanging onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CURRENT), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'brand new one');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CONFIRM), 'brand new one');
    fireEvent.press(screen.getAllByText('Change Passphrase').at(-1)!);

    await waitFor(() => expect(screen.getByText('Current passphrase is incorrect')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toEqual(storedBefore);
  });

  it('backs out of a change on Cancel, leaving the stored passphrase untouched', async () => {
    await enableLockThroughSetupScreen('correct horse');
    const storedBefore = Keychain.__peek();

    const onComplete = jest.fn();
    const onCancel = jest.fn();
    render(<PassphraseSetupScreen isChanging onComplete={onComplete} onCancel={onCancel} />);

    fireEvent.changeText(screen.getByPlaceholderText(SETUP_CURRENT), 'correct horse');
    fireEvent.changeText(screen.getByPlaceholderText(SETUP_NEW), 'brand new one');
    fireEvent.press(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toEqual(storedBefore);

    // The old passphrase still unlocks; the abandoned new one does not.
    const onUnlock = jest.fn();
    const lock = render(<LockScreen onUnlock={onUnlock} />);
    fireEvent.changeText(lock.getByPlaceholderText(LOCK_INPUT), 'correct horse');
    fireEvent.press(lock.getByText('Unlock'));
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
  }, 20000);
});
