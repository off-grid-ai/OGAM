/**
 * ProDetailScreen Tests
 *
 * Covers the license-key activation flow (paste key → activate → success card),
 * the "Get Pro" → web pay page path, and the Pro-active management section.
 */

import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { projectPersonalMeshActivationFailure } from '@offgrid/sync';
import { useAppStore } from '../../../src/stores/appStore';
import {
  OFF_GRID_DESKTOP_BENEFIT,
  OFF_GRID_DESKTOP_URL,
} from '../../../src/constants';
import { withUtm } from '../../../src/utils/utm';

const PAY_URL = 'https://getoffgridai.co/pro/#buy';
const KEY = 'key/abc123';

// The device's keychain: stateful, and a write can be held (a slow secure-enclave write).
jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());
// The phone's sync sockets and LAN discovery, which the real pro package loads.
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));

import { ProDetailScreen } from '../../../src/screens/ProDetailScreen';
import { ProUnlockModal } from '../../../src/screens/ProDetailScreen/ProUnlockModal';
import { createKeygenFake } from '../../harness/keygenFake';
import { connectLicenceStack } from '../../harness/licenceStack';
import { holdKeychainWrites } from '../../harness/deviceKeychain';

/**
 * The screen runs on the real licence stack: proLicenseService, the pro licence provider, the credential
 * store and the Keygen client. Keygen answers at the HTTP boundary (keygenFake), so a key is accepted
 * because Keygen holds that licence, and refused because it does not.
 */
const keygen = createKeygenFake();

