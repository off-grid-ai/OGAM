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

const PAY_URL = 'https://offgridmobileai.co/pay';
const mockActivateProByKey = jest.fn();
const mockGetProLicenseInfo = jest.fn();
const mockListProDevices = jest.fn();
const mockDeactivateProDevice = jest.fn();

jest.mock('../../../src/services/proLicenseService', () => ({
  activateProByKey: (...args: unknown[]) => mockActivateProByKey(...args),
  getProLicenseInfo: (...args: unknown[]) => mockGetProLicenseInfo(...args),
  listProDevices: (...args: unknown[]) => mockListProDevices(...args),
  deactivateProDevice: (...args: unknown[]) => mockDeactivateProDevice(...args),
  // ProManageSection renders the status line from this map — mirror the real export
  // so the mock can't diverge (an omitted map made PRO_TIER_META[tier] throw).
  PRO_TIER_META: {
    lifetime: { label: 'Lifetime', renews: false },
    yearly: { label: 'Yearly', renews: true },
  },
  PRO_PAY_PAGE_URL: 'https://offgridmobileai.co/pay',
}));

import { ProDetailScreen } from '../../../src/screens/ProDetailScreen';
import { ProUnlockModal } from '../../../src/screens/ProDetailScreen/ProUnlockModal';

/**
 * PARTIALLY GREEN, and the four that remain red are red for one reason: this suite mocks
 * `proLicenseService`, which is our own code. The assertions therefore describe the mock rather than the
 * app, which is how they came to drift without anything failing - the module could not even be resolved
 * for a while and every test in the file was skipped in silence.
 *
 * The remaining four assert the management card (status line, renewal link, replacement error) through
 * that mock. Fixing them means running the real licence stack over the in-memory provider, the way the
 * sync journeys do, rather than teaching the mock new tricks.
 */
