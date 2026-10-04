import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

const SAVED_ENDPOINT = 'http://192.168.1.2:11434';
const FOUND_ENDPOINT = 'http://192.168.1.30:7878/v1';
let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

describe('persisted remote settings survive Home remount and later scan', () => {
  it('keeps the saved server and adds the LAN server to the public snapshot and rendered list', async () => {
    installNativeBoundary();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem(
      'remote-servers',
      JSON.stringify({
        state: {
          servers: [{
            id: 'saved-gateway',
            name: 'Saved gateway',
            endpoint: SAVED_ENDPOINT,
            provider: 'ollama',
            createdAt: '2026-09-05T00:00:00.000Z',
          }],
        },
        version: 4,
      }),
    );

    const React = require('react');
    const rtl = requireRTL();
    const { NavigationContainer } = require('@react-navigation/native');
    const { createNativeStackNavigator } = require('@react-navigation/native-stack');
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const { RemoteServersScreen } = require('../../../src/screens/RemoteServersScreen');
    const Stack = createNativeStackNavigator();
    const App = () => React.createElement(
      NavigationContainer,
      null,
      React.createElement(
        Stack.Navigator,
        { initialRouteName: 'Home', screenOptions: { headerShown: false } },
        React.createElement(Stack.Screen, { name: 'Home', component: HomeScreen }),
        React.createElement(Stack.Screen, { name: 'RemoteServers', component: RemoteServersScreen }),
      ),
    );
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();

    const first = rtl.render(React.createElement(App));
    await rtl.waitFor(() => expect(first.getByTestId('home-screen')).toBeTruthy());
    first.unmount();

    const second = rtl.render(React.createElement(App));
    await rtl.waitFor(() => expect(second.getByTestId('home-screen')).toBeTruthy());
    rtl.fireEvent.press(second.getByTestId('add-server-button'));
    await rtl.waitFor(() => expect(second.getByText('Saved gateway')).toBeTruthy());

    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => '192.168.1.10');
    const { installLanProbe, gatewayModelList } =
      require('../../harness/lanProbe') as typeof import('../../harness/lanProbe');
    const lan = installLanProbe({
      '192.168.1.30:7878': { paths: ['/v1/'], body: gatewayModelList },
    });
    try {
      rtl.fireEvent.press(second.getByTestId('scan-network'));
      await rtl.waitFor(
        () => expect(second.getByText(FOUND_ENDPOINT)).toBeTruthy(),
        { timeout: 8_000 },
      );
      expect(second.getByText('Saved gateway')).toBeTruthy();
      expect(
        fixture.application.models.snapshot().servers.map(server => server.endpoint),
      ).toEqual(expect.arrayContaining([SAVED_ENDPOINT, FOUND_ENDPOINT]));
    } finally {
      lan.uninstall();
      second.unmount();
    }
  }, 20_000);
});
