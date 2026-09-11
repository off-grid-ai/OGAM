/**
 * Advanced Setup rendered through the real Mobile composition root.
 *
 * Everything owned by Off Grid is real: the screen, child screens, components, stores,
 * services, and Shared application. Only native device I/O, HTTP, and navigation are boundaries.
 */
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { GB, installNativeBoundary } from '../../harness/nativeBoundary';

describe('ModelDownloadScreen real composition', () => {
  let fixture: MobileApplicationFixture;
  let rtl: typeof import('@testing-library/react-native');
  let React: typeof import('react');
  let AdvancedSetupScreen: typeof import('../../../src/screens/ModelDownloadScreen').AdvancedSetupScreen;
  let navigation: {
    navigate: jest.Mock;
    replace: jest.Mock;
    goBack: jest.Mock;
  };
  let mounted: ReturnType<typeof rtl.render> | undefined;
  const realFetch = global.fetch;

  beforeAll(async () => {
    installNativeBoundary({
      download: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    global.fetch = jest.fn(
      async () =>
        new Response('{}', {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await require('@react-native-async-storage/async-storage').clear();

    React = require('react') as typeof import('react');
    const { requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    rtl = requireRTL();
    ({ AdvancedSetupScreen } =
      require('../../../src/screens/ModelDownloadScreen') as typeof import('../../../src/screens/ModelDownloadScreen'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
  });

  afterAll(async () => {
    await fixture.dispose();
    global.fetch = realFetch;
  });

  beforeEach(() => {
    navigation = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
  });

  const renderScreen = () =>
    (mounted = rtl.render(
      React.createElement(AdvancedSetupScreen, {
        navigation: navigation as never,
      }),
    ));

  it('renders the complete Advanced Setup composition after device analysis', async () => {
    const ui = renderScreen();

    await rtl.waitFor(() =>
      expect(ui.getByTestId('model-download-screen')).toBeTruthy(),
    );
    expect(ui.getByText('Advanced Setup')).toBeTruthy();
    expect(
      ui.getByText('Run a model from your network or on this device.'),
    ).toBeTruthy();
    expect(ui.getByText('Network Models')).toBeTruthy();
    expect(ui.getByText('On This Device')).toBeTruthy();
    expect(ui.getByTestId('embedded-models-screen')).toBeTruthy();
    expect(ui.getByText('Your Device')).toBeTruthy();
    expect(ui.getByText('Total Memory')).toBeTruthy();
  });

  it('continues to Main when the user skips advanced setup', async () => {
    const ui = renderScreen();
    const skip = await ui.findByTestId('model-download-skip');

    rtl.fireEvent.press(skip);

    expect(navigation.replace).toHaveBeenCalledWith('Main');
  });
});
