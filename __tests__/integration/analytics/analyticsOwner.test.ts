/**
 * The analytics owner over its real stores and the real SDK, with only device boundaries faked
 * (PostHog at `fetch`, the JS runtime's global error handler, device-info, the disk). Each case
 * reports a fact the way its seam does and checks what reaches PostHog — the network is the
 * terminal surface for these events (docs/ANALYTICS.md).
 */
import { GB, installNativeBoundary, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { installPostHogEndpoint, type PostHogEndpoint } from '../../harness/postHogEndpoint';
import { restoreBuildFlavor } from '../../harness/analyticsApp';

type Analytics = typeof import('../../../src/services/analytics/analytics');

interface Rig {
  boundary: NativeBoundary;
  endpoint: PostHogEndpoint;
  analytics: Analytics;
  stop: () => void;
  flush: () => Promise<void>;
  errorHandler: () => (error: unknown, isFatal?: boolean) => void;
}

let rig: Rig | undefined;

afterEach(async () => {
  rig?.stop();
  await new Promise(resolve => setTimeout(resolve, 50));
  rig?.endpoint.restore();
  rig = undefined;
  restoreBuildFlavor();
});

/** The JS runtime's global error handler (Hermes ErrorUtils), which the SDK hooks for crashes. */
function installErrorUtils() {
  let handler: (error: unknown, isFatal?: boolean) => void = () => {};
  (global as unknown as { ErrorUtils: unknown }).ErrorUtils = {
    setGlobalHandler: (next: typeof handler) => {
      handler = next;
    },
    getGlobalHandler: () => handler,
  };
  return () => handler;
}

async function setup(
  consent: { usage?: boolean; crashes?: boolean } | null,
  device: { platform?: 'ios' | 'android'; deviceHardware?: string; socModel?: string } = {},
): Promise<Rig> {
  (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  const boundary = installNativeBoundary({
    fs: true,
    ram: { platform: device.platform ?? 'android', totalBytes: 8 * GB, availBytes: 4 * GB },
    deviceHardware: device.deviceHardware,
    socModel: device.socModel,
  });
  const errorHandler = installErrorUtils();
  const endpoint = installPostHogEndpoint();
  // The App starts analytics only once its settings are read from disk.
  await require('../../../src/stores/appStore').useAppStore.persist.rehydrate();
  const analytics: Analytics = require('../../../src/services/analytics/analytics');
  const { featureSnapshot } = require('../../../src/services/analytics/featureSnapshot');
  const stop = analytics.startAnalytics(featureSnapshot);
  if (consent) await analytics.setAnalyticsConsent(consent, 'settings');
  const flush = async () => {
    boundary.emitAppStateChange('background');
    await new Promise(resolve => setTimeout(resolve, 30));
  };
  rig = { boundary, endpoint, analytics, stop, flush, errorHandler };
  return rig;
}

const waitFor = async (check: () => void) => {
  await requireRTL().waitFor(check);
};

it('with Crash reports only, usage events are dropped and a crash arrives scrubbed', async () => {
  const { analytics, endpoint, flush, errorHandler } = await setup({ crashes: true });
  analytics.featureUsed('tools');
  const error = new TypeError('Cannot open "/Users/me/Diary.txt": my secret words');
  error.stack = 'TypeError: Cannot open\n    at openFile (/Users/me/app/index.bundle:10:3)';
  errorHandler()(error, false);
  await flush();
  await waitFor(() => expect(endpoint.named('$exception')).toHaveLength(1));
  expect(endpoint.named('feature_used')).toEqual([]);
  expect(endpoint.named('analytics_opted_in')).toEqual([]);
  const crash = endpoint.named('$exception')[0].properties;
  const sent = JSON.stringify(crash);
  expect(sent).not.toMatch(/secret|Diary|\/Users\/me/);
  expect(crash.platform).toBe('android');
  const [exception] = crash.$exception_list as Array<{ type: string; value: string }>;
  expect(exception).toMatchObject({ type: 'TypeError', value: 'Cannot open' });
});

it('turning Crash reports off keeps usage flowing on a rebuilt client with the same ID', async () => {
  const { analytics, endpoint, flush } = await setup({ usage: true, crashes: true });
  analytics.track('chat_created');
  await flush();
  await waitFor(() => expect(endpoint.named('chat_created')).toHaveLength(1));
  await analytics.setAnalyticsConsent({ crashes: false }, 'settings');
  analytics.track('project_created');
  await flush();
  await waitFor(() => expect(endpoint.named('project_created')).toHaveLength(1));
  expect(endpoint.named('project_created')[0].distinct_id).toBe(endpoint.named('chat_created')[0].distinct_id);
});

it('reports every action, flow and Pro funnel step with only the spec properties', async () => {
  const { analytics, endpoint, flush } = await setup({ usage: true });
  analytics.featureUsed('web_search');
  analytics.documentAdded('pdf', 3 * GB);
  analytics.track('problem_reported');
  analytics.flowStep('model_transfer', 'device_picked');
  analytics.flowFinished('model_transfer', 'done');
  analytics.flowStarted('connector_add', 'opened');
  analytics.flowStep('connector_add', 'opened');
  analytics.flowStep('connector_add', 'connector_picked', { connector: 'custom' });
  analytics.flowFinished('connector_add', 'failed', Object.assign(new Error('x'), { code: 'oauth_denied' }));
  analytics.flowStarted('sync_pairing');
  analytics.flowFinished('sync_pairing', 'cancelled');
  analytics.proGateShown('sync');
  analytics.proPaywallViewed();
  analytics.proPurchased();
  analytics.proPaywallViewed();
  analytics.proPurchased();
  await flush();
  await waitFor(() => expect(endpoint.named('flow_finished')).toHaveLength(4));
  expect(endpoint.named('feature_used')[0].properties.feature).toBe('web_search');
  expect(endpoint.named('document_added')[0].properties).toMatchObject({ file_type: 'pdf', size_bucket: '2-4GB' });
  expect(endpoint.named('problem_reported')).toHaveLength(1);
  const finished = endpoint.named('flow_finished').map(e => e.properties);
  expect(finished.map(f => [f.flow, f.outcome, f.failed_step, f.error_code])).toEqual([
    ['connector_add', 'failed', 'connector_picked', 'oauth_denied'],
    ['sync_pairing', 'cancelled', undefined, undefined],
    ['pro_upgrade', 'done', undefined, undefined],
    ['pro_upgrade', 'done', undefined, undefined],
  ]);
  const steps = endpoint.named('flow_step').map(e => [e.properties.flow, e.properties.step, e.properties.feature ?? e.properties.connector]);
  expect(steps).toEqual([
    ['connector_add', 'opened', undefined],
    ['connector_add', 'connector_picked', 'custom'],
    ['pro_upgrade', 'gate_shown', 'sync'],
    ['pro_upgrade', 'paywall_viewed', undefined],
    ['pro_upgrade', 'purchased', undefined],
    ['pro_upgrade', 'paywall_viewed', undefined],
    ['pro_upgrade', 'purchased', undefined],
  ]);
});

it('downloads report start, finish speed, failure, and the image, voice and video setup funnels', async () => {
  const { analytics, endpoint, flush } = await setup({ usage: true });
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  const entry = (modelKey: string, modelType: string, downloadId: string) => ({
    modelKey, downloadId, modelId: modelType === 'image' ? 'anythingv5_cpu' : 'ggml-org/SmolVLM-GGUF',
    fileName: 'f', quantization: modelType === 'text' ? 'Q4_K_M' : '', modelType, status: 'pending',
    bytesDownloaded: 0, totalBytes: 1.5 * GB, combinedTotalBytes: 0, progress: 0, createdAt: 0,
  });
  analytics.flowStarted('image_setup', 'opened');
  useDownloadStore.getState().add(entry('image:a', 'image', 'd1'));
  useDownloadStore.getState().setCompleted('d1');
  useDownloadStore.getState().add(entry('text:b', 'text', 'd2'));
  useDownloadStore.getState().setStatus('d2', 'failed', { message: 'disk full at /data/x', code: 'disk_full' });
  useDownloadStore.getState().retryEntry('text:b', 'd3');
  useDownloadStore.getState().setStatus('d3', 'completed');
  analytics.downloadEnded('never-started', 'done');
  useDownloadStore.getState().setCompleted('unknown-id');
  analytics.flowStarted('voice_setup', 'opened');
  analytics.downloadStarted('tts:kokoro', { model: 'kokoro', modelType: 'tts' });
  analytics.downloadEnded('tts:kokoro', 'done');
  analytics.flowStarted('video_setup', 'opened');
  analytics.downloadStarted('video:wan', { model: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', modelType: 'video' });
  analytics.downloadEnded('video:wan', 'done');
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('model_download_finished')).toHaveLength(4));
  expect(endpoint.named('model_download_started')).toHaveLength(5);
  const failed = endpoint.named('model_download_failed')[0].properties;
  expect(failed).toMatchObject({ model: 'ggml-org/SmolVLM-GGUF', quant: 'Q4_K_M', size_bucket: '1-2GB', network: 'unknown', error_code: 'disk_full' });
  expect(JSON.stringify(failed)).not.toContain('/data/x');
  const done = endpoint.named('model_download_finished')[0].properties;
  expect(done.model).toBe('anythingv5_cpu');
  expect(typeof done.free_storage_gb).toBe('number');
  expect(endpoint.named('model_download_finished')[2].properties.mb_per_sec).toBeUndefined();
  const funnels = endpoint.named('flow_finished').map(e => e.properties.flow);
  expect(funnels).toEqual(['image_setup', 'voice_setup', 'video_setup']);
});

it('reports the spec properties when the device cannot say its chip, memory or battery', async () => {
  const { analytics, endpoint, flush } = await setup(null);
  // Before opting in a download is not tracked at all, so its end later sends nothing.
  analytics.downloadStarted('text:early', { model: 'custom', modelType: 'text' });
  const DeviceInfo = require('react-native-device-info');
  DeviceInfo.getTotalMemory.mockRejectedValueOnce(new Error('unavailable'));
  DeviceInfo.getPowerState.mockRejectedValue(new Error('unavailable'));
  DeviceInfo.getHardware.mockRejectedValueOnce(new Error('unavailable'));
  await analytics.setAnalyticsConsent({ usage: true }, 'settings');
  analytics.downloadEnded('text:early', 'done');
  await expect(analytics.trackModelLoad({ model: 'custom', engine: 'llama.cpp', backend: 'cpu' }, async () => 'ok')).resolves.toBe('ok');
  analytics.generationStarted('image', { model: 'custom', engine: 'onnx', backend: 'npu' })('stopped');
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(1));
  await waitFor(() => expect(endpoint.named('model_loaded')).toHaveLength(1));
  expect(endpoint.named('model_loaded')[0].properties.soc).toBe('unknown');
  const generation = endpoint.named('generation_finished')[0].properties;
  expect(generation).toMatchObject({ modality: 'image', outcome: 'stopped' });
  expect(generation.battery_pct).toBeUndefined();
  expect(generation.charging).toBeUndefined();
  expect(endpoint.named('model_download_finished')).toEqual([]);
  DeviceInfo.getPowerState.mockResolvedValue({ batteryLevel: 0.64, batteryState: 'unplugged', lowPowerMode: false });
});

it('a cold launch or a system dialog (inactive, then active) is not a new app open', async () => {
  const { endpoint, flush, boundary } = await setup({ usage: true });
  boundary.emitAppStateChange('inactive');
  boundary.emitAppStateChange('active');
  boundary.emitAppStateChange('inactive');
  boundary.emitAppStateChange('active');
  await flush();
  await waitFor(() => expect(endpoint.named('app_backgrounded')).toHaveLength(1));
  expect(endpoint.named('app_opened')).toHaveLength(1);
  boundary.emitAppStateChange('active');
  await flush();
  await waitFor(() => expect(endpoint.named('app_backgrounded')).toHaveLength(2));
  expect(endpoint.named('app_opened')).toHaveLength(2);
});

it('sends a daily features snapshot once per day and survives unreadable storage', async () => {
  const { analytics, endpoint, flush, boundary } = await setup({ usage: true });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  boundary.emitAppStateChange('active');
  boundary.emitAppStateChange('background');
  boundary.emitAppStateChange('active');
  analytics.trackScreen('HomeTab');
  boundary.emitAppStateChange('background');
  boundary.emitAppStateChange('background');
  boundary.emitAppStateChange('active');
  analytics.trackScreen('HomeTab');
  analytics.trackScreen(undefined);
  analytics.trackScreen('Settings');
  AsyncStorage.getItem.mockRejectedValueOnce(new Error('unreadable'));
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('unwritable'));
  await AsyncStorage.removeItem('offgrid.analytics.snapshotDay');
  boundary.emitAppStateChange('background');
  boundary.emitAppStateChange('active');
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('$screen')).toHaveLength(2));
  const snapshots = endpoint.named('features_snapshot');
  expect(snapshots.length).toBeGreaterThanOrEqual(1);
  expect(snapshots[0].properties).toMatchObject({ voice_input: false, image_generation: false, vision: false, web_search: true, tools: true, remote_server: false });
  const [home, settings] = endpoint.named('$screen').map(e => e.properties);
  expect(home).toMatchObject({ screen: 'HomeTab' });
  expect(home.prev_screen).toBeUndefined();
  expect(settings).toMatchObject({ screen: 'Settings', prev_screen: 'HomeTab' });
  expect(typeof settings.prev_ms).toBe('number');
});

