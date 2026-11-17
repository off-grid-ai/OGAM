/**
 * useGetPro — the one "Get Pro" action. Without Pro it opens the checkout sheet directly (no page
 * in between), a lapsed or deactivated key included; with Pro active it opens the Pro page.
 * The real navigator runs; the in-app browser and the system browser are the device boundary.
 */
jest.unmock('@react-navigation/native');
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(() => Promise.resolve(true)), open: jest.fn(() => Promise.resolve()), close: jest.fn() },
}));

import { Linking, Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { useGetPro } from '../../../src/hooks/useGetPro';
import { useAppStore } from '../../../src/stores/appStore';
import { websiteReach } from '../../harness/websiteReach';

const Stack = createNativeStackNavigator();
const navigation = createNavigationContainerRef<Record<string, undefined>>();
const Blank = () => null;

const Opener = () => {
  const getPro = useGetPro();
  return (
    <TouchableOpacity testID="get-pro" onPress={() => getPro('home-crown')}>
      <Text>Get Pro</Text>
    </TouchableOpacity>
  );
};

const Probe = () => (
  <NavigationContainer ref={navigation}>
    <Stack.Navigator>
      <Stack.Screen name="Home" component={Opener} />
      <Stack.Screen name="ProDetail" component={Blank} />
    </Stack.Navigator>
  </NavigationContainer>
);
const onScreen = () => navigation.getCurrentRoute()?.name;

describe('useGetPro', () => {
  let undoReach: () => void;
  afterEach(() => undoReach());
  beforeEach(() => {
    jest.clearAllMocks();
    undoReach = websiteReach(true);
    const app = useAppStore.getState();
    app.setHasRegisteredPro(false);
    app.setHasSavedProCredential(false);
    app.setProActive(false);
    app.setProDeviceAdmission('unknown');
  });

  it('opens the checkout sheet for someone without Pro, tagged with where the tap came from', async () => {
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('get-pro'));
    await waitFor(() => expect(InAppBrowser.open).toHaveBeenCalledTimes(1));
    expect((InAppBrowser.open as jest.Mock).mock.calls[0][0]).toMatch(
      /^https:\/\/getoffgridai\.co\/pro\/app\/\?theme=(dark|light)&.*utm_medium=home-crown/,
    );
    expect(onScreen()).toBe('Home');
  });

  it('opens the checkout sheet for a lapsed key too: it can be bought again or re-entered from the sheet', async () => {
    useAppStore.getState().setHasSavedProCredential(true);
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('get-pro'));
    await waitFor(() => expect(InAppBrowser.open).toHaveBeenCalledTimes(1));
    expect(onScreen()).toBe('Home');
  });

  it('opens the Pro page for someone with Pro active', () => {
    const app = useAppStore.getState();
    app.setHasRegisteredPro(true);
    app.setHasSavedProCredential(true);
    app.setProActive(true);
    app.setProDeviceAdmission('active');
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('get-pro'));
    expect(onScreen()).toBe('ProDetail');
    expect(InAppBrowser.open).not.toHaveBeenCalled();
  });

  it('opens the Pro page, saying it is offline, when the checkout cannot load', async () => {
    undoReach();
    undoReach = websiteReach(false);
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('get-pro'));
    await waitFor(() => expect(onScreen()).toBe('ProDetail'));
    expect(navigation.getCurrentRoute()?.params).toEqual({ offline: true });
    expect(InAppBrowser.open).not.toHaveBeenCalled();
  });

  it('opens the checkout in the system browser when the sheet refuses (Android "No activity")', async () => {
    (InAppBrowser.open as jest.Mock).mockRejectedValueOnce(new Error('No activity'));
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('get-pro'));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledTimes(1));
    expect((Linking.openURL as jest.Mock).mock.calls[0][0]).toBe(
      (InAppBrowser.open as jest.Mock).mock.calls[0][0],
    );
    expect(onScreen()).toBe('Home');
  });

  it('opens the Pro page when neither the sheet nor the browser can open', async () => {
    (InAppBrowser.open as jest.Mock).mockRejectedValueOnce(new Error('No activity'));
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('no browser'));
    const { getByTestId } = render(<Probe />);
    fireEvent.press(getByTestId('get-pro'));
    await waitFor(() => expect(onScreen()).toBe('ProDetail'));
    expect(navigation.getCurrentRoute()?.params).toBeUndefined();
  });
});
