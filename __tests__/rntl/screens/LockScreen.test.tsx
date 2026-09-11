/**
 * LockScreen — the real screen, as the user sees it.
 *
 * Real LockScreen + real PassphraseSetupScreen (to arrive at "a passphrase exists" by gesture)
 * + real authService (real hashing) + the real useAuthStore lockout state machine.
 * The ONLY fakes are device-boundary ones: `react-native-keychain` (the OS keystore) and the
 * wall clock (Date.now), which the lockout countdown reads.
 *
 * No Off Grid module is mocked. Every precondition is reached by typing and pressing;
 * nothing calls store.setState. Every assertion is made on rendered UI.
 */
import React from 'react';
import { render, fireEvent, waitFor, screen } from '@testing-library/react-native';
import { LockScreen } from '../../../src/screens/LockScreen';
import { PassphraseSetupScreen } from '../../../src/screens/PassphraseSetupScreen';
import { useAuthStore } from '../../../src/stores/authStore';

/** The OS keystore, faked at the native line: one in-memory credential entry. */
jest.mock('react-native-keychain', () => {
  let entry: { username: string; password: string } | false = false;
  return {
    setGenericPassword: async (username: string, password: string) => {
      entry = { username, password };
      return true;
    },
    getGenericPassword: async () => entry,
    resetGenericPassword: async () => {
      entry = false;
      return true;
    },
    ACCESSIBLE: { WHEN_UNLOCKED: 'WhenUnlocked', AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
    __reset: () => {
      entry = false;
    },
  };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Keychain = require('react-native-keychain') as { __reset: () => void };

const LOCK_INPUT = 'Enter passphrase';
const SETUP_NEW = 'Enter passphrase (min 6 characters)';
const SETUP_CONFIRM = 'Re-enter passphrase';
const PASSPHRASE = 'correct horse';

/** The wall clock is a boundary, not our code: shift it to age the lockout countdown. */
const realNow = Date.now.bind(Date);
let clockOffsetMs = 0;
beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffsetMs);
});
afterAll(() => {
  (Date.now as jest.Mock).mockRestore();
});

/** Set the app passphrase the only way a user can: through the real setup screen. */
async function enableLockThroughSetupScreen(passphrase: string): Promise<void> {
  const view = render(
    <PassphraseSetupScreen onComplete={jest.fn()} onCancel={jest.fn()} />
  );
  fireEvent.changeText(view.getByPlaceholderText(SETUP_NEW), passphrase);
  fireEvent.changeText(view.getByPlaceholderText(SETUP_CONFIRM), passphrase);
  fireEvent.press(view.getByText('Enable Lock'));
  await waitFor(() => expect(view.getByText('Passphrase lock enabled')).toBeTruthy());
  view.unmount();
}

/** Type a wrong passphrase and press Unlock, dismissing the alert that follows. */
async function failOneAttempt(attempt: number): Promise<void> {
  fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), `wrong ${attempt}`);
  fireEvent.press(screen.getByText('Unlock'));
  await waitFor(() => expect(screen.getByText('OK')).toBeTruthy());
  fireEvent.press(screen.getByText('OK'));
}

