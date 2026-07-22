/** P2 #139 — an empty LAN scan never creates a phantom remote server. */
import { renderMainApp } from '../../harness/appJourney';

describe('P2 empty LAN scan journey', () => {
  it('shows no-found feedback while the remote-server list stays empty', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockRejectedValue(new Error('Host unreachable'));

    try {
      const { rtl, view } = await renderMainApp({
        beforeRender: () => {
          // Device/network leaves only: keep the app's discovery, aggregation,
          // remote-server store, navigation, and presentation paths real.
          const deviceInfo = require('react-native-device-info');
          deviceInfo.isEmulator.mockResolvedValue(false);
          deviceInfo.getIpAddress = jest
            .fn()
            .mockResolvedValue('192.168.50.42');
        },
      });

      rtl.fireEvent.press(view.getByTestId('settings-tab'));
      rtl.fireEvent.press(
        await rtl.waitFor(() => view.getByText('Remote Servers')),
      );

      expect(view.getByText('No Remote Servers')).toBeTruthy();
      rtl.fireEvent.press(view.getByText('Scan Network'));

      await rtl.waitFor(
        () => {
          expect(view.getByText('No Servers Found')).toBeTruthy();
          expect(view.getByText('No Remote Servers')).toBeTruthy();
        },
        { timeout: 5000 },
      );

      view.unmount();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