describe('ProDetailScreen', () => {
  let alertSpy: jest.SpyInstance;
  let linkingSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ hasRegisteredPro: false });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    linkingSpy = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(true as never);
    // Defaults for the Pro-active management section.
    mockGetProLicenseInfo.mockResolvedValue({
      isPro: true,
      tier: 'lifetime',
      expiry: null,
      verifiedAt: 0,
    });
    mockListProDevices.mockResolvedValue([]);
    mockDeactivateProDevice.mockResolvedValue(true);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    linkingSpy.mockRestore();
  });

  it('renders the Get Pro call-to-action when the user is not Pro', () => {
    const { queryAllByText, queryByText } = render(<ProDetailScreen />);
    expect(queryAllByText('Get Pro').length).toBeGreaterThan(0);
    expect(queryByText('Use Pro from another device')).toBeNull();
  });

  it('Get Pro opens the web pay page directly without a modal', () => {
    const { getAllByText, queryByText } = render(<ProDetailScreen />);
    fireEvent.press(getAllByText('Get Pro')[0]);
    expect(linkingSpy).toHaveBeenCalledWith(withUtm(PAY_URL, 'pro-detail'));
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
        'Paste the license key from your email. It works on your licensed devices.',
      ),
    ).toBeTruthy();
  });

  it('activates the license key and shows the success card', async () => {
    mockActivateProByKey.mockResolvedValueOnce({ ok: true });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/abc123');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() =>
      expect(mockActivateProByKey).toHaveBeenCalledWith('key/abc123'),
    );
    await waitFor(() => expect(getByText('Pro activated')).toBeTruthy());
  });

  it('keeps an in-flight activation and its result visible if the parent closes', async () => {
    let finishActivation!: (result: { ok: true }) => void;
    mockActivateProByKey.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishActivation = resolve;
        }),
    );
    const onClose = jest.fn();
    const onUnlocked = jest.fn();
    const ui = render(
      <ProUnlockModal visible onClose={onClose} onUnlocked={onUnlocked} />,
    );
    fireEvent.changeText(ui.getByTestId('license-key-input'), 'key/abc123');
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

    finishActivation({ ok: true });
    await waitFor(() => expect(ui.getByText('Pro activated')).toBeTruthy());
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets the user dismiss the success card with Got it', async () => {
    mockActivateProByKey.mockResolvedValueOnce({ ok: true });
    const { getByText, getByTestId, queryByText } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/abc123');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() => expect(getByText('Pro activated')).toBeTruthy());
    fireEvent.press(getByText('Got it'));
    await waitFor(() => expect(queryByText('Pro activated')).toBeNull());
  });

  it('shows an inline error when the key is invalid', async () => {
    // 'invalid' is not a reason the activation flow reports any more. The failure codes are named for
    // what went wrong - a key the provider will not accept is `invalid_credential` - and the sentence the
    // user reads comes from the shared projection rather than from this screen.
    mockActivateProByKey.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid_credential',
    });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/nope');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() =>
      expect(getByText('That license key is invalid or revoked.')).toBeTruthy(),
    );
    expect(getByText('License not accepted')).toBeTruthy();
  });

  it.each([
    ['a licence with no room left', 'capacity_full'],
    ['a seat that could not be freed', 'replacement_failed'],
    ['a licence the provider will not accept', 'invalid_credential'],
  ])('says what went wrong for %s', async (_why, reason) => {
    mockActivateProByKey.mockResolvedValueOnce({ ok: false, reason });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/abc123');
    fireEvent.press(getByTestId('unlock-cta'));

    // Read from the shared projection rather than restated here. The test used to pass reason: 'limit'
    // - not a code the app has - and assert copy from a different failure, so it was checking the words
    // of one error against the code of another. Asserting through the projection means the screen and
    // this test cannot disagree, and a copy change cannot silently pass.
    const expected = projectPersonalMeshActivationFailure(
      reason as Parameters<typeof projectPersonalMeshActivationFailure>[0],
    );
    await waitFor(() => expect(getByText(expected.title)).toBeTruthy());
    expect(getByText(expected.description)).toBeTruthy();
  });

  it('keeps the activate button disabled until a key is entered', async () => {
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    // Empty input: the disabled button ignores the press, no activate call.
    fireEvent.press(getByTestId('unlock-cta'));
    expect(mockActivateProByKey).not.toHaveBeenCalled();
    // Once a key is entered the button is enabled and activates.
    mockActivateProByKey.mockResolvedValueOnce({ ok: true });
    fireEvent.changeText(getByTestId('license-key-input'), 'key/abc123');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() => expect(mockActivateProByKey).toHaveBeenCalled());
  });

  it('treats whitespace-only input as empty so the button stays disabled', () => {
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), '   ');
    fireEvent.press(getByTestId('unlock-cta'));
    expect(mockActivateProByKey).not.toHaveBeenCalled();
  });

  it('strips surrounding whitespace before activating', async () => {
    mockActivateProByKey.mockResolvedValueOnce({ ok: true });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), '  key/abc123  ');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() =>
      expect(mockActivateProByKey).toHaveBeenCalledWith('key/abc123'),
    );
  });

  it('"Not a member yet? Get Pro" in the modal opens the pay page', () => {
    const { getByText } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.press(getByText('Not a member yet? Get Pro'));
    expect(linkingSpy).toHaveBeenCalledWith(withUtm(PAY_URL, 'pro-unlock'));
  });

  it('renders the Pro Active state with the management section when Pro is owned', async () => {
    // "Pro Active" is about THIS DEVICE being admitted to the licence, not merely about owning one.
    // There are only two states now: a device the roster removed is not Pro and sees the buy screen,
    // so admission has to be set here alongside the credential or nothing Pro renders at all.
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
      proDeviceAdmission: 'active' as const,
    });
    const { getByText } = render(<ProDetailScreen />);
    expect(getByText('Pro Active')).toBeTruthy();
    // ProManageSection loads license info async, then shows the status line.
    await waitFor(() =>
      expect(getByText('Lifetime · never expires')).toBeTruthy(),
    );
  });

  it('shows the yearly status line and a Manage subscription link for a recurring license', async () => {
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
      proDeviceAdmission: 'active' as const,
    });
    mockGetProLicenseInfo.mockResolvedValue({
      isPro: true,
      tier: 'yearly',
      expiry: '2026-08-01T00:00:00.000Z',
      verifiedAt: 0,
    });
    const { getByText } = render(<ProDetailScreen />);
    await waitFor(() => expect(getByText(/Yearly · renews/)).toBeTruthy());
    expect(getByText('Manage subscription')).toBeTruthy();
  });

  it('shows a lifetime status line and NO Manage subscription link for a one-time license', async () => {
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
    });
    mockGetProLicenseInfo.mockResolvedValue({
      isPro: true,
      tier: 'lifetime',
      expiry: null,
      verifiedAt: 0,
    });
    const { getByText, queryByText } = render(<ProDetailScreen />);
    await waitFor(() =>
      expect(getByText(/Lifetime · never expires/)).toBeTruthy(),
    );
    expect(queryByText('Manage subscription')).toBeNull();
  });
});
