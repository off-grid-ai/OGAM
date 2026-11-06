/**
 * Lock screen — the passphrase gate shown when the app opens with the lock on.
 *
 * The real LockScreen runs with the real auth store (failed attempts, lockout) and the real
 * authService. Only the device is faked: the keychain, with a stateful one that really stores the
 * passphrase hash the app saved (keyedRemoteServer's keychainModule), and the clock for the lockout
 * countdown. The passphrase is saved through authService, the app's own write path. A small host
 * stands in for the app shell: it shows the app once the lock screen says it is unlocked.
 */
jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());

import React, { useState } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react-native';
import { LockScreen } from '../../../src/screens/LockScreen';
import { useAuthStore } from '../../../src/stores/authStore';
import { authService } from '../../../src/services/authService';
import { resetKeychain, setKeychainUnreadable } from '../../harness/keyedRemoteServer';

const PASSPHRASE = 'river stone 42';

/** The app shell: the lock screen until it unlocks, then the app. */
function AppShell() {
  const [unlocked, setUnlocked] = useState(false);
  return unlocked ? <Text>App content</Text> : <LockScreen onUnlock={() => setUnlocked(true)} />;
}

async function enter(view: RenderResult, passphrase: string) {
  fireEvent.changeText(view.getByPlaceholderText('Enter passphrase'), passphrase);
  await act(async () => { fireEvent.press(view.getByText('Unlock')); });
}

/** Enter a wrong passphrase and close the alert it raises. */
async function failOnce(view: RenderResult) {
  await enter(view, 'wrong guess');
  await waitFor(() => expect(view.getByText('Incorrect Passphrase')).toBeTruthy());
  fireEvent.press(view.getByText('OK'));
  await waitFor(() => expect(view.queryByText('Incorrect Passphrase')).toBeNull());
}