describe('ProDetailScreen', () => {
  let alertSpy: jest.SpyInstance;
  let linkingSpy: jest.SpyInstance;

  let disconnect: () => void;

  beforeEach(() => {
    keygen.reset();
    keygen.install();
    disconnect = connectLicenceStack();
    useAppStore.setState({ hasRegisteredPro: false });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    linkingSpy = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(true as never);
  });

  afterEach(async () => {
    alertSpy.mockRestore();
    linkingSpy.mockRestore();
    disconnect();
    await require('../../../src/services/proLicenseService').clearProForTesting();
    keygen.restore();
  });

  /** Open the key form, type a key and press Activate, as the person does. */
  const enterKey = (ui: ReturnType<typeof render>, key: string) => {
    fireEvent.press(ui.getByText('I have a license key'));
    fireEvent.changeText(ui.getByTestId('license-key-input'), key);
    fireEvent.press(ui.getByTestId('unlock-cta'));
  };

  it('renders the Get Pro call-to-action when the user is not Pro', () => {
    const { queryAllByText, queryByText } = render(<ProDetailScreen />);
    expect(queryAllByText('Get Pro').length).toBeGreaterThan(0);
    expect(queryByText('Use Pro from another device')).toBeNull();
  });

  it('Get Pro opens the web pay page directly without a modal', () => {
    const { getAllByText, queryByText } = render(<ProDetailScreen />);
    fireEvent.press(getAllByText('Get Pro')[0]);
    expect(linkingSpy).toHaveBeenCalledWith(withUtm(PAY_URL, 'pro-detail'));
    expect(linkingSpy).toHaveBeenCalledWith(
      'https://getoffgridai.co/pro/?utm_source=off-grid-mobile-app&utm_medium=pro-detail&utm_campaign=in-app#buy',
    );
    // No in-app activation step for paying.
    expect(queryByText('Enter your license key')).toBeNull();
  });

  it('links to Off Grid AI Desktop from the Pro pitch', () => {
    const { getByText, queryByText } = render(<ProDetailScreen />);
    expect(getByText(OFF_GRID_DESKTOP_BENEFIT)).toBeTruthy();
    expect(queryByText(/building this through July/i)).toBeNull();
    fireEvent.press(getByText('Get Off Grid AI Desktop'));
    expect(linkingSpy).toHaveBeenCalledWith(
      withUtm(OFF_GRID_DESKTOP_URL, 'pro-detail'),
    );
  });

  it('shows the remote media outcomes and named Desktop control', () => {
    const { getByText } = render(<ProDetailScreen />);
    expect(getByText('Your Desktop does the heavy work')).toBeTruthy();
    expect(
      getByText(
        'Create images, transcribe speech, and hear replies with the models active on your named Desktop. You choose which models it serves.',
      ),
    ).toBeTruthy();
  });

  // Hand test 15: a style edit once took the outline off the real Get Pro button instead of the status.
  const boxStyle = (node: any) => {
    const { StyleSheet } = require('react-native');
    let n = node;
    while (n && !(n.props?.style && (StyleSheet.flatten(n.props.style).borderWidth !== undefined || n.props.onPress))) n = n.parent;
    return n ? StyleSheet.flatten(n.props.style) : {};
  };

  it('Get Pro is an outlined button for someone without Pro', () => {
    const ui = render(<ProDetailScreen />);
    expect(boxStyle(ui.getAllByText('Get Pro')[0]).borderWidth).toBe(1);
  });

  it('the Pro Active status has no outline, so it does not look tappable', async () => {
    useAppStore.setState({ hasRegisteredPro: true });
    const ui = render(<ProDetailScreen />);
    await waitFor(() => expect(ui.getByText('Pro Active')).toBeTruthy());
    const { StyleSheet } = require('react-native');
    const status = ui.getByText('Pro Active').parent?.parent;
    expect(StyleSheet.flatten(status?.props.style).borderWidth).toBeUndefined();
  });

  it('shows the Off Grid AI Desktop link to Pro-active users too', async () => {
    useAppStore.setState({ hasRegisteredPro: true });
    const { getByText } = render(<ProDetailScreen />);
    await waitFor(() =>
      expect(getByText('Get Off Grid AI Desktop')).toBeTruthy(),
    );
    fireEvent.press(getByText('Get Off Grid AI Desktop'));
    expect(linkingSpy).toHaveBeenCalledWith(
      withUtm(OFF_GRID_DESKTOP_URL, 'pro-detail'),
    );
  });

  it('"I have a license key" opens the activation modal', () => {
    const { getByText } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    expect(getByText('Enter your license key')).toBeTruthy();
    expect(
      getByText(
        'Paste the license key from your email. It works on up to 5 devices.',
      ),
    ).toBeTruthy();
  });

  it('activates the license key and shows the success card', async () => {
    keygen.addLicence({ key: KEY, seats: 5 });
    const ui = render(<ProDetailScreen />);
    enterKey(ui, KEY);
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
    // Keygen now holds this phone as one of the licence's installations.
    expect(keygen.machines(KEY)).toHaveLength(1);
  });

  it('keeps an in-flight activation and its result visible if the parent closes', async () => {
    keygen.addLicence({ key: KEY, seats: 5 });
    // The keychain write of the accepted credential is slow, so the activation is still running.
    const releaseWrite = holdKeychainWrites();
    const onClose = jest.fn();
    const onUnlocked = jest.fn();
    const ui = render(
      <ProUnlockModal visible onClose={onClose} onUnlocked={onUnlocked} />,
    );
    fireEvent.changeText(ui.getByTestId('license-key-input'), KEY);
    fireEvent.press(ui.getByTestId('unlock-cta'));
    expect(ui.getByText('Activating...')).toBeTruthy();

    ui.rerender(
      <ProUnlockModal
        visible={false}
        onClose={onClose}
        onUnlocked={onUnlocked}
      />,
    );
    expect(ui.getByText('Activating...')).toBeTruthy();

    releaseWrite();
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets the user dismiss the success card with Got it', async () => {
    keygen.addLicence({ key: KEY, seats: 5 });
    const ui = render(<ProDetailScreen />);
    enterKey(ui, KEY);
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
    fireEvent.press(ui.getByText('Got it'));
    await waitFor(() => expect(ui.queryByText('Pro activated')).toBeNull());
  });

  it('shows an inline error when Keygen does not know the key', async () => {
    const ui = render(<ProDetailScreen />);
    enterKey(ui, 'key/nope');
    await waitFor(() =>
      expect(ui.getByText('That license key is invalid or revoked.')).toBeTruthy(),
    );
    expect(ui.getByText('License not accepted')).toBeTruthy();
  });

  it('says a seat could not be freed when every seat is taken and Keygen will not release one', async () => {
    keygen.addLicence({ key: KEY, seats: 2 });
    keygen.activate({ key: KEY, fingerprint: 'fp-old-phone', platform: 'ios' });
    keygen.activate({ key: KEY, fingerprint: 'fp-laptop', platform: 'macos' });
    keygen.refuseDeactivation(true);
    const ui = render(<ProDetailScreen />);
    enterKey(ui, KEY);

    // Read from the shared projection, so the screen and this test cannot disagree on the words.
    const expected = projectPersonalMeshActivationFailure('replacement_failed');
    await waitFor(() => expect(ui.getByText(expected.title)).toBeTruthy());
    expect(ui.getByText(expected.description)).toBeTruthy();
    expect(keygen.machines(KEY).map(m => m.fingerprint)).toEqual(['fp-old-phone', 'fp-laptop']);
  });

  it('keeps the activate button disabled until a key is entered', async () => {
    keygen.addLicence({ key: KEY, seats: 5 });
    const ui = render(<ProDetailScreen />);
    fireEvent.press(ui.getByText('I have a license key'));
    // Empty input: the disabled button ignores the press, and nothing reaches Keygen.
    fireEvent.press(ui.getByTestId('unlock-cta'));
    expect(keygen.calls).toHaveLength(0);
    // Once a key is entered the button is enabled and activates.
    fireEvent.changeText(ui.getByTestId('license-key-input'), KEY);
    fireEvent.press(ui.getByTestId('unlock-cta'));
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
  });

  it('treats whitespace-only input as empty so the button stays disabled', () => {
    const ui = render(<ProDetailScreen />);
    enterKey(ui, '   ');
    expect(keygen.calls).toHaveLength(0);
    expect(ui.queryByText('Activating...')).toBeNull();
  });

  it('strips surrounding whitespace before activating', async () => {
    keygen.addLicence({ key: KEY, seats: 5 });
    const ui = render(<ProDetailScreen />);
    enterKey(ui, `  ${KEY}  `);
    // Keygen knows only the bare key, so a key sent with its spaces would be refused.
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
  });

  it('activates from the keyboard action', async () => {
    keygen.addLicence({ key: KEY, seats: 5 });
    const ui = render(<ProDetailScreen />);
    fireEvent.press(ui.getByText('I have a license key'));
    fireEvent.changeText(ui.getByTestId('license-key-input'), KEY);
    fireEvent(ui.getByTestId('license-key-input'), 'submitEditing');
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
  });

  it('"Not a member yet? Get Pro" in the modal opens the pay page', () => {
    const { getByText } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.press(getByText('Not a member yet? Get Pro'));
    expect(linkingSpy).toHaveBeenCalledWith(withUtm(PAY_URL, 'pro-unlock'));
  });

  /** Activate a licence through the screen, then close the success card: the person now owns Pro. */
  const ownPro = async (licence: { expiry?: string | null; metadata?: Record<string, unknown> }) => {
    keygen.addLicence({ key: KEY, seats: 5, ...licence });
    const ui = render(<ProDetailScreen />);
    enterKey(ui, KEY);
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
    fireEvent.press(ui.getByText('Got it'));
    return ui;
  };

  it('shows Pro Active with a lifetime status line and no Manage subscription link for a one-time licence', async () => {
    const ui = await ownPro({ expiry: null });
    await waitFor(() => expect(ui.getByText('Pro Active')).toBeTruthy());
    await waitFor(() => expect(ui.getByText('Lifetime · never expires')).toBeTruthy());
    expect(ui.queryByText('Manage subscription')).toBeNull();
  });

  it('shows the renewal status line and a Manage subscription link for an annual licence', async () => {
    const ui = await ownPro({ expiry: '2027-08-01T00:00:00.000Z', metadata: { tier: 'annual' } });
    await waitFor(() => expect(ui.getByText(/Annual · renews/)).toBeTruthy());
    expect(ui.getByText('Manage subscription')).toBeTruthy();
  });
});
