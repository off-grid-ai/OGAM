/**
 * session_summary, usage_snapshot and the fixed-value action events (docs/ANALYTICS.md), through the
 * real analytics owner, the real stores and the app's real touchables. Only device boundaries are
 * faked: PostHog at `fetch`, the disk, device-info and the OS app-state events. Each case does what
 * the person does and checks what reaches PostHog.
 */
import React from 'react';
import { GB, installNativeBoundary, requireRTL, type NativeBoundary } from '../../harness/nativeBoundary';
import { installPostHogEndpoint, type PostHogEndpoint } from '../../harness/postHogEndpoint';
import { restoreBuildFlavor } from '../../harness/analyticsApp';

type Analytics = typeof import('../../../src/services/analytics/analytics');

interface Rig {
  boundary: NativeBoundary;
  endpoint: PostHogEndpoint;
  analytics: Analytics;
  stop: () => void;
  background: () => Promise<void>;
}

let rigs: Rig[] = [];

afterEach(async () => {
  for (const rig of rigs) rig.stop();
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const rig of rigs) rig.endpoint.restore();
  rigs = [];
  restoreBuildFlavor();
});

/** Launch analytics as a store build. `relaunch` keeps the disk of the previous launch. */
async function launch(
  consent: { usage?: boolean; crashes?: boolean } | null,
  relaunch = false,
  usage?: () => Promise<Record<string, unknown>>,
): Promise<Rig> {
  (global as unknown as { __DEV__: boolean }).__DEV__ = false;
  const AsyncStorageBefore = require('@react-native-async-storage/async-storage');
  if (!relaunch) await AsyncStorageBefore.clear();
  const boundary = installNativeBoundary({
    fs: true,
    ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 4 * GB },
  });
  const endpoint = installPostHogEndpoint();
  await require('../../../src/stores/appStore').useAppStore.persist.rehydrate();
  const analytics: Analytics = require('../../../src/services/analytics/analytics');
  const { featureSnapshot } = require('../../../src/services/analytics/featureSnapshot');
  const { usageSnapshot } = require('../../../src/services/analytics/usageSnapshot');
  const stop = analytics.startAnalytics(featureSnapshot, usage ?? usageSnapshot);
  if (consent) await analytics.setAnalyticsConsent(consent, 'settings');
  await new Promise(resolve => setTimeout(resolve, 20));
  const background = async () => {
    boundary.emitAppStateChange('background');
    await new Promise(resolve => setTimeout(resolve, 30));
  };
  const rig = { boundary, endpoint, analytics, stop, background };
  rigs.push(rig);
  return rig;
}

const waitFor = async (check: () => void) => {
  await requireRTL().waitFor(check);
};