describe('LockScreen', () => {
  beforeEach(() => {
    Keychain.__reset();
    clockOffsetMs = 0;
    // Real store actions only — never a direct state write.
    useAuthStore.getState().resetFailedAttempts();
    useAuthStore.getState().setEnabled(false);
  });

  // ---- Rendering ----

  it('renders lock icon and title', () => {
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByText('App Locked')).toBeTruthy();
  });

  it('renders passphrase input', () => {
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByPlaceholderText(LOCK_INPUT)).toBeTruthy();
  });

  it('shows unlock button', () => {
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByText('Unlock')).toBeTruthy();
  });

  it('shows subtitle text', () => {
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByText('Enter your passphrase to unlock')).toBeTruthy();
  });

  it('shows footer with security message', () => {
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByText('Your data is protected and stored locally')).toBeTruthy();
  });

  // ---- Unlock flow ----

  it('calls onUnlock after successful verification', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), PASSPHRASE);
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
    expect(screen.queryByText('Incorrect Passphrase')).toBeNull();
  });

  it('shows error when passphrase is empty', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    // The button is disabled with an empty field: pressing it does nothing at all.
    fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(onUnlock).not.toHaveBeenCalled());
    expect(screen.queryByText('Incorrect Passphrase')).toBeNull();
  });

  it('records failed attempt on incorrect passphrase', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong horse');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('4 attempts remaining')).toBeTruthy());
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('shows "Incorrect Passphrase" alert on wrong password', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong horse');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('Incorrect Passphrase')).toBeTruthy());
    expect(screen.getByText('4 attempts remaining before lockout.')).toBeTruthy();
  });

  it('shows lockout alert when too many failed attempts', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }
    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong 5');
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(screen.getByText('Too Many Attempts')).toBeTruthy());
    expect(
      screen.getByText(
        'You have been locked out for 5 minutes due to too many failed attempts.'
      )
    ).toBeTruthy();
  });

  // ---- Lockout state ----

  it('shows lockout UI when locked out', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }

    await waitFor(() => expect(screen.getByText('Too many failed attempts')).toBeTruthy());
    expect(screen.getByText('Please wait before trying again')).toBeTruthy();
    // The input is gone while locked out — there is no way to submit a passphrase.
    expect(screen.queryByPlaceholderText(LOCK_INPUT)).toBeNull();
  });

  it('shows lockout timer counting down from five minutes', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }
    await waitFor(() => expect(screen.getByText('Too many failed attempts')).toBeTruthy());
    expect(screen.getByText('5:00')).toBeTruthy();

    // Two minutes later the same lockout reads three minutes remaining.
    screen.unmount();
    clockOffsetMs = 2 * 60 * 1000;
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByText('3:00')).toBeTruthy();
  });

  it('shows lockout timer with correct format', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }
    await waitFor(() => expect(screen.getByText('Too many failed attempts')).toBeTruthy());

    // 3 minutes 55 seconds into a 5 minute lockout: 1:05 remains, zero-padded.
    screen.unmount();
    clockOffsetMs = 235 * 1000;
    render(<LockScreen onUnlock={jest.fn()} />);
    expect(screen.getByText('1:05')).toBeTruthy();
  });

  // ---- Attempts counter ----

  it('shows remaining attempts when there are failed attempts', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    await failOneAttempt(1);
    await failOneAttempt(2);

    await waitFor(() => expect(screen.getByText('3 attempts remaining')).toBeTruthy());
  });

  it('shows singular "attempt" when only 1 remaining', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }

    await waitFor(() => expect(screen.getByText('1 attempt remaining')).toBeTruthy());
  });

  it('does not show attempts counter when no failed attempts', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    expect(screen.queryByText(/attempts? remaining/)).toBeNull();
  });

  // ---- Button enablement ----

  it('unlock button is disabled when input is empty', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.press(screen.getByText('Unlock'));

    // Nothing happened: no unlock, no failed-attempt counter appeared.
    await waitFor(() => expect(onUnlock).not.toHaveBeenCalled());
    expect(screen.queryByText(/attempts? remaining/)).toBeNull();
  });

  it('unlock button is enabled when input has text', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), PASSPHRASE);
    fireEvent.press(screen.getByText('Unlock'));

    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it('does not call verify when already locked out', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }
    await waitFor(() => expect(screen.getByText('Too many failed attempts')).toBeTruthy());

    // Even the CORRECT passphrase has nowhere to go: the field is not on screen.
    expect(screen.queryByPlaceholderText(LOCK_INPUT)).toBeNull();
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('clears passphrase after failed attempt', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong horse');
    fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.getByText('Incorrect Passphrase')).toBeTruthy());
    fireEvent.press(screen.getByText('OK'));

    expect(screen.getByPlaceholderText(LOCK_INPUT).props.value).toBe('');
  });

  // ---- Keyboard submit ----

  it('shows error when passphrase is empty via onSubmitEditing', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    // The button is disabled on an empty field, but the keyboard return key still fires.
    fireEvent(screen.getByPlaceholderText(LOCK_INPUT), 'onSubmitEditing');

    await waitFor(() => expect(screen.getByText('Please enter your passphrase')).toBeTruthy());
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('skips verification when already locked out during handleUnlock', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    const onUnlock = jest.fn();
    render(<LockScreen onUnlock={onUnlock} />);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      await failOneAttempt(attempt);
    }
    // The fifth failure trips the lockout while the field is still on screen.
    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong 5');
    fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.getByText('Too Many Attempts')).toBeTruthy());
    fireEvent.press(screen.getByText('OK'));

    // The screen has switched to the lockout panel; nothing can be submitted.
    await waitFor(() => expect(screen.getByText('Too many failed attempts')).toBeTruthy());
    expect(onUnlock).not.toHaveBeenCalled();
  });

  it('closes the alert when the user dismisses it', async () => {
    await enableLockThroughSetupScreen(PASSPHRASE);
    render(<LockScreen onUnlock={jest.fn()} />);

    fireEvent.changeText(screen.getByPlaceholderText(LOCK_INPUT), 'wrong horse');
    fireEvent.press(screen.getByText('Unlock'));
    await waitFor(() => expect(screen.getByText('Incorrect Passphrase')).toBeTruthy());

    fireEvent.press(screen.getByText('OK'));

    await waitFor(() => expect(screen.queryByText('Incorrect Passphrase')).toBeNull());
  });
});
