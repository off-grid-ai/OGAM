/**
 * useOpenProTools — the single "open the Pro Tools destination" callback shared by
 * the chat quick-settings row and the Tools page. It routes on whether the Pro
 * Tools screen is registered (the same signal as useIsProActive):
 *   - no bundle (screen not registered) -> the Pro features screen, which explains why
 *   - bundle    (screen registered)     -> the Pro Tools screen
 *
 * This used to fork on entitlement, with the non-entitled branch going to the purchase
 * page. There is no purchase page: the only thing that can be missing is the code.
 */

import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { useOpenProTools } from '../../../src/hooks/useOpenProTools';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { PRO_TOOLS_SCREEN } from '../../../src/hooks/useIsProActive';
import { useAppStore } from '../../../src/stores/appStore';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
  };
});

const Probe = () => {
  const open = useOpenProTools();
  return (
    <TouchableOpacity testID="open" onPress={open}>
      <Text>open</Text>
    </TouchableOpacity>
  );
};

describe('useOpenProTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearScreensForTesting();
    useAppStore.setState({
      hasRegisteredPro: false,
      hasSavedProCredential: false,
      isProActive: false,
      proDeviceAdmission: 'unknown',
    });
  });
  afterEach(() => {
    _clearScreensForTesting();
  });

  it('routes to the Pro features screen when the bundle is not in this build', () => {
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('open'));
    expect(mockNavigate).toHaveBeenCalledWith('ProDetail');
  });

  it('routes a pro user to the Pro Tools screen once it is registered', () => {
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
      isProActive: true,
      proDeviceAdmission: 'active',
    });
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('open'));
    expect(mockNavigate).toHaveBeenCalledWith(PRO_TOOLS_SCREEN);
  });

  it('still opens the tools for a device with no credential and no roster answer', () => {
    // Nothing bought, nothing admitted: the tools are registered, so they open. This is the case that
    // used to be routed to a purchase.
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });
    useAppStore.setState({
      hasRegisteredPro: false,
      hasSavedProCredential: false,
      isProActive: false,
      proDeviceAdmission: 'unknown',
    });

    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('open'));

    expect(mockNavigate).toHaveBeenCalledWith(PRO_TOOLS_SCREEN);
  });
});