it('taps, a long-press, a switch, an error, a scroll, settings and a sheet add up to one summary that names no file', async () => {
  const { analytics, endpoint, background } = await launch({ usage: true });
  const rtl = requireRTL();
  const { TouchableOpacity, Switch } = require('../../../src/components/Touchable');
  const { AppSheet } = require('../../../src/components/AppSheet');
  const { CustomAlert } = require('../../../src/components/CustomAlert');
  const { reportScroll } = require('../../../src/services/analytics/interactions');
  const { useAppStore } = require('../../../src/stores/appStore');
  const onPress = jest.fn();
  let expectedDetails = '';

  analytics.trackScreen('KnowledgeBase');
  const view = rtl.render(
    <>
      <TouchableOpacity testID="kb-document-remove-My Diary 2024.pdf" onPress={onPress} onLongPress={() => {}} />
      <Switch testID="kb-document-toggle-Diary.pdf" value={false} onValueChange={() => {}} />
    </>,
  );
  const remove = view.getByTestId('kb-document-remove-My Diary 2024.pdf');
  rtl.fireEvent.press(remove);
  rtl.fireEvent.press(remove);
  rtl.fireEvent(remove, 'longPress');
  rtl.fireEvent(view.getByTestId('kb-document-toggle-Diary.pdf'), 'valueChange', true);
  reportScroll(0.3);
  reportScroll(0.6);
  reportScroll(0.1);
  rtl.act(() => {
    const details = !useAppStore.getState().settings.showGenerationDetails;
    useAppStore.getState().updateSettings({ showGenerationDetails: details, temperature: 0.2, systemPrompt: 'my secret plan' });
    expectedDetails = `show_generation_details=${details}`;
    useAppStore.getState().setThemeMode('dark');
  });
  const sheet = rtl.render(
    <AppSheet visible sheet="model-selector" onClose={() => {}}>
      <></>
    </AppSheet>,
  );
  sheet.unmount();
  rtl.render(<CustomAlert visible title="Download failed" message="Diary.pdf could not be read" />);
  await background();

  expect(onPress).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(endpoint.named('session_summary')).toHaveLength(1));
  const summary = endpoint.named('session_summary')[0].properties;
  expect(summary).toMatchObject({
    screens: 2,
    screen_views: 3,
    max_scroll_pct: { 'knowledge-base': 50 },
    actions: { 'knowledge-base:kb-document-remove': 2, 'knowledge-base:kb-document-toggle': 1 },
    long_press: { 'knowledge-base:kb-document-remove': 1 },
    errors_shown: { 'knowledge-base:alert': 1 },
    settings_changed: { [expectedDetails]: 1, temperature: 1, system_prompt: 1, 'theme=dark': 1 },
  });
  expect(typeof summary.session_ms).toBe('number');
  expect(JSON.stringify(summary)).not.toMatch(/Diary|secret|0\.2/);
  expect(endpoint.named('$screen').map(e => e.properties.screen)).toEqual([
    'knowledge-base',
    'knowledge-base:model-selector',
    'knowledge-base',
  ]);
  expect(endpoint.named('app_backgrounded')).toHaveLength(1);
});

it('a session the app was killed in is sent on the next launch, once, marked recovered', async () => {
  const first = await launch({ usage: true });
  const { countPress } = require('../../../src/services/analytics/interactions');
  first.analytics.trackScreen('Chat');
  countPress('stop-button');
  // The counters reach the disk a moment after the last tap.
  await new Promise(resolve => setTimeout(resolve, 1_100));
  // Killed: no trip to the background, so no summary went.
  expect(first.endpoint.named('session_summary')).toEqual([]);

  const second = await launch(null, true);
  await second.background();
  await waitFor(() => expect(second.endpoint.named('session_summary')).toHaveLength(2));
  const [recovered, current] = second.endpoint.named('session_summary').map(e => e.properties);
  expect(recovered).toMatchObject({ recovered: true, actions: { 'chat:stop-button': 1 }, screens: 1 });
  expect(current.recovered).toBeUndefined();
});

it('counts nothing and keeps nothing on disk before the person opts in', async () => {
  const { endpoint, background } = await launch(null);
  const { countPress } = require('../../../src/services/analytics/interactions');
  countPress('send-button');
  await background();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  expect(await AsyncStorage.getItem('offgrid.analytics.pendingSession')).toBeNull();
  expect(endpoint.events).toEqual([]);
});

it('sends a daily usage snapshot of bucketed counts and appearance, never names', async () => {
  const rig = await launch(null);
  const { useChatStore } = require('../../../src/stores/chatStore');
  const { useAppStore } = require('../../../src/stores/appStore');
  const chat = useChatStore.getState().createConversation('m', 'Divorce lawyer notes');
  for (let i = 0; i < 6; i += 1) {
    useChatStore.getState().addMessage(chat, { role: i % 2 ? 'assistant' : 'user', content: `secret ${i}` });
  }
  useAppStore.getState().setThemeMode('light');
  await rig.analytics.setAnalyticsConsent({ usage: true }, 'settings');
  // The snapshot goes when the app next comes to the front.
  await rig.background();
  rig.boundary.emitAppStateChange('active');
  await new Promise(resolve => setTimeout(resolve, 300));
  await rig.background();
  await waitFor(() => expect(rig.endpoint.named('usage_snapshot')).toHaveLength(1));
  const snapshot = rig.endpoint.named('usage_snapshot')[0].properties;
  expect(snapshot).toMatchObject({
    chats: 1,
    messages: 5,
    user_messages: 2,
    knowledge_documents: 0,
    generated_images: 0,
    models_text: 0,
    theme: 'light',
  });
  expect(typeof snapshot.font_scale).toBe('number');
  expect(JSON.stringify(snapshot)).not.toMatch(/Divorce|secret/);
});

