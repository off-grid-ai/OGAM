/**
 * Device information — the phone's model, system, memory and tier.
 *
 * The real screen runs on a real stack navigator with the real hardwareService and app store. Only
 * the device is faked: react-native-device-info (model, system, total RAM) and the per-process memory
 * sensor (DeviceMemoryModule), through nativeBoundary. The device read reaches the store the way the
 * app's Home screen records it at launch (hardwareService.getDeviceInfo → setDeviceInfo).
 */
jest.unmock('@react-navigation/native');

import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

async function mount(opts: { totalGB: number; availGB: number }) {
  installNativeBoundary({ ram: { platform: 'android', totalBytes: opts.totalGB * GB, availBytes: opts.availGB * GB } });
  const DeviceInfo = require('react-native-device-info');
  DeviceInfo.getModel = jest.fn(() => 'Pixel 7');
  DeviceInfo.getSystemName = jest.fn(() => 'Android');
  DeviceInfo.getSystemVersion = jest.fn(() => '14');

  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores/appStore');
  useAppStore.getState().setDeviceInfo(await hardwareService.getDeviceInfo());

  const React = require('react');
  const rtl = requireRTL();
  const nav = require('@react-navigation/native');
  const { createNativeStackNavigator } = require('@react-navigation/native-stack');
  const { Text } = require('react-native');
  const { DeviceInfoScreen } = require('../../../src/screens/DeviceInfoScreen');
  const Stack = createNativeStackNavigator();
  const ref = nav.createNavigationContainerRef();
  const SettingsStub = () => React.createElement(Text, null, 'Settings screen');
  const view = rtl.render(
    React.createElement(
      nav.NavigationContainer,
      { ref },
      React.createElement(
        Stack.Navigator,
        { initialRouteName: 'Settings' },
        React.createElement(Stack.Screen, { name: 'Settings', component: SettingsStub }),
        React.createElement(Stack.Screen, { name: 'DeviceInfo', component: DeviceInfoScreen }),
      ),
    ),
  );
  rtl.act(() => { ref.navigate('DeviceInfo'); });
  return { rtl, view, route: () => ref.getCurrentRoute()?.name };
}

type Rtl = ReturnType<typeof requireRTL>;

/** The row (the label's View) that holds this label and its value. */
function row(rtl: Rtl, view: ReturnType<Rtl['render']>, label: string) {
  const { View } = require('react-native');
  let node = view.getByText(label).parent;
  while (node && node.type !== View) node = node.parent;
  return rtl.within(node!);
}

describe('DeviceInfoScreen', () => {
  it('shows the phone\'s model, system, total RAM and live process memory', async () => {
    const { rtl, view } = await mount({ totalGB: 8, availGB: 5 });

    expect(view.getByText('Device Information')).toBeTruthy();
    expect(row(rtl, view, 'Model').getByText('Pixel 7')).toBeTruthy();
    expect(row(rtl, view, 'System').getByText('Android 14')).toBeTruthy();
    expect(row(rtl, view, 'Memory').getByText('8.0 GB')).toBeTruthy();
    await rtl.waitFor(() => expect(row(rtl, view, 'Free now').getByText('5.0 GB')).toBeTruthy());
    expect(row(rtl, view, 'Used by Off Grid AI').getByText('3.0 GB')).toBeTruthy();
    expect(row(rtl, view, 'Off Grid AI can use up to').getByText('8.0 GB')).toBeTruthy();
    expect(view.queryByText('…')).toBeNull();
  });

  it.each([
    [3, 'Low'],
    [5, 'Medium'],
    [7, 'High'],
    [12, 'Flagship'],
  ])('a %i GB phone is in the %s tier', async (totalGB, tier) => {
    const { rtl, view } = await mount({ totalGB, availGB: 1 });

    expect(row(rtl, view, 'Phone class').getByText(tier)).toBeTruthy();
    // The compatibility list names every tier; this phone's row names just one.
    for (const name of ['Low', 'Medium', 'High', 'Flagship']) expect(view.getAllByText(name).length).toBeGreaterThanOrEqual(1);
  });

  it('Back returns to the screen it was opened from', async () => {
    const { rtl, view, route } = await mount({ totalGB: 8, availGB: 5 });
    expect(route()).toBe('DeviceInfo');

    rtl.fireEvent.press(view.getByLabelText('Back'));

    await rtl.waitFor(() => expect(route()).toBe('Settings'));
  });
});