it('a corrupt unclean-exit marker from the last launch is ignored and cleared', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.setItem('offgrid.analytics.uncleanExit', '{not json');
  const { endpoint, flush } = await setup({ usage: true, crashes: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('analytics_opted_in')).toHaveLength(1));
  expect(endpoint.named('unclean_exit')).toEqual([]);
  expect(await AsyncStorage.getItem('offgrid.analytics.uncleanExit')).toBeNull();
});

it('every event says tablet, Pro and the chip as the device reports them', async () => {
  const { analytics, endpoint, flush } = await setup(null, { platform: 'ios' });
  const DeviceInfo = require('react-native-device-info');
  DeviceInfo.isTablet.mockReturnValue(true);
  const { useAppStore } = require('../../../src/stores/appStore');
  // A Pro change before opting in has no client to tell.
  useAppStore.getState().setHasRegisteredPro(true);
  await analytics.setAnalyticsConsent({ usage: true }, 'settings');
  useAppStore.getState().setHasRegisteredPro(false);
  useAppStore.getState().setHasRegisteredPro(true);
  await analytics.trackModelLoad({ model: 'custom', engine: 'llama.cpp', backend: 'gpu' }, async () => undefined);
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('model_loaded')).toHaveLength(1));
  DeviceInfo.isTablet.mockReturnValue(false);
  const loaded = endpoint.named('model_loaded')[0].properties;
  expect(loaded).toMatchObject({ device_class: 'tablet', pro: true, platform: 'ios' });
  expect(String(loaded.soc)).toMatch(/^A1\d/);
});