it('reports model picks with where they were made, message copy and edit, deletes and the first message', async () => {
  const { analytics, endpoint, background } = await launch({ usage: true });
  const { activeModelService } = require('../../../src/services/activeModelService');
  analytics.trackScreen('ModelsTab');
  activeModelService.selectTextModel('local_import/My secret model.gguf');
  activeModelService.selectTextModel('local_import/My secret model.gguf');
  analytics.trackScreen('Chat');
  const { sheetShown } = require('../../../src/services/analytics/interactions');
  sheetShown('model-selector');
  activeModelService.selectTextModel('qwen3-0.6b');
  analytics.messageAction('copy');
  analytics.messageAction('edit');
  analytics.itemDeleted('chat');
  analytics.messageSent({ hasImage: false, hasDocument: false, toolsEnabled: false });
  analytics.messageSent({ hasImage: false, hasDocument: false, toolsEnabled: false });
  await new Promise(resolve => setTimeout(resolve, 20));
  await background();

  await waitFor(() => expect(endpoint.named('first_message')).toHaveLength(1));
  expect(endpoint.named('model_selected').map(e => e.properties)).toEqual([
    expect.objectContaining({ modality: 'text', model: 'custom', source: 'models_screen' }),
    expect.objectContaining({ modality: 'text', model: 'qwen3-0.6b', source: 'model_picker' }),
  ]);
  expect(endpoint.named('message_action').map(e => e.properties.action)).toEqual(['copy', 'edit']);
  expect(endpoint.named('item_deleted')[0].properties.item).toBe('chat');
  expect(endpoint.named('first_message')[0].properties).toMatchObject({ first_ever: true });
  expect(typeof endpoint.named('first_message')[0].properties.since_launch_ms).toBe('number');
});

it('Auto Setup shown before opt-in is sent when the person opts in there', async () => {
  const { analytics, endpoint, background } = await launch(null);
  analytics.flowStarted('onboarding', 'setup_shown');
  await analytics.setAnalyticsConsent({ usage: true, crashes: true }, 'setup');
  await background();
  await waitFor(() => expect(endpoint.named('flow_step')).toHaveLength(1));
  expect(endpoint.named('flow_started')[0].properties.flow).toBe('onboarding');
  expect(endpoint.named('flow_step')[0].properties).toMatchObject({ flow: 'onboarding', step: 'setup_shown' });
});

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

it('tabs, nested sheets and a tab picked under a sheet each show the right view; a tap before any screen counts as app', async () => {
  const { analytics, endpoint, background } = await launch({ usage: true });
  const { countPress, sheetShown, sheetHidden, subScreenShown } = require('../../../src/services/analytics/interactions');
  // Nothing is on screen yet: a sheet or a tab has no screen to belong to.
  sheetShown('model-selector');
  subScreenShown('text');
  countPress('send-button');
  analytics.trackScreen('ModelsTab');
  subScreenShown('text');
  subScreenShown('text');
  subScreenShown('');
  sheetShown('');
  sheetShown('catalog-check');
  sheetShown('model-selector');
  sheetHidden('model-selector');
  sheetHidden('never-opened');
  sheetHidden('');
  sheetHidden('catalog-check');
  subScreenShown('image');
  sheetShown('voice-models');
  subScreenShown('video');
  sheetHidden('voice-models');
  await background();

  await waitFor(() => expect(endpoint.named('session_summary')).toHaveLength(1));
  expect(endpoint.named('$screen').map(e => e.properties.screen)).toEqual([
    'models',
    'models:text',
    'models:catalog-check',
    'models:model-selector',
    'models:catalog-check',
    'models:text',
    'models:image',
    'models:voice-models',
    'models:video',
  ]);
  expect(endpoint.named('session_summary')[0].properties.actions).toEqual({ 'app:send-button': 1 });
});

