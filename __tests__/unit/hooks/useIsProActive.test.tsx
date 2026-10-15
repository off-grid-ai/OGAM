import React from 'react';
import { Text } from 'react-native';
import { render, act } from '@testing-library/react-native';
import { useIsProActive, PRO_TOOLS_SCREEN } from '../../../src/hooks/useIsProActive';
import {
  registerScreen,
  _clearScreensForTesting,
  useHasRegisteredScreen,
} from '../../../src/navigation/screenRegistry';
import { useAppStore } from '../../../src/stores';

const FakeScreen = () => null;

const Probe = () => {
  const active = useIsProActive();
  return <Text testID="probe">{active ? 'pro' : 'free'}</Text>;
};

describe('useIsProActive / useHasRegisteredScreen', () => {
  beforeEach(() => {
    _clearScreensForTesting();
    // Registration is the whole answer now: it says the bundle is in this build, which is all that can
    // differ. The licence flags below are the honest record of what this install holds, and no longer
    // change what any of it may do.
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
      isProActive: true,
      proDeviceAdmission: 'active',
    });
  });
  afterEach(() => {
    _clearScreensForTesting();
    useAppStore.setState({
      hasRegisteredPro: false,
      hasSavedProCredential: false,
      isProActive: false,
      proDeviceAdmission: 'unknown',
    });
  });

  it('reports free when the Pro Tools screen is not registered', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe').props.children).toBe('free');
  });

  it('reports pro once the Pro Tools screen is registered (reactive update)', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe').props.children).toBe('free');

    act(() => {
      registerScreen({ name: PRO_TOOLS_SCREEN, component: FakeScreen });
    });

    expect(getByTestId('probe').props.children).toBe('pro');
  });

  it('useHasRegisteredScreen tracks an arbitrary screen name reactively', () => {
    const Other = () => {
      const has = useHasRegisteredScreen('SomeOtherScreen');
      return <Text testID="other">{has ? 'yes' : 'no'}</Text>;
    };
    const { getByTestId } = render(<Other />);
    expect(getByTestId('other').props.children).toBe('no');

    act(() => {
      registerScreen({ name: 'SomeOtherScreen', component: FakeScreen });
    });
    expect(getByTestId('other').props.children).toBe('yes');
  });
});
