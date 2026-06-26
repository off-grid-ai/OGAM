/**
 * ProDetailScreen Tests
 *
 * Covers the license-key activation flow (paste key → activate → success card),
 * the "Get Pro" → web pay page path, and the Pro-active management section.
 */

import React from 'react';
import { Alert, Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useAppStore } from '../../../src/stores/appStore';

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
  PRO_PAY_PAGE_URL: 'https://offgridmobileai.co/pay',
}));

jest.mock('../../../src/services/deviceFingerprint', () => ({
  getDeviceFingerprint: jest.fn().mockResolvedValue('fp-this-device'),
}));

import { ProDetailScreen } from '../../../src/screens/ProDetailScreen';

describe('ProDetailScreen', () => {
  let alertSpy: jest.SpyInstance;
  let linkingSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ hasRegisteredPro: false });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    linkingSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    // Defaults for the Pro-active management section.
    mockGetProLicenseInfo.mockResolvedValue({ isPro: true, tier: 'lifetime', expiry: null, verifiedAt: 0 });
    mockListProDevices.mockResolvedValue([]);
    mockDeactivateProDevice.mockResolvedValue(true);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    linkingSpy.mockRestore();
  });

  it('renders the Get Pro call-to-action when the user is not Pro', () => {
    const { queryAllByText } = render(<ProDetailScreen />);
    expect(queryAllByText('Get Pro').length).toBeGreaterThan(0);
  });

  it('Get Pro opens the web pay page directly without a modal', () => {
    const { getAllByText, queryByText } = render(<ProDetailScreen />);
    fireEvent.press(getAllByText('Get Pro')[0]);
    expect(linkingSpy).toHaveBeenCalledWith(PAY_URL);
    // No in-app activation step for paying.
    expect(queryByText('Enter your license key')).toBeNull();
  });

  it('"I have a license key" opens the activation modal', () => {
    const { getByText } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    expect(getByText('Enter your license key')).toBeTruthy();
    expect(getByText('Paste the license key from your email. It works on up to 5 devices.')).toBeTruthy();
  });

  it('activates the license key and shows the success card', async () => {
    mockActivateProByKey.mockResolvedValueOnce({ ok: true });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/abc123');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() => expect(mockActivateProByKey).toHaveBeenCalledWith('key/abc123'));
    await waitFor(() => expect(getByText('Pro activated')).toBeTruthy());
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
    mockActivateProByKey.mockResolvedValueOnce({ ok: false, reason: 'invalid' });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/nope');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() => expect(getByText(/isn't valid or active/)).toBeTruthy());
  });

  it('shows the device-limit error when the key is on its 5 devices', async () => {
    mockActivateProByKey.mockResolvedValueOnce({ ok: false, reason: 'limit' });
    const { getByText, getByTestId } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.changeText(getByTestId('license-key-input'), 'key/full');
    fireEvent.press(getByTestId('unlock-cta'));
    await waitFor(() => expect(getByText(/already on its 5 devices/)).toBeTruthy());
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
    await waitFor(() => expect(mockActivateProByKey).toHaveBeenCalledWith('key/abc123'));
  });

  it('"Not a member yet? Get Pro" in the modal opens the pay page', () => {
    const { getByText } = render(<ProDetailScreen />);
    fireEvent.press(getByText('I have a license key'));
    fireEvent.press(getByText('Not a member yet? Get Pro'));
    expect(linkingSpy).toHaveBeenCalledWith(PAY_URL);
  });

  it('renders the Pro Active state with the management section when Pro is owned', async () => {
    useAppStore.setState({ hasRegisteredPro: true });
    const { getByText } = render(<ProDetailScreen />);
    expect(getByText('Pro Active')).toBeTruthy();
    // ProManageSection loads license info async, then shows the status line.
    await waitFor(() => expect(getByText('Lifetime · never expires')).toBeTruthy());
  });

  it('shows the monthly status line and a Manage subscription link for monthly Pro', async () => {
    useAppStore.setState({ hasRegisteredPro: true });
    mockGetProLicenseInfo.mockResolvedValue({
      isPro: true,
      tier: 'monthly',
      expiry: '2026-08-01T00:00:00.000Z',
      verifiedAt: 0,
    });
    const { getByText } = render(<ProDetailScreen />);
    await waitFor(() => expect(getByText(/Monthly · active until/)).toBeTruthy());
    expect(getByText('Manage subscription')).toBeTruthy();
  });
});