it('a tap in the background is not counted, and a session that ended leaves nothing on disk', async () => {
  const { analytics, endpoint, background, boundary } = await launch({ usage: true });
  const { countPress } = require('../../../src/services/analytics/interactions');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  analytics.trackScreen('Chat');
  countPress('send-button');
  await background();
  countPress('send-button');
  await pause(1_100);
  expect(await AsyncStorage.getItem('offgrid.analytics.pendingSession')).toBeNull();
  boundary.emitAppStateChange('active');
  await background();
  await waitFor(() => expect(endpoint.named('session_summary')).toHaveLength(2));
  const [first, second] = endpoint.named('session_summary').map(e => e.properties);
  expect(first.actions).toEqual({ 'chat:send-button': 1 });
  expect(second.actions).toEqual({});
});

it('turning Anonymous stats off forgets the open session: nothing reaches the disk or PostHog', async () => {
  const { analytics, endpoint, background } = await launch({ usage: true });
  const { countPress } = require('../../../src/services/analytics/interactions');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  analytics.trackScreen('Chat');
  countPress('send-button');
  await analytics.setAnalyticsConsent({ usage: false, crashes: false }, 'settings');
  await pause(1_100);
  expect(await AsyncStorage.getItem('offgrid.analytics.pendingSession')).toBeNull();
  await background();
  expect(endpoint.named('session_summary')).toEqual([]);
});

it('a left-over session that is unreadable, empty, or from before opting out is dropped, not sent', async () => {
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const first = await launch({ usage: true });
  await first.background();
  for (const raw of ['{not json', '{}']) {
    await AsyncStorage.setItem('offgrid.analytics.pendingSession', raw);
    const next = await launch(null, true);
    await next.background();
    await waitFor(() => expect(next.endpoint.named('session_summary')).toHaveLength(1));
    expect(next.endpoint.named('session_summary')[0].properties.recovered).toBeUndefined();
    expect(await AsyncStorage.getItem('offgrid.analytics.pendingSession')).toBeNull();
  }
  // Opted out since: the counts of the old session are not sent.
  await first.analytics.setAnalyticsConsent({ usage: false, crashes: false }, 'settings');
  const left = { startedAt: 1_000, lastAt: 2_000, foregroundMs: 0, foregroundSince: 1_000, screens: ['chat'], screenViews: 1, maxScroll: {}, counters: { actions: { 'chat:send-button': 1 } } };
  await AsyncStorage.setItem('offgrid.analytics.pendingSession', JSON.stringify(left));
  const optedOut = await launch(null, true);
  await optedOut.background();
  await pause(50);
  expect(optedOut.endpoint.events).toEqual([]);
  expect(await AsyncStorage.getItem('offgrid.analytics.pendingSession')).toBeNull();
});

it('a usage snapshot that cannot be read is skipped; the features snapshot still goes', async () => {
  const rig = await launch(null, false, () => Promise.reject(new Error('database locked')));
  await rig.analytics.setAnalyticsConsent({ usage: true }, 'settings');
  await rig.background();
  rig.boundary.emitAppStateChange('active');
  await pause(300);
  await rig.background();
  await waitFor(() => expect(rig.endpoint.named('features_snapshot')).toHaveLength(1));
  expect(rig.endpoint.named('usage_snapshot')).toEqual([]);
});

