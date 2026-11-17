/**
 * useOpenProTools — the single "open the Pro Tools destination" callback shared by
 * the chat quick-settings row and the Tools page. It routes on whether the Pro
 * Tools screen is registered (the same signal as useIsProActive):
 *   - free (screen not registered) -> the Get Pro checkout sheet, no page in between
 *   - pro  (screen registered)     -> the Pro Tools screen
 *
 * The real navigator runs; the test reads which screen the app is on after the tap.
 */
jest.unmock('@react-navigation/native');
// The checkout sheet is native (the in-app browser): the device boundary.
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(() => Promise.resolve(true)), open: jest.fn(() => Promise.resolve()), close: jest.fn() },
}));

import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useOpenProTools } from '../../../src/hooks/useOpenProTools';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { PRO_TOOLS_SCREEN } from '../../../src/hooks/useIsProActive';
import { useAppStore } from '../../../src/stores/appStore';
import { websiteReach } from '../../harness/websiteReach';

const Stack = createNativeStackNavigator();
const navigation = createNavigationContainerRef<Record<string, undefined>>();
const Blank = () => null;

const Opener = () => {
  const open = useOpenProTools();
  return (
    <TouchableOpacity testID="open" onPress={open}>
      <Text>open</Text>
    </TouchableOpacity>
  );
};

/** The opener on a stack that also has the upsell and the Pro Tools screen. */
const Probe = () => (
  <NavigationContainer ref={navigation}>
    <Stack.Navigator>
      <Stack.Screen name="Home" component={Opener} />
      <Stack.Screen name="ProDetail" component={Blank} />
      <Stack.Screen name={PRO_TOOLS_SCREEN} component={Blank} />
    </Stack.Navigator>
  </NavigationContainer>
);
/** The screen the app is on now. */
const onScreen = () => navigation.getCurrentRoute()?.name;


// The checkout opens only once our site answers: online here.
let undoReach = (): void => undefined;
beforeEach(() => {
  undoReach = websiteReach(true);
});
afterEach(() => undoReach());

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

  it('opens the Get Pro sheet for a free user, without a page in between', async () => {
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('open'));
    await waitFor(() => expect(InAppBrowser.open).toHaveBeenCalledTimes(1));
    expect((InAppBrowser.open as jest.Mock).mock.calls[0][0]).toMatch(/\/pro\/app\/.*utm_medium=pro-tools/);
    expect(onScreen()).toBe('Home');
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
    expect(onScreen()).toBe(PRO_TOOLS_SCREEN);
  });

  it('opens the Get Pro sheet as soon as live access is removed', async () => {
    registerScreen({ name: PRO_TOOLS_SCREEN, component: () => null });
    useAppStore.setState({
      hasRegisteredPro: false,
      hasSavedProCredential: false,
      isProActive: false,
      proDeviceAdmission: 'unknown',
    });

    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('open'));

    await waitFor(() => expect(InAppBrowser.open).toHaveBeenCalledTimes(1));
    expect(onScreen()).toBe('Home');
  });
});
