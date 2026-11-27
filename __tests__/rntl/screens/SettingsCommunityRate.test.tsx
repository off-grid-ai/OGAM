/**
 * The Settings rate row names the store that installed the app and opens that store's page.
 * Boundary faked: the installer the system reports (react-native-device-info) and Linking.
 */
import React from 'react';
import { Linking, Platform } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getInstallerPackageName } from 'react-native-device-info';
import { SettingsCommunitySections } from '../../../src/screens/SettingsCommunitySections';
import { createStyles } from '../../../src/screens/SettingsScreen.styles';
import { useTheme } from '../../../src/theme';

const installer = getInstallerPackageName as jest.Mock;
const openURL = Linking.openURL as jest.Mock;
const originalPlatform = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });

function Host() {
  const theme = useTheme();
  return (
    <SettingsCommunitySections
      focusTrigger={0}
      styles={createStyles(theme.colors, theme.shadows)}
      colors={theme.colors}
      onSendFeedback={() => {}}
    />
  );
}

beforeEach(() => {
  setOS('android');
  openURL.mockReset().mockResolvedValue(undefined);
});
afterAll(() => setOS(originalPlatform));

it('a Galaxy Store install asks for a rating on the Galaxy Store', async () => {
  installer.mockResolvedValue('com.sec.android.app.samsungapps');
  render(<Host />);
  await waitFor(() => expect(screen.getByText('Rate Off Grid AI')).toBeTruthy());
  expect(screen.queryByText('Rate on Google Play')).toBeNull();
  fireEvent.press(screen.getByText('Rate Off Grid AI'));
  await waitFor(() => expect(openURL).toHaveBeenCalledWith('samsungapps://ProductDetail/ai.offgridmobile'));
});

it('a Play install keeps "Rate on Google Play"', async () => {
  installer.mockResolvedValue('com.android.vending');
  render(<Host />);
  await waitFor(() => expect(installer).toHaveBeenCalled());
  expect(screen.getByText('Rate on Google Play')).toBeTruthy();
});

it('iOS says "Rate on the App Store"', async () => {
  setOS('ios');
  render(<Host />);
  await waitFor(() => expect(screen.getByText('Rate on the App Store')).toBeTruthy());
});

it('leaving Settings before the installer answers changes nothing', async () => {
  let answer: (value: string) => void = () => {};
  installer.mockReturnValue(new Promise<string>(resolve => { answer = resolve; }));
  const { unmount } = render(<Host />);
  unmount();
  answer('com.sec.android.app.samsungapps');
  await Promise.resolve();
  expect(openURL).not.toHaveBeenCalled();
});