it('a Snapdragon with an NPU names its generation, and a load failure is reported and rethrown', async () => {
  const { analytics, endpoint, flush } = await setup({ usage: true }, { deviceHardware: 'qcom', socModel: 'SM8650' });
  const failure = Object.assign(new Error('out of memory at /data/x'), { code: 'oom' });
  await expect(
    analytics.trackModelLoad({ model: 'custom', engine: 'llama.cpp', backend: 'npu' }, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('model_load_failed')).toHaveLength(1));
  const failed = endpoint.named('model_load_failed')[0].properties;
  expect(failed.soc).toBe('qualcomm-8gen2');
  expect(failed.error_code).toBe('oom');
});

it('each generation ends once; voice generations finish without an unclean-exit marker', async () => {
  const { analytics, endpoint, flush } = await setup({ usage: true });
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const text = analytics.generationStarted('text', { model: 'custom', engine: 'llama.cpp', backend: 'cpu' });
  let finishLoad: () => void = () => {};
  const load = analytics.trackModelLoad({ model: 'custom', engine: 'llama.cpp', backend: 'cpu' }, () =>
    new Promise<void>(resolve => {
      finishLoad = resolve;
    }),
  );
  // The reply ends while a newer load holds the marker: the load's marker stays.
  text('failed', { error: Object.assign(new Error('x'), { code: 'context_full' }) });
  text('done');
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(JSON.parse(await AsyncStorage.getItem('offgrid.analytics.uncleanExit')).stage).toBe('load');
  finishLoad();
  await load;
  const stt = analytics.generationStarted('stt', { model: 'base.en', engine: 'whisper', backend: 'cpu' });
  expect(await AsyncStorage.getItem('offgrid.analytics.uncleanExit')).toBeNull();
  stt('done');
  await new Promise(resolve => setTimeout(resolve, 20));
  await flush();
  await waitFor(() => expect(endpoint.named('generation_finished')).toHaveLength(2));
  const [first, voice] = endpoint.named('generation_finished').map(e => e.properties);
  expect(first).toMatchObject({ modality: 'text', outcome: 'failed', error_code: 'context_full' });
  expect(voice).toMatchObject({ modality: 'stt', outcome: 'done' });
  expect(voice.error_code).toBeUndefined();
});