it('opting in on Auto Setup sends only what the onboarding flow had: nothing, or its start without a step', async () => {
  const none = await launch(null);
  await none.analytics.setAnalyticsConsent({ usage: true }, 'setup');
  await none.background();
  await waitFor(() => expect(none.endpoint.named('analytics_opted_in')).toHaveLength(1));
  expect(none.endpoint.named('flow_started')).toEqual([]);

  const started = await launch(null);
  started.analytics.flowStarted('onboarding');
  await started.analytics.setAnalyticsConsent({ usage: true }, 'setup');
  await started.background();
  await waitFor(() => expect(started.endpoint.named('flow_started')).toHaveLength(1));
  expect(started.endpoint.named('flow_step')).toEqual([]);
});

it('image and video picks report where they were made, from setup, home, settings, video and elsewhere', async () => {
  const { analytics, endpoint, background } = await launch({ usage: true });
  const { useAppStore } = require('../../../src/stores/appStore');
  const pick = (screen: string, kind: 'image' | 'video', id: string) => {
    analytics.trackScreen(screen);
    if (kind === 'image') useAppStore.getState().setActiveImageModelId(id);
    else useAppStore.getState().setActiveVideoModelId(id);
  };
  // Before any screen is shown (a pick restored at launch).
  useAppStore.getState().setActiveVideoModelId('wan2.2-5b');
  pick('AutoSetup', 'image', 'sd-turbo');
  pick('HomeTab', 'image', 'anythingv5_cpu');
  pick('SettingsTab', 'video', 'wan2.2-5b-final');
  pick('ModelSettings', 'image', 'sd-turbo');
  pick('VideoStudio', 'video', 'ltx-video');
  pick('Gallery', 'image', 'local_my_import');
  useAppStore.getState().setActiveImageModelId(null);
  useAppStore.getState().setActiveVideoModelId(null);
  await background();
  await waitFor(() => expect(endpoint.named('model_selected')).toHaveLength(7));
  expect(endpoint.named('model_selected').map(e => [e.properties.modality, e.properties.model, e.properties.source])).toEqual([
    ['video', 'wan2.2-5b', 'unknown'],
    ['image', 'sd-turbo', 'setup'],
    ['image', 'anythingv5_cpu', 'home'],
    ['video', 'wan2.2-5b-final', 'settings'],
    ['image', 'sd-turbo', 'settings'],
    ['video', 'ltx-video', 'video'],
    ['image', 'custom', 'unknown'],
  ]);
});

it('the first message of a later launch is not the first ever; a video follow-on and a video clip report their facts', async () => {
  const first = await launch({ usage: true });
  first.analytics.messageSent({ hasImage: false, hasDocument: false, toolsEnabled: false });
  await pause(20);
  await first.background();
  await waitFor(() => expect(first.endpoint.named('first_message')).toHaveLength(1));

  const later = await launch(null, true);
  later.analytics.messageSent({ hasImage: false, hasDocument: false, toolsEnabled: false });
  later.analytics.videoAction('extend');
  const facts = { model: 'wan2.2-5b', engine: 'sd.cpp', backend: 'gpu' };
  later.analytics.generationStarted('video', facts)('done', { durationMs: 61_000, hasInitImage: true, quality: 'draft', story: true });
  later.analytics.generationStarted('video', facts)('failed', { error: Object.assign(new Error('x'), { code: 'out_of_memory' }) });
  await pause(50);
  await later.background();
  await waitFor(() => expect(later.endpoint.named('generation_finished')).toHaveLength(2));
  expect(later.endpoint.named('first_message')[0].properties).toMatchObject({ first_ever: false });
  expect(later.endpoint.named('first_message')[0].properties.since_install_ms).toBeUndefined();
  expect(later.endpoint.named('video_action')[0].properties.action).toBe('extend');
  const [done, failed] = later.endpoint.named('generation_finished').map(e => e.properties);
  expect(done).toMatchObject({ modality: 'video', duration_ms: 61_000, has_init_image: true, quality: 'draft', story: true });
  expect(failed).toMatchObject({ modality: 'video', outcome: 'failed', error_code: 'out_of_memory', has_init_image: false, quality: 'final', story: false });
});
