/**
 * RENDERED (UI integration) — onboarding renders when HuggingFace metadata is still pending.
 *
 * REGRESSION (0.0.103): fresh installs remained on "Analyzing your device..." for roughly 75
 * seconds because the screen awaited every model-file metadata request before clearing its loader.
 *
 * SPEC (OGAM user's view): device analysis and local recommendations render immediately. Network
 * metadata may finish later and must never hold the onboarding screen hostage.
 *
 * Real ModelDownloadScreen + real hardwareService + real huggingFaceService. Fakes exist only at
 * the native RAM sensor and global fetch, the external network boundary.
 */
import {
  installNativeBoundary,
  requireRTL,
  GB,
} from '../../harness/nativeBoundary';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
    replace: () => {},
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('Onboarding device analysis — network metadata never gates the screen', () => {
  it('renders the setup screen while every HuggingFace file-list request is still pending', async () => {
    installNativeBoundary({
      ram: { platform: 'android', totalBytes: 11 * GB, availBytes: 4.57 * GB },
    });

    const pendingResponses: Array<() => void> = [];
    global.fetch = ((_input: RequestInfo | URL) =>
      new Promise<Response>(resolve => {
        pendingResponses.push(() =>
          resolve({ ok: true, json: async () => [] } as Response),
        );
      })) as typeof fetch;

    const React = require('react');
    const rtl = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const {
      ModelDownloadScreen,
    } = require('../../../src/screens/ModelDownloadScreen');

    await hardwareService.getDeviceInfo();

    const navigation: any = {
      navigate: () => {},
      goBack: () => {},
      setOptions: () => {},
      addListener: () => () => {},
      replace: () => {},
    };
    const view = rtl.render(
      React.createElement(ModelDownloadScreen, { navigation }),
    );

    // Terminal artifact: onboarding is usable even though no metadata response has completed.
    await rtl.waitFor(
      () => expect(view.getByText('Set Up Your AI')).toBeTruthy(),
      { timeout: 1500 },
    );
    expect(view.queryByText(/Analyzing your device/)).toBeNull();
    expect(pendingResponses.length).toBeGreaterThan(0);

    // Settle the boundary promises so this test leaves no timeout handles behind.
    await rtl.act(async () => {
      pendingResponses.forEach(resolve => resolve());
      await Promise.resolve();
    });
  }, 10000);
});
