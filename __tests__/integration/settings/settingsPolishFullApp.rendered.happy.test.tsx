/** P2 #156/#161/#176-179 and APP-P2-012/013 — Settings polish through the real App. */
import { Dimensions, Text } from 'react-native';
import { renderMainApp } from '../../harness/appJourney';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

afterEach(() => {
  jest.clearAllMocks();
});

describe('P2 full-App Settings polish journeys', () => {
  it('applies every appearance mode and keeps the Settings surface usable after rotation', async () => {
    const app = await renderMainApp();
    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));

    for (const mode of ['dark', 'light', 'system'] as const) {
      app.rtl.fireEvent.press(app.view.getByTestId(`theme-${mode}`));
      await app.rtl.waitFor(() =>
        expect(
          app.view.getByTestId(`theme-${mode}`).props.accessibilityState,
        ).toEqual({
          selected: true,
        }),
      );
    }

    app.rtl.act(() => {
      Dimensions.set({
        window: { width: 844, height: 390, scale: 2, fontScale: 1 },
        screen: { width: 844, height: 390, scale: 2, fontScale: 1 },
      });
    });
    expect(app.view.getByText('Appearance')).toBeTruthy();
    expect(app.view.getByText('Stay in the loop')).toBeTruthy();
    expect(app.view.getByText('About')).toBeTruthy();
    app.view.unmount();
  });

  it('keeps community actions above About, opens exact destinations, and reports handler failure', async () => {
    const app = await renderMainApp();
    const { Alert, Linking } =
      require('react-native') as typeof import('react-native');
    const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alert = jest.spyOn(Alert, 'alert');
    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));

    const visibleText = app.view
      .UNSAFE_getAllByType(Text)
      .map(node => node.props.children)
      .filter((value): value is string => typeof value === 'string');
    expect(visibleText.indexOf('Stay in the loop')).toBeLessThan(
      visibleText.indexOf('About'),
    );

    app.rtl.fireEvent.press(app.view.getByTestId('follow-on-x'));
    app.rtl.fireEvent.press(app.view.getByTestId('join-slack'));
    app.rtl.fireEvent.press(app.view.getByText('Share on X'));
    await app.rtl.waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith('https://x.com/alichherawalla');
      expect(openUrl).toHaveBeenCalledWith(
        expect.stringContaining('https://join.slack.com/t/off-grid-mobile/'),
      );
      expect(openUrl).toHaveBeenCalledWith(
        expect.stringContaining('https://x.com/intent/post?text='),
      );
    });

    openUrl.mockRejectedValueOnce(new Error('No URL handler'));
    app.rtl.fireEvent.press(app.view.getByText('Star on GitHub'));
    await app.rtl.waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        'Could Not Open Link',
        expect.stringContaining('github.com/off-grid-ai/mobile'),
        [{ text: 'OK' }],
      ),
    );
    app.view.unmount();
  });

  it('views, exports, and clears redacted debug logs', async () => {
    installNativeBoundary();
    const React = require('react') as typeof import('react');
    const rtl = requireRTL();
    const { Share } = require('react-native') as typeof import('react-native');
    const { DebugLogsScreen } =
      require('../../../src/components/DebugLogsScreen') as typeof import('../../../src/components/DebugLogsScreen');
    const { useDebugLogsStore } =
      require('../../../src/stores/debugLogsStore') as typeof import('../../../src/stores/debugLogsStore');
    useDebugLogsStore.getState().addLog({
      timestamp: Date.now(),
      level: 'warn',
      message:
        'Authorization: Bearer live-secret-token access_token=another-secret',
    });
    const share = jest.spyOn(Share, 'share').mockResolvedValue({
      action: Share.sharedAction,
    });
    const view = rtl.render(
      React.createElement(DebugLogsScreen, {
        visible: true,
        onClose: jest.fn(),
      }),
    );

    await rtl.waitFor(() => {
      expect(view.getAllByText(/\[REDACTED\]/).length).toBeGreaterThan(0);
      expect(view.queryByText(/live-secret-token|another-secret/)).toBeNull();
    });

    rtl.fireEvent.press(view.getByText('Share'));
    await rtl.waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const exported = String(share.mock.calls[0][0].message);
    expect(exported).toContain('[REDACTED]');
    expect(exported).not.toMatch(/live-secret-token|another-secret/);

    rtl.fireEvent.press(view.getByText('Clear'));
    await rtl.waitFor(() => expect(view.getByText('No logs yet')).toBeTruthy());
    view.unmount();
  });
});