describe('LockScreen', () => {
  beforeEach(async () => {
    resetKeychain();
    useAuthStore.setState(useAuthStore.getInitialState());
    await authService.setPassphrase(PASSPHRASE);
    useAuthStore.getState().setEnabled(true);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the lock, the passphrase field and a disabled Unlock until something is typed', () => {
    const view = render(<AppShell />);

    expect(view.getByText('App locked')).toBeTruthy();
    expect(view.getByText('Enter your passphrase to unlock')).toBeTruthy();
    expect(view.getByText('Your data is protected and stored locally')).toBeTruthy();
    expect(view.getByPlaceholderText('Enter passphrase')).toBeTruthy();
    expect(view.queryByText(/attempts? remaining/)).toBeNull();

    fireEvent.press(view.getByText('Unlock'));
    expect(view.getByText('App locked')).toBeTruthy();
    expect(view.queryByText('Incorrect Passphrase')).toBeNull();
  });

  it('asks for the passphrase when the keyboard\'s Done is pressed on an empty field', async () => {
    const view = render(<AppShell />);

    await act(async () => { fireEvent(view.getByPlaceholderText('Enter passphrase'), 'submitEditing'); });

    expect(view.getByText('Please enter your passphrase')).toBeTruthy();
    expect(view.getByText('App locked')).toBeTruthy();
  });

  it('opens the app on the right passphrase, and the keyboard\'s Done works like Unlock', async () => {
    const view = render(<AppShell />);
    expect(view.queryByText('App content')).toBeNull();

    fireEvent.changeText(view.getByPlaceholderText('Enter passphrase'), PASSPHRASE);
    await act(async () => { fireEvent(view.getByPlaceholderText('Enter passphrase'), 'submitEditing'); });

    await waitFor(() => expect(view.getByText('App content')).toBeTruthy());
    expect(view.queryByText('App locked')).toBeNull();
  });

  it('refuses a wrong passphrase, clears the field and counts down the attempts left', async () => {
    const view = render(<AppShell />);

    await enter(view, 'wrong guess');

    await waitFor(() => expect(view.getByText('Incorrect Passphrase')).toBeTruthy());
    expect(view.getByText('4 attempts remaining before lockout.')).toBeTruthy();
    expect(view.getByPlaceholderText('Enter passphrase').props.value).toBe('');
    expect(view.queryByText('App content')).toBeNull();

    fireEvent.press(view.getByText('OK'));
    await waitFor(() => expect(view.queryByText('Incorrect Passphrase')).toBeNull());
    expect(view.getByText('4 attempts remaining')).toBeTruthy();
  });

  it('says "1 attempt remaining" after four wrong tries', async () => {
    const view = render(<AppShell />);

    for (let i = 0; i < 4; i += 1) await failOnce(view);

    expect(view.getByText('1 attempt remaining')).toBeTruthy();
  });

  it('a right passphrase after wrong ones opens the app and resets the count', async () => {
    const view = render(<AppShell />);
    await failOnce(view);
    await failOnce(view);
    expect(view.getByText('3 attempts remaining')).toBeTruthy();

    await enter(view, PASSPHRASE);

    await waitFor(() => expect(view.getByText('App content')).toBeTruthy());
    view.unmount();
    const again = render(<AppShell />);
    expect(again.queryByText(/attempts? remaining/)).toBeNull();
  });

  it('locks the person out after five wrong tries, counts down five minutes, then lets them try again', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
    const view = render(<AppShell />);
    for (let i = 0; i < 4; i += 1) await failOnce(view);

    await enter(view, 'wrong guess');

    await waitFor(() => expect(view.getByText('Too Many Attempts')).toBeTruthy());
    expect(view.getByText('You have been locked out for 5 minutes due to too many failed attempts.')).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(view.getByText('Too many failed attempts')).toBeTruthy();
    expect(view.getByText('Please wait before trying again')).toBeTruthy();
    expect(view.getByText('4:59')).toBeTruthy();
    expect(view.queryByPlaceholderText('Enter passphrase')).toBeNull();

    await act(async () => { jest.advanceTimersByTime(234_000); });
    expect(view.getByText('1:05')).toBeTruthy();

    await act(async () => { jest.advanceTimersByTime(66_000); });
    expect(view.queryByText('Too many failed attempts')).toBeNull();
    expect(view.getByPlaceholderText('Enter passphrase')).toBeTruthy();
  });

  it('keeps the lockout across a relaunch of the lock screen', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-01T10:00:00Z') });
    const first = render(<AppShell />);
    for (let i = 0; i < 5; i += 1) {
      await enter(first, 'wrong guess');
      await waitFor(() => expect(first.queryByText('Incorrect Passphrase') ?? first.getByText('Too Many Attempts')).toBeTruthy());
      fireEvent.press(first.getByText('OK'));
    }
    first.unmount();
    await act(async () => { jest.advanceTimersByTime(120_000); });

    const view = render(<AppShell />);

    expect(view.getByText('Too many failed attempts')).toBeTruthy();
    expect(view.getByText('3:00')).toBeTruthy();
    expect(view.queryByPlaceholderText('Enter passphrase')).toBeNull();
  });

  it('says it could not check the passphrase when the keychain cannot be read, counts no attempt, and unlocks once it can', async () => {
    const view = render(<AppShell />);
    setKeychainUnreadable(true);

    await enter(view, PASSPHRASE);

    // Not "Incorrect Passphrase": the passphrase was never checked, so no attempt is charged.
    await waitFor(() => expect(view.getByText("Couldn't check your passphrase")).toBeTruthy());
    expect(view.queryByText('Incorrect Passphrase')).toBeNull();
    expect(view.queryByText(/attempts? remaining/)).toBeNull();

    // The keychain answers again: Try again checks the same passphrase and unlocks.
    setKeychainUnreadable(false);
    fireEvent.press(view.getByText('Try again'));
    await waitFor(() => expect(view.queryByPlaceholderText('Enter passphrase')).toBeNull());
  });
});
