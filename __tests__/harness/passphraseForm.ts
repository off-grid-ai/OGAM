/**
 * passphraseForm — drive the app's real passphrase sheet (PassphraseSetupScreen) the way a person
 * does: type into its fields by their placeholders and press its submit button.
 *
 * The keychain the passphrase lands in is the device boundary. Test files fake it with the stateful
 * keychain from keyedRemoteServer:
 *   jest.mock('react-native-keychain', () => require('../../harness/keyedRemoteServer').keychainModule());
 * and read what it holds through the app's own authService.
 */
import type { RenderResult } from '@testing-library/react-native';

type Rtl = typeof import('@testing-library/react-native');

export const PASSPHRASE_PLACEHOLDERS = {
  current: 'Enter current passphrase',
  next: 'Enter passphrase (min 6 characters)',
  confirm: 'Re-enter passphrase',
} as const;

/** Fill the sheet and press its submit button ("Enable Lock" or "Change Passphrase"). */
export async function submitPassphraseForm(
  rtl: Rtl,
  view: RenderResult,
  fields: { current?: string; next: string; confirm?: string },
): Promise<void> {
  if (fields.current !== undefined) {
    rtl.fireEvent.changeText(view.getByPlaceholderText(PASSPHRASE_PLACEHOLDERS.current), fields.current);
  }
  rtl.fireEvent.changeText(view.getByPlaceholderText(PASSPHRASE_PLACEHOLDERS.next), fields.next);
  rtl.fireEvent.changeText(view.getByPlaceholderText(PASSPHRASE_PLACEHOLDERS.confirm), fields.confirm ?? fields.next);
  const submit = view.queryByText('Enable Lock') ?? view.getAllByText('Change Passphrase').at(-1)!;
  await rtl.act(async () => { rtl.fireEvent.press(submit); });
}
