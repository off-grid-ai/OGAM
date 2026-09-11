/**
 * PassphraseSetupScreen — the screen as the user sees it.
 *
 * REAL composition: the real screen, the real `components` barrel (Button/Card/CustomAlert),
 * the real `authService` (real hashing) and the real `useAuthStore`. The ONLY fake is
 * `react-native-keychain` — the OS keystore, which is the true device boundary
 * (see src/services/authService.ts: Keychain + logger, nothing else).
 *
 * Every precondition is reached by gesture through the real screen. Nothing calls
 * store.setState, and nothing mocks Off Grid code.
 *
 * Scope note: this suite owns the SCREEN's presentation contract — titles, field labels,
 * descriptions, tips, button text, and the mode-dependent copy. The end-to-end lock journey
 * (unlock, lockout, keystore failure modes) is owned by
 * __tests__/integration/security/passphraseLock.rendered.test.tsx; where a behaviour here
 * overlaps that suite the covering test is named in a comment.
 */

import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';

/** The keystore, faked at the native line: one credential entry, as the platform keychain has. */
jest.mock('react-native-keychain', () => {
  let entry: { username: string; password: string } | false = false;
  let setRefuses = false;
  let gate: { promise: Promise<void>; release: () => void } | null = null;
  const passGate = async () => {
    if (gate) {
      await gate.promise;
    }
  };
  return {
    setGenericPassword: async (username: string, password: string) => {
      await passGate();
      // A real keystore can refuse a write without throwing: it resolves `false`.
      if (setRefuses) {
        return false;
      }
      entry = { username, password };
      return true;
    },
    getGenericPassword: async () => {
      await passGate();
      return entry;
    },
    resetGenericPassword: async () => {
      entry = false;
      return true;
    },
    ACCESSIBLE: { WHEN_UNLOCKED: 'WhenUnlocked', AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    __peek: () => entry,
    __refuseWrites: () => {
      setRefuses = true;
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
      setRefuses = false;
      gate = null;
    },
  };
});

import { PassphraseSetupScreen } from '../../../src/screens/PassphraseSetupScreen';
import { useAuthStore } from '../../../src/stores/authStore';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Keychain = require('react-native-keychain') as {
  __peek: () => { username: string; password: string } | false;
  __refuseWrites: () => void;
  __stall: () => () => void;
  __reset: () => void;
};

const NEW_FIELD = 'Enter passphrase (min 6 characters)';
const CONFIRM_FIELD = 'Re-enter passphrase';
const CURRENT_FIELD = 'Enter current passphrase';

/** Press the submit button, whichever label the current mode gives it. */
const pressSubmit = (label: 'Enable Lock' | 'Change Passphrase') => {
  const matches = screen.getAllByText(label);
  // In change mode the header title carries the same words; the button is last.
  fireEvent.press(matches[matches.length - 1]);
};

/** Give the app a passphrase the only way a user can: through the real setup screen. */
async function enableLockThroughSetupScreen(passphrase: string): Promise<void> {
  const view = render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
  fireEvent.changeText(view.getByPlaceholderText(NEW_FIELD), passphrase);
  fireEvent.changeText(view.getByPlaceholderText(CONFIRM_FIELD), passphrase);
  fireEvent.press(view.getByText('Enable Lock'));
  await waitFor(() => expect(view.getByText('Passphrase lock enabled')).toBeTruthy());
  view.unmount();
}

describe('PassphraseSetupScreen', () => {
  beforeEach(() => {
    Keychain.__reset();
    // Real store actions only — never a direct state write.
    useAuthStore.getState().resetFailedAttempts();
    useAuthStore.getState().setEnabled(false);
  });

  // ---- What the screen puts on the glass ----

  it('renders "Set Up Passphrase" title for new setup', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Set Up Passphrase')).toBeTruthy();
  });

  it('renders passphrase input fields', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByPlaceholderText(NEW_FIELD)).toBeTruthy();
  });

  it('shows confirm passphrase field', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByPlaceholderText(CONFIRM_FIELD)).toBeTruthy();
  });

  it('shows current passphrase field when isChanging=true', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} isChanging />);
    expect(screen.getAllByText('Change Passphrase').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Current Passphrase')).toBeTruthy();
    expect(screen.getByPlaceholderText(CURRENT_FIELD)).toBeTruthy();
  });

  it('does not offer a current passphrase field in new setup', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.queryByText('Current Passphrase')).toBeNull();
    expect(screen.queryByPlaceholderText(CURRENT_FIELD)).toBeNull();
  });

  it('shows "Enable Lock" button text for new setup', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Enable Lock')).toBeTruthy();
  });

  it('shows "Change Passphrase" button text when isChanging', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} isChanging />);
    // Title and button both say "Change Passphrase".
    expect(screen.getAllByText('Change Passphrase').length).toBeGreaterThanOrEqual(2);
  });

  it('renders tips section', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Tips for a good passphrase:')).toBeTruthy();
    expect(screen.getByText(/Use a mix of words/)).toBeTruthy();
    expect(screen.getByText(/Make it memorable/)).toBeTruthy();
    expect(screen.getByText(/Avoid personal information/)).toBeTruthy();
  });

  it('shows description for new setup', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText(/Create a passphrase to lock the app/)).toBeTruthy();
  });

  it('shows description for change mode', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} isChanging />);
    expect(screen.getByText(/Enter your current passphrase/)).toBeTruthy();
  });

  it('shows Passphrase label for new setup', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByText('Passphrase')).toBeTruthy();
    expect(screen.queryByText('New Passphrase')).toBeNull();
  });

  it('shows New Passphrase label for change mode', () => {
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} isChanging />);
    expect(screen.getByText('New Passphrase')).toBeTruthy();
  });

  // ---- Validation, through the real service ----
  // Also covered end-to-end by passphraseLock.rendered.test.tsx
  // ('refuses a passphrase shorter than six characters' / '...longer than fifty characters' /
  //  'refuses a confirmation that does not match'); kept here as the screen's own contract.

  it('shows validation error when passphrase is too short', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'abc');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'abc');
    pressSubmit('Enable Lock');

    await waitFor(() => expect(screen.getByText('Invalid Passphrase')).toBeTruthy());
    expect(screen.getByText('Passphrase must be at least 6 characters')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
  });

  it('shows validation error when passphrase is too long', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);
    const longPass = 'a'.repeat(51);

    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), longPass);
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), longPass);
    pressSubmit('Enable Lock');

    await waitFor(() =>
      expect(screen.getByText('Passphrase must be 50 characters or less')).toBeTruthy()
    );
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
  });

  it('shows mismatch error when passphrases do not match', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'password123');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'differentpassword');
    pressSubmit('Enable Lock');

    await waitFor(() => expect(screen.getByText('Mismatch')).toBeTruthy());
    expect(screen.getByText('Passphrases do not match')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(Keychain.__peek()).toBe(false);
  });

  // ---- Submitting ----

  it('saves the passphrase and enables the lock on a valid new setup', async () => {
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'securepass123');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'securepass123');
    pressSubmit('Enable Lock');

    await waitFor(() => expect(screen.getByText('Passphrase lock enabled')).toBeTruthy());
    expect(onComplete).toHaveBeenCalled();
    expect(Keychain.__peek()).not.toBe(false);
    expect(useAuthStore.getState().isEnabled).toBe(true);
  });

  it('changes the passphrase when the current one is right', async () => {
    await enableLockThroughSetupScreen('oldpassword');
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} isChanging />);

    fireEvent.changeText(screen.getByPlaceholderText(CURRENT_FIELD), 'oldpassword');
    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'newpassword');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'newpassword');
    pressSubmit('Change Passphrase');

    await waitFor(() => expect(screen.getByText('Passphrase changed successfully')).toBeTruthy());
    expect(onComplete).toHaveBeenCalled();
  });

  it('cancel button calls onCancel', () => {
    const onCancel = jest.fn();
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={onCancel} />);
    fireEvent.press(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // ---- Failure the user can actually meet ----

  it('shows error when current passphrase is incorrect on change', async () => {
    await enableLockThroughSetupScreen('oldpassword');
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} isChanging />);

    fireEvent.changeText(screen.getByPlaceholderText(CURRENT_FIELD), 'wrongpassword');
    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'newpassword');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'newpassword');
    pressSubmit('Change Passphrase');

    await waitFor(() => expect(screen.getByText('Current passphrase is incorrect')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('shows error when the keystore refuses to store the passphrase', async () => {
    // The only real failure path: authService reports `false`, it never throws.
    Keychain.__refuseWrites();
    const onComplete = jest.fn();
    render(<PassphraseSetupScreen onComplete={onComplete} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'validpass123');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'validpass123');
    pressSubmit('Enable Lock');

    await waitFor(() => expect(screen.getByText('Failed to set passphrase')).toBeTruthy());
    expect(onComplete).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isEnabled).toBe(false);
  });

  it('shows "Saving..." button text while submitting', async () => {
    const release = Keychain.__stall();
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'validpass123');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'validpass123');
    pressSubmit('Enable Lock');

    await waitFor(() => expect(screen.getByText('Saving...')).toBeTruthy());
    expect(screen.queryByText('Enable Lock')).toBeNull();

    release();
    await waitFor(() => expect(screen.getByText('Passphrase lock enabled')).toBeTruthy());
  });

  it('never announces the lock as newly enabled when only changing the passphrase', async () => {
    // The observable stand-in for "change mode does not run the enable branch": the screen
    // reports the change, and never the enable, no matter how the change ends.
    await enableLockThroughSetupScreen('oldpass1');
    render(<PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} isChanging />);

    fireEvent.changeText(screen.getByPlaceholderText(CURRENT_FIELD), 'oldpass1');
    fireEvent.changeText(screen.getByPlaceholderText(NEW_FIELD), 'newpass123');
    fireEvent.changeText(screen.getByPlaceholderText(CONFIRM_FIELD), 'newpass123');
    pressSubmit('Change Passphrase');

    await waitFor(() => expect(screen.getByText('Passphrase changed successfully')).toBeTruthy());
    expect(screen.queryByText('Passphrase lock enabled')).toBeNull();
  });
});
