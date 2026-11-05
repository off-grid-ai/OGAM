/**
 * Security settings — the passphrase lock.
 *
 * The real screen runs on a real stack navigator with the real passphrase sheet, auth store and
 * authService. Only the device keychain is faked, with a stateful one that really stores what the
 * app saves (keyedRemoteServer's keychainModule). Each test reads what the person sees, and checks
 * the saved passphrase through the app's own authService.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());

import React from 'react';
import { Text } from 'react-native';
import * as rtl from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SecuritySettingsScreen } from '../../../src/screens/SecuritySettingsScreen';
import { useAuthStore } from '../../../src/stores/authStore';
import { authService } from '../../../src/services/authService';
import { resetKeychain } from '../../harness/keyedRemoteServer';
import { submitPassphraseForm } from '../../harness/passphraseForm';

const { act, fireEvent, render, waitFor } = rtl;
const Stack = createNativeStackNavigator();
const SettingsStub = () => <Text>Settings screen</Text>;

function mount() {
  const ref = createNavigationContainerRef<Record<string, undefined>>();
  const view = render(
    <NavigationContainer ref={ref}>
      <Stack.Navigator initialRouteName="Settings">
        <Stack.Screen name="Settings" component={SettingsStub} />
        <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  act(() => { ref.navigate('SecuritySettings'); });
  return { view, route: () => ref.getCurrentRoute()?.name };
}

const lockSwitch = (view: rtl.RenderResult) => view.getByRole('switch');

/** Turn the lock on through the switch and the passphrase sheet. */
async function enableLock(view: rtl.RenderResult, passphrase: string) {
  fireEvent(lockSwitch(view), 'valueChange', true);
  await waitFor(() => expect(view.getByText('Set Up Passphrase')).toBeTruthy());
  await submitPassphraseForm(rtl, view, { next: passphrase });
  await waitFor(() => expect(view.queryByText('Set Up Passphrase')).toBeNull());
}

describe('SecuritySettingsScreen', () => {
  beforeEach(() => {
    resetKeychain();
    useAuthStore.setState(useAuthStore.getInitialState());
  });

  it('shows the App Lock section and what the lock does', () => {
    const { view } = mount();

    expect(view.getByText('Security')).toBeTruthy();
    expect(view.getByText('App Lock')).toBeTruthy();
    expect(view.getByText('Passphrase lock')).toBeTruthy();
    expect(view.getByText('Ask for your passphrase when the app opens.')).toBeTruthy();
    expect(view.getByText(/The app locks when you leave it/)).toBeTruthy();
    expect(view.getByText(/stored securely on device and never transmitted/i)).toBeTruthy();
  });

  it('Back returns to the screen it was opened from', async () => {
    const { view, route } = mount();
    expect(route()).toBe('SecuritySettings');

    fireEvent.press(view.getByLabelText('Back'));

    await waitFor(() => expect(route()).toBe('Settings'));
  });

  describe('turning the lock on', () => {
    it('starts off, with no Change Passphrase button', () => {
      const { view } = mount();

      expect(lockSwitch(view).props.value).toBe(false);
      expect(view.queryByText('Change passphrase')).toBeNull();
    });

    it('opens the passphrase sheet; saving a passphrase turns the lock on and keeps the passphrase', async () => {
      const { view } = mount();
      expect(view.queryByText('Set Up Passphrase')).toBeNull();

      await enableLock(view, 'river stone 42');

      expect(lockSwitch(view).props.value).toBe(true);
      expect(view.getByText('Change passphrase')).toBeTruthy();
      expect(await authService.verifyPassphrase('river stone 42')).toBe(true);
    });

    it('Cancel closes the sheet and leaves the lock off', async () => {
      const { view } = mount();
      fireEvent(lockSwitch(view), 'valueChange', true);
      await waitFor(() => expect(view.getByText('Set Up Passphrase')).toBeTruthy());

      fireEvent.press(view.getByText('Cancel'));

      await waitFor(() => expect(view.queryByText('Set Up Passphrase')).toBeNull());
      expect(lockSwitch(view).props.value).toBe(false);
      expect(await authService.hasPassphrase()).toBe(false);
    });
  });

  describe('turning the lock off', () => {
    it('asks first, with Disable and Cancel', async () => {
      const { view } = mount();
      await enableLock(view, 'river stone 42');

      fireEvent(lockSwitch(view), 'valueChange', false);

      expect(view.getByText('Disable Passphrase Lock')).toBeTruthy();
      expect(view.getByText('Are you sure you want to disable passphrase protection?')).toBeTruthy();
      expect(view.getByText('Disable')).toBeTruthy();
      expect(view.getByText('Cancel')).toBeTruthy();
    });

    it('Cancel keeps the lock on and the passphrase saved', async () => {
      const { view } = mount();
      await enableLock(view, 'river stone 42');
      fireEvent(lockSwitch(view), 'valueChange', false);

      fireEvent.press(view.getByText('Cancel'));

      await waitFor(() => expect(view.queryByText('Disable Passphrase Lock')).toBeNull());
      expect(lockSwitch(view).props.value).toBe(true);
      expect(await authService.verifyPassphrase('river stone 42')).toBe(true);
    });

    it('Disable turns the lock off and forgets the passphrase', async () => {
      const { view } = mount();
      await enableLock(view, 'river stone 42');
      fireEvent(lockSwitch(view), 'valueChange', false);

      await act(async () => { fireEvent.press(view.getByText('Disable')); });

      await waitFor(() => expect(lockSwitch(view).props.value).toBe(false));
      expect(view.queryByText('Change passphrase')).toBeNull();
      expect(await authService.hasPassphrase()).toBe(false);
    });
  });

  describe('changing the passphrase', () => {
    it('opens the sheet in change mode and saves the new passphrase', async () => {
      const { view } = mount();
      await enableLock(view, 'river stone 42');

      fireEvent.press(view.getByText('Change passphrase'));
      await waitFor(() => expect(view.getByText('Enter your current passphrase and then set a new one.')).toBeTruthy());
      await submitPassphraseForm(rtl, view, { current: 'river stone 42', next: 'ocean leaf 77' });

      await waitFor(() => expect(view.queryByText('Enter your current passphrase and then set a new one.')).toBeNull());
      expect(await authService.verifyPassphrase('ocean leaf 77')).toBe(true);
      expect(await authService.verifyPassphrase('river stone 42')).toBe(false);
    });

    it('refuses a wrong current passphrase and keeps the old one', async () => {
      const { view } = mount();
      await enableLock(view, 'river stone 42');

      fireEvent.press(view.getByText('Change passphrase'));
      await waitFor(() => expect(view.getByText('Enter your current passphrase and then set a new one.')).toBeTruthy());
      await submitPassphraseForm(rtl, view, { current: 'wrong guess', next: 'ocean leaf 77' });

      await waitFor(() => expect(view.getByText('Current passphrase is incorrect')).toBeTruthy());
      expect(await authService.verifyPassphrase('river stone 42')).toBe(true);
    });
  });
});
