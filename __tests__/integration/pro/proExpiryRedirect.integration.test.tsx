import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { NavigationContainerRef } from '@react-navigation/native';
import { useProExpiryRedirect } from '../../../src/navigation/useProExpiryRedirect';
import type { RootStackParamList } from '../../../src/navigation/types';
import { useAppStore } from '../../../src/stores/appStore';

type TestNavigation = Pick<
  NavigationContainerRef<RootStackParamList>,
  'isReady' | 'resetRoot'
>;

function Probe({ navigation }: { navigation: TestNavigation }): null {
  useProExpiryRedirect(navigation);
  return null;
}

describe('the live Pro expiry redirect', () => {
  const resetRoot = jest.fn();
  let ready = true;
  const navigation: TestNavigation = {
    isReady: () => ready,
    resetRoot,
  };

  beforeEach(() => {
    ready = true;
    resetRoot.mockClear();
    useAppStore.setState({
      hasRegisteredPro: false,
      hasSavedProCredential: false,
      isProActive: false,
      proDeviceAdmission: 'unknown',
    });
  });

  it('does not redirect a normal free launch', () => {
    render(<Probe navigation={navigation} />);
    expect(resetRoot).not.toHaveBeenCalled();
  });

  it('replaces the current route with the purchase screen when access is lost', () => {
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
      isProActive: true,
      proDeviceAdmission: 'active',
    });
    render(<Probe navigation={navigation} />);

    act(() => {
      useAppStore.setState({
        hasRegisteredPro: false,
        hasSavedProCredential: false,
        isProActive: false,
        proDeviceAdmission: 'unknown',
      });
    });

    expect(resetRoot).toHaveBeenCalledTimes(1);
    expect(resetRoot).toHaveBeenCalledWith({
      index: 1,
      routes: [{ name: 'Main' }, { name: 'ProDetail' }],
    });
  });
});