it('time on a screen stops while the app is in the background', async () => {
  const { analytics, endpoint, flush, boundary } = await setup({ usage: true });
  boundary.emitAppStateChange('background');
  boundary.emitAppStateChange('active');
  analytics.trackScreen('HomeTab');
  boundary.emitAppStateChange('background');
  analytics.trackScreen('Chat');
  await flush();
  await waitFor(() => expect(endpoint.named('$screen')).toHaveLength(2));
  expect(endpoint.named('$screen')[1].properties).toMatchObject({ screen: 'Chat', prev_screen: 'HomeTab' });
});

it('a failed model download asks someone who has not opted in, and sends nothing', async () => {
  const { endpoint, flush } = await setup(null);
  const React = require('react');
  const { render, act } = requireRTL();
  const { AnalyticsConsentPrompt } = require('../../../src/components/AnalyticsConsentPrompt');
  const prompt = render(React.createElement(AnalyticsConsentPrompt));
  expect(prompt.queryByText('Help us fix this?')).toBeNull();
  const { useDownloadStore } = require('../../../src/stores/downloadStore');
  await act(async () => {
    useDownloadStore.getState().add({
      modelKey: 'text:b', downloadId: 'd9', modelId: 'ggml-org/SmolVLM-GGUF', fileName: 'f', quantization: 'Q4_K_M',
      modelType: 'text', status: 'pending', bytesDownloaded: 0, totalBytes: GB, combinedTotalBytes: 0, progress: 0, createdAt: 0,
    });
    useDownloadStore.getState().setStatus('d9', 'failed', { message: 'network lost', code: 'network' });
  });
  expect(await prompt.findByText('Help us fix this?')).toBeTruthy();
  await flush();
  expect(endpoint.named('model_download_failed')).toHaveLength(0);
  prompt.unmount();
});
