/**
 * Passphrase sheet — set a new passphrase, or change the current one.
 *
 * The real sheet runs with the real authService and auth store. Only the device keychain is faked,
 * with a stateful one that really stores the hash (deviceKeychain); a test can make its write
 * fail or hang, as a locked or busy keychain does. A small host stands in for the
 * Security screen that opens the sheet: it shows whether the sheet closed as done or cancelled. The
 * saved passphrase is read back through authService.
 */
jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());

import React, { useState } from 'react';
import { Text } from 'react-native';
import * as rtl from '@testing-library/react-native';
import { PassphraseSetupScreen } from '../../../src/screens/PassphraseSetupScreen';
import { useAuthStore } from '../../../src/stores/authStore';
import { authService } from '../../../src/services/authService';
import { resetKeychain } from '../../harness/keyedRemoteServer';
import { holdKeychainWrites, refuseKeychainWrites, resetKeychainWrites } from '../../harness/deviceKeychain';
import { submitPassphraseForm, PASSPHRASE_PLACEHOLDERS } from '../../harness/passphraseForm';

const { act, fireEvent, render, waitFor } = rtl;

/** The screen that opens the sheet: it shows how the sheet closed. */
function Opener({ isChanging }: { isChanging?: boolean }) {
  const [closed, setClosed] = useState<string | null>(null);
  return closed ? (
    <Text>{`Sheet closed: ${closed}`}</Text>
  ) : (
    <PassphraseSetupScreen
      isChanging={isChanging}
      onComplete={() => setClosed('done')}
      onCancel={() => setClosed('cancelled')}
    />
  );
}

describe('PassphraseSetupScreen', () => {
  beforeEach(() => {
    resetKeychain();
    resetKeychainWrites();
    useAuthStore.setState(useAuthStore.getInitialState());
  });

  describe('setting a passphrase', () => {
    it('shows the setup form: Passphrase and Confirm fields, tips and Enable Lock', () => {
      const view = render(<Opener />);

      expect(view.getByText('Set Up Passphrase')).toBeTruthy();
      expect(view.getByText(/Create a passphrase to lock the app/)).toBeTruthy();
      expect(view.getByText('Passphrase')).toBeTruthy();
      expect(view.queryByText('New Passphrase')).toBeNull();
      expect(view.queryByPlaceholderText(PASSPHRASE_PLACEHOLDERS.current)).toBeNull();
      expect(view.getByPlaceholderText(PASSPHRASE_PLACEHOLDERS.next)).toBeTruthy();
      expect(view.getByPlaceholderText(PASSPHRASE_PLACEHOLDERS.confirm)).toBeTruthy();
      expect(view.getByText('Tips for a good passphrase:')).toBeTruthy();
      expect(view.getByText(/Use a mix of words/)).toBeTruthy();
      expect(view.getByText('Enable Lock')).toBeTruthy();
    });

    it('Cancel closes the sheet without saving anything', async () => {
      const view = render(<Opener />);

      fireEvent.press(view.getByText('Cancel'));

      expect(view.getByText('Sheet closed: cancelled')).toBeTruthy();
      expect(await authService.hasPassphrase()).toBe(false);
    });

    it.each([
      ['shorter than 6 characters', 'abc', 'Passphrase must be at least 6 characters'],
      ['longer than 50 characters', 'a'.repeat(51), 'Passphrase must be 50 characters or less'],
    ])('refuses a passphrase %s', async (_case, passphrase, message) => {
      const view = render(<Opener />);

      await submitPassphraseForm(rtl, view, { next: passphrase });

      expect(view.getByText('Invalid Passphrase')).toBeTruthy();
      expect(view.getByText(message)).toBeTruthy();
      expect(view.queryByText(/Sheet closed/)).toBeNull();
      expect(await authService.hasPassphrase()).toBe(false);
    });

    it('refuses a confirmation that does not match', async () => {
      const view = render(<Opener />);

      await submitPassphraseForm(rtl, view, { next: 'password123', confirm: 'different456' });

      expect(view.getByText('Mismatch')).toBeTruthy();
      expect(view.getByText('Passphrases do not match')).toBeTruthy();
      expect(await authService.hasPassphrase()).toBe(false);
    });

    it('saves a valid passphrase, turns the lock on and closes the sheet', async () => {
      const view = render(<Opener />);
      expect(useAuthStore.getState().isEnabled).toBe(false);

      await submitPassphraseForm(rtl, view, { next: 'securepass123' });

      await waitFor(() => expect(view.getByText('Sheet closed: done')).toBeTruthy());
      expect(useAuthStore.getState().isEnabled).toBe(true);
      expect(await authService.verifyPassphrase('securepass123')).toBe(true);
    });

    it('shows Saving... while the keychain is still writing', async () => {
      const finish = holdKeychainWrites();
      const view = render(<Opener />);

      await submitPassphraseForm(rtl, view, { next: 'securepass123' });

      expect(view.getByText('Saving...')).toBeTruthy();
      expect(view.queryByText('Enable Lock')).toBeNull();
      await act(async () => { finish(); });
      await waitFor(() => expect(view.getByText('Sheet closed: done')).toBeTruthy());
    });

    it('says it failed when the keychain refuses the write, and leaves the lock off', async () => {
      refuseKeychainWrites('Keychain write refused');
      const view = render(<Opener />);

      await submitPassphraseForm(rtl, view, { next: 'securepass123' });

      await waitFor(() => expect(view.getByText('Failed to set passphrase')).toBeTruthy());
      expect(view.getByText('Enable Lock')).toBeTruthy();
      expect(view.queryByText(/Sheet closed/)).toBeNull();
      expect(useAuthStore.getState().isEnabled).toBe(false);
    });
  });

  describe('changing the passphrase', () => {
    beforeEach(async () => {
      await authService.setPassphrase('oldpassword');
    });

    it('shows the change form: Current and New Passphrase fields and a Change Passphrase button', () => {
      const view = render(<Opener isChanging />);

      expect(view.getAllByText('Change Passphrase')).toHaveLength(2);
      expect(view.getByText(/Enter your current passphrase/)).toBeTruthy();
      expect(view.getByText('Current Passphrase')).toBeTruthy();
      expect(view.getByText('New Passphrase')).toBeTruthy();
      expect(view.getByPlaceholderText(PASSPHRASE_PLACEHOLDERS.current)).toBeTruthy();
      expect(view.queryByText('Enable Lock')).toBeNull();
    });

    it('saves the new passphrase and closes the sheet, without touching the lock switch', async () => {
      const view = render(<Opener isChanging />);

      await submitPassphraseForm(rtl, view, { current: 'oldpassword', next: 'newpassword' });

      await waitFor(() => expect(view.getByText('Sheet closed: done')).toBeTruthy());
      expect(await authService.verifyPassphrase('newpassword')).toBe(true);
      expect(await authService.verifyPassphrase('oldpassword')).toBe(false);
      expect(useAuthStore.getState().isEnabled).toBe(false);
    });

    it('refuses a wrong current passphrase and keeps the old one', async () => {
      const view = render(<Opener isChanging />);

      await submitPassphraseForm(rtl, view, { current: 'wrongpassword', next: 'newpassword' });

      await waitFor(() => expect(view.getByText('Current passphrase is incorrect')).toBeTruthy());
      expect(view.queryByText(/Sheet closed/)).toBeNull();
      expect(await authService.verifyPassphrase('oldpassword')).toBe(true);
    });
  });
});
