/**
 * An image the memory gate stopped reports why it failed. The real ChatScreen sends an image
 * request on a phone that cannot fit the image model, the real memory gate refuses the load, and
 * `generation_finished` reaches PostHog with the gate's error code, not the generic `error`.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';
import { installPostHogEndpoint, type PostHogEndpoint } from '../../harness/postHogEndpoint';
import { restoreBuildFlavor } from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

let endpoint: PostHogEndpoint | undefined;
let stop: (() => void) | undefined;

afterEach(async () => {
  stop?.();
  await new Promise(resolve => setTimeout(resolve, 50));
  endpoint?.restore();
  restoreBuildFlavor();
});

it('a failed image generation after a memory refusal reports OverridableMemoryError', async () => {
  const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'ios' });
  h.render();
  await h.placeImageModel({ backend: 'coreml' });
  await h.cycleImageMode();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

  (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  endpoint = installPostHogEndpoint();
  const analytics = require('../../../src/services/analytics/analytics');
  const { featureSnapshot } = require('../../../src/services/analytics/featureSnapshot');
  stop = analytics.startAnalytics(featureSnapshot);
  await analytics.setAnalyticsConsent({ usage: true }, 'settings');

  h.boundary.setRam({ platform: 'ios', totalBytes: 4 * GB, availBytes: 300 * 1024 * 1024 });
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.refreshMemoryInfo();

  await h.tapSend('a fox in the snow');
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('model-failure-load-anyway-image')).not.toBeNull(); });

  h.boundary.emitAppStateChange('background');
  await h.rtl.waitFor(() => expect(endpoint!.named('generation_finished')).toHaveLength(1));
  expect(endpoint.named('model_load_failed')[0].properties.error_code).toBe('OverridableMemoryError');
  expect(endpoint.named('generation_finished')[0].properties).toMatchObject({
    modality: 'image',
    outcome: 'failed',
    error_code: 'OverridableMemoryError',
  });
});
