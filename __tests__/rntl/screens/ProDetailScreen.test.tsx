/**
 * ProDetailScreen Tests
 *
 * Renders the real Pro screen and exercises the purchase / restore handlers
 * and the entitlement-driven UI states (Get Pro vs Pro Active).
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useAppStore } from '../../../src/stores/appStore';

const mockPresentProPaywall = jest.fn();
const mockRestorePro = jest.fn();
const mockResetProIdentityForTesting = jest.fn();
jest.mock('../../../src/services/proLicenseService', () => ({
  presentProPaywall: (...args: unknown[]) => mockPresentProPaywall(...args),
  restorePro: (...args: unknown[]) => mockRestorePro(...args),
  resetProIdentityForTesting: (...args: unknown[]) => mockResetProIdentityForTesting(...args),
}));

import { ProDetailScreen } from '../../../src/screens/ProDetailScreen';

describe('ProDetailScreen', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({ hasRegisteredPro: false });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('renders the Get Pro call-to-action when the user is not Pro', () => {
    const { queryAllByText } = render(<ProDetailScreen />);
    expect(queryAllByText('Get Pro').length).toBeGreaterThan(0);
  });

  it('shows the restart prompt after a successful purchase', async () => {
    mockPresentProPaywall.mockResolvedValueOnce(true);
    const { getAllByText } = render(<ProDetailScreen />);

    fireEvent.press(getAllByText('Get Pro')[0]);

    await waitFor(() => expect(mockPresentProPaywall).toHaveBeenCalledTimes(1));
    expect(alertSpy).toHaveBeenCalledWith('Pro activated', expect.any(String), expect.anything());
  });

  it('does not show the restart prompt when the purchase is not completed', async () => {
    mockPresentProPaywall.mockResolvedValueOnce(false);
    const { getAllByText } = render(<ProDetailScreen />);

    fireEvent.press(getAllByText('Get Pro')[0]);

    await waitFor(() => expect(mockPresentProPaywall).toHaveBeenCalledTimes(1));
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows a failure alert when the purchase throws', async () => {
    mockPresentProPaywall.mockRejectedValueOnce(new Error('boom'));
    const { getAllByText } = render(<ProDetailScreen />);

    fireEvent.press(getAllByText('Get Pro')[0]);

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Purchase failed', expect.any(String)));
  });

  it('shows the restart prompt when a restore finds an active subscription', async () => {
    mockRestorePro.mockResolvedValueOnce(true);
    const { getByText } = render(<ProDetailScreen />);

    fireEvent.press(getByText('Restore purchases'));

    await waitFor(() => expect(mockRestorePro).toHaveBeenCalledTimes(1));
    expect(alertSpy).toHaveBeenCalledWith('Pro activated', expect.any(String), expect.anything());
  });

  it('tells the user when a restore finds no purchases', async () => {
    mockRestorePro.mockResolvedValueOnce(false);
    const { getByText } = render(<ProDetailScreen />);

    fireEvent.press(getByText('Restore purchases'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('No purchases found', expect.any(String)));
  });

  it('shows a failure alert when the restore throws', async () => {
    mockRestorePro.mockRejectedValueOnce(new Error('boom'));
    const { getByText } = render(<ProDetailScreen />);

    fireEvent.press(getByText('Restore purchases'));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Restore failed', expect.any(String)));
  });

  it('renders the Pro Active state when the user already owns Pro', () => {
    useAppStore.setState({ hasRegisteredPro: true });
    const { getByText, queryByText } = render(<ProDetailScreen />);

    expect(getByText('Pro Active')).toBeTruthy();
    expect(getByText('Pro is active on this account.')).toBeTruthy();
    expect(queryByText('Restore purchases')).toBeNull();
  });

  it('runs the dev reset and confirms when the Pro user taps [DEV] reset', async () => {
    useAppStore.setState({ hasRegisteredPro: true });
    mockResetProIdentityForTesting.mockResolvedValueOnce(undefined);
    const { getByText } = render(<ProDetailScreen />);

    fireEvent.press(getByText('[DEV] Reset Pro identity'));

    await waitFor(() => expect(mockResetProIdentityForTesting).toHaveBeenCalledTimes(1));
    expect(alertSpy).toHaveBeenCalledWith('Dev reset', expect.any(String));
  });
});
