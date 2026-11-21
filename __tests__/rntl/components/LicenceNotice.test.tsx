/**
 * The licence line on the phone: why Pro went, and the way back. The words and the order of the
 * buttons are the shared rule's; this checks the phone hands it the right facts and runs the tap.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { useAppStore } from '../../../src/stores/appStore';
import { LicenceNotice } from '../../../src/components/LicenceNotice';

const lost = {
  hasRegisteredPro: false,
  isProActive: false,
  hasSavedProCredential: false,
  hasExpiredProCredential: false,
  licenceRemovedBy: null,
  proDeviceAdmission: 'unknown' as const,
};

describe('LicenceNotice', () => {
  beforeEach(() => useAppStore.setState(lost));
  afterEach(() => useAppStore.setState(lost));

  it('shows nothing to a person who never had Pro', () => {
    const { toJSON } = render(<LicenceNotice onAction={{ renew: () => undefined }} />);
    expect(toJSON()).toBeNull();
  });

  it('names the device that removed this phone, and Pair again runs', () => {
    useAppStore.getState().setLicenceRemovedBy("Mac's MacBook Pro");
    const pairs: string[] = [];
    const { getByText } = render(
      <LicenceNotice onAction={{ 'pair-again': () => pairs.push('pair'), 'enter-key': () => undefined }} />,
    );
    expect(getByText("Mac's MacBook Pro removed this device from your license.")).toBeTruthy();
    fireEvent.press(getByText('Pair again'));
    expect(pairs).toEqual(['pair']);
  });

  it('says an ended license has ended and offers Renew first', () => {
    useAppStore.setState({ hasExpiredProCredential: true, hasSavedProCredential: true });
    const { getByText, getByTestId } = render(
      <LicenceNotice onAction={{ renew: () => undefined, 'enter-key': () => undefined }} />,
    );
    expect(getByText('Your Pro license has ended.')).toBeTruthy();
    expect(getByTestId('licence-notice-renew')).toBeTruthy();
  });

  it('getting Pro back clears who removed it', () => {
    useAppStore.getState().setLicenceRemovedBy('');
    useAppStore.getState().setHasRegisteredPro(true);
    expect(useAppStore.getState().licenceRemovedBy).toBeNull();
  });
});
