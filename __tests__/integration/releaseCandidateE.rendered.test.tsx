/** Release-candidate journeys on the production navigation stack. Only device boundaries are faked. */
import { GB, installNativeBoundary, requireRTL } from '../harness/nativeBoundary';
import { createDownloadedModel } from '../utils/factories';
import type { LicensedMesh } from '../harness/licensedMesh';
import type { GeneratedImage } from '../../src/types';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true, default: require('../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true, default: require('../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));
jest.mock('@op-engineering/op-sqlite', () =>
  require('../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);


afterEach(async () => {
  await require('../../src/services/generationService').generationService.stopGeneration();
  await require('../../src/services/imageGenerationService').imageGenerationService.cancelGeneration();
  await require('../../pro').deactivate();
  await require('../../pro/sync/stateSyncService').stateSyncService.stop();
  await require('../../pro/sync/syncService').syncService.stop();
});

const date = '2026-10-10T12:00:00.000Z';
const image = (id: string, imagePath: string): GeneratedImage => ({
  id, imagePath, prompt: `Picture ${id}`, width: 512, height: 512, steps: 1,
  seed: 1, modelId: 'remote-image', createdAt: date, conversationId: 'saved-chat',
});

async function launch(options: {
  images?: Array<{ id: string; directory: string; missing?: boolean }>;
  pro?: boolean;
  preserveStorage?: boolean;
  mic?: 'Granted' | 'Undetermined';
  staleVoice?: boolean;
  remoteImage?: boolean;
  licensed?: boolean;
} = {}) {
  const boundary = installNativeBoundary({
    llama: true, fs: true, whisper: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  boundary.setMicPermission(options.mic ?? 'Granted');
  const docs = boundary.fs!.DocumentDirectoryPath;
  const model = createDownloadedModel({
    id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: `${docs}/models/small.gguf`,
    engine: 'llama', fileSize: 500 * 1024 * 1024,
  });
  boundary.fs!.seedFile(model.filePath!, model.fileSize);
  boundary.fs!.seedFile(`${docs}/whisper-models/ggml-tiny.en.bin`, 75 * 1024 * 1024);
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.preserveStorage) {
    await storage.clear();
    const images = (options.images ?? []).map(entry => {
      const path = `${docs}/${entry.directory}/${entry.id}.png`;
      if (!entry.missing) boundary.fs!.seedFile(path, 2048);
      return image(entry.id, path);
    });
    if (options.remoteImage) {
      await storage.setItem('remote-servers', JSON.stringify({ state: { servers: [{
        id: 'image-server', name: 'Studio Mac', endpoint: 'http://192.168.1.60:7878',
        providerType: 'openai-compatible', createdAt: Date.parse(date),
        modelManagement: 'offgrid-desktop-v1',
        modelCatalog: { image: [{ id: 'flux-schnell', name: 'Flux Schnell' }] },
      }] }, version: 0 }));
    }
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
      hasCompletedOnboarding: true, checklistDismissed: true, downloadedModels: [model], devProDisabled: !options.pro,
      generatedImages: images, settings: { autoDiscoverRemoteModels: false },
    }, version: 0 }));
    await storage.setItem('local-llm-chat-storage', JSON.stringify({ state: {
      conversations: [{
        id: 'saved-chat', title: 'Trip photos', modelId: 'm', projectId: 'trip',
        createdAt: date, updatedAt: date,
        messages: [{ id: 'question', role: 'user', content: 'A lake at dawn', timestamp: Date.parse(date) }],
      }], activeConversationId: null,
    }, version: 2 }));
    await storage.setItem('local-llm-project-storage', JSON.stringify({ state: {
      projects: [{ id: 'trip', name: 'Trip', description: '', systemPrompt: '', createdAt: date, updatedAt: date }],
    }, version: 0 }));
    if (options.staleVoice) {
      await storage.setItem('tts-store', JSON.stringify({ state: { settings: {
        interfaceMode: 'chat', enabled: true, speed: 1, engineId: 'kokoro',
        modelDownloaded: { kokoro: true }, voiceByEngine: { kokoro: 'af_heart' },
      } }, version: 0 }));
    }
  }
  let mesh: LicensedMesh | undefined;
  if (options.licensed || options.pro) {
    const { createLicensedMesh, installLicensedPhone, registerThisPhone } = require('../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh!.reset();
    installLicensedPhone(mesh);
    await registerThisPhone(mesh, { name: 'This phone', platform: 'android' });
  }
  // ResourceFetcher is the device download/cache boundary. Its completed-file list
  // changes after a download or after the OS removes files.
  const voiceFiles = new Set<string>();
  if (options.pro) {
    const { BareResourceFetcher } = require('react-native-executorch-bare-resource-fetcher');
    BareResourceFetcher.listDownloadedFiles = async () => [...voiceFiles];
    BareResourceFetcher.fetch = async (progress: (value: number) => void, ...sources: string[]) => {
      if (options.staleVoice) throw new TypeError('Device is offline');
      for (const source of sources) voiceFiles.add(`/cache/${source.split('/').pop()}`);
      progress(1);
    };
    BareResourceFetcher.deleteResources = async () => { voiceFiles.clear(); };
  }
  const React = require('react');
  const rtl = requireRTL();
  const { useAppStore, useChatStore, useProjectStore, useRemoteServerStore } = require('../../src/stores');
  await Promise.all([useAppStore.persist.rehydrate(), useChatStore.persist.rehydrate(), useProjectStore.persist.rehydrate(), useRemoteServerStore.persist.rehydrate()]);
  if (options.pro) await require('../harness/proHarness').installPro();
  const AppRoot = require('../../App').default;
  const view = rtl.render(React.createElement(AppRoot));
  await view.findByTestId('home-screen');
  return { boundary, view, rtl, storage, voiceFiles, mesh };
}

type App = Awaited<ReturnType<typeof launch>>;

async function selectTextAndOpenChat(app: App) {
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('browse-models-button'));
  rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
  await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
  rtl.fireEvent.press(view.getByTestId('new-chat-button'));
  await view.findByTestId('chat-input');
}

async function send(app: App, prompt: string, answer: string) {
  app.boundary.llama!.scriptCompletion({ text: answer });
  app.rtl.fireEvent.changeText(app.view.getByTestId('chat-input'), prompt);
  app.rtl.fireEvent.press(app.view.getByTestId('send-button'));
  await app.view.findByText(answer.includes('</think>') ? answer.split('</think>')[1] : answer);
  await app.rtl.waitFor(() => expect(app.view.queryByTestId('stop-button')).toBeNull());
}

async function openGallery(app: App) {
  app.rtl.fireEvent.press(app.view.getByText('Image Gallery'));
  await app.view.findByTestId('gallery-screen');
}

async function confirmDelete(app: App) {
  await app.rtl.act(async () => {
    app.rtl.fireEvent.press(app.view.getAllByText('Delete').at(-1)!);
  });
}

it.each(['Home', 'ProjectDetail', 'ProjectChats'] as const)(
  'M5: deleting a saved chat from %s also removes its synced image', async surface => {
    const app = await launch({ images: [{ id: 'synced', directory: 'shared_files' }] });
    const { view, rtl } = app;
    if (surface !== 'Home') {
      rtl.fireEvent.press(view.getByTestId('projects-tab'));
      rtl.fireEvent.press(await view.findByTestId('project-row-trip'));
      await view.findByTestId('project-detail-screen');
      if (surface === 'ProjectChats') rtl.fireEvent.press(view.getByText('Chats'));
      rtl.fireEvent.press(await view.findByLabelText('Delete Trip photos'));
    } else {
      rtl.fireEvent.press(view.getByTestId('delete-conversation-button'));
    }
    await view.findByText(/Delete "Trip photos"/);
    await confirmDelete(app);
    await rtl.waitFor(() => expect(view.queryByText('Trip photos')).toBeNull());
    // Reopen the app over the same storage. Both the chat and its Gallery entry stay gone.
    view.unmount();
    const next = await launch({ preserveStorage: true });
    expect(next.view.queryByText('Trip photos')).toBeNull();
    await openGallery(next);
    expect(await next.view.findByText('No generated images yet')).toBeTruthy();
    next.view.unmount();
  },
);

it.each(['Home', 'ProjectDetail', 'ProjectChats'] as const)(
  'M5/M6: %s reports an image it cannot remove', async surface => {
    const app = await launch({ images: [{ id: 'outside', directory: 'attachments' }] });
    const { view, rtl } = app;
    if (surface !== 'Home') {
      rtl.fireEvent.press(view.getByTestId('projects-tab'));
      rtl.fireEvent.press(await view.findByTestId('project-row-trip'));
      if (surface === 'ProjectChats') rtl.fireEvent.press(await view.findByText('Chats'));
      rtl.fireEvent.press(await view.findByLabelText('Delete Trip photos'));
    } else rtl.fireEvent.press(view.getByTestId('delete-conversation-button'));
    await view.findByText(/Delete "Trip photos"/);
    await confirmDelete(app);
    expect(await view.findByText('Some images were not deleted')).toBeTruthy();
    expect(view.getByText('1 image from the deleted chat could not be removed. Its record is still in your Gallery.')).toBeTruthy();
    expect(view.queryByText(/where you can delete/)).toBeNull();
    view.unmount();
  },
);

it('M6: Gallery deletes a synced copy and reports an unsafe path for single and bulk delete', async () => {
  const app = await launch({ images: [
    { id: 'synced', directory: 'shared_files' }, { id: 'outside', directory: 'attachments' },
  ] });
  const { view, rtl } = app;
  await openGallery(app);
  rtl.fireEvent.press(view.getByTestId('gallery-image-synced'));
  rtl.fireEvent.press((await view.findByText('Delete')));
  await view.findByText('Delete Image');
  await confirmDelete(app);
  await rtl.waitFor(() => expect(view.queryByTestId('gallery-image-synced')).toBeNull());
  rtl.fireEvent.press(view.getByTestId('gallery-image-outside'));
  rtl.fireEvent.press((await view.findByText('Delete')));
  await view.findByText('Delete Image');
  await confirmDelete(app);
  expect(await view.findByText('Image was not deleted')).toBeTruthy();
  rtl.fireEvent.press(view.getByText('OK'));
  await rtl.waitFor(() => expect(view.queryByText('Image was not deleted')).toBeNull());
  // Close the full-screen viewer through its real dismiss control.
  rtl.fireEvent.press(view.getByText('Close'));
  rtl.fireEvent(view.getByTestId('gallery-image-outside'), 'longPress');
  rtl.fireEvent.press(view.getByLabelText('Delete selected images'));
  await view.findByText('Delete Images');
  await confirmDelete(app);
  expect(await view.findByText('Some images were not deleted')).toBeTruthy();
  expect(view.getByTestId('gallery-image-outside')).toBeTruthy();
  view.unmount();
});

it('M24: an unavailable Gallery image explains the missing file and offers Remove', async () => {
  const app = await launch({ images: [{ id: 'missing', directory: 'shared_files', missing: true }] });
  await openGallery(app);
  const { view, rtl } = app;
  const { decodeRenderedImages } = require('../harness/nativeImageLoader');
  await decodeRenderedImages(view.root, app.boundary.fs!);
  expect(view.getByText('Image is not on this device')).toBeTruthy();
  rtl.fireEvent.press(view.getByText('Remove'));
  await view.findByText('Remove Image');
  rtl.fireEvent.press(view.getAllByText('Remove').at(-1)!);
  expect(await view.findByText('No generated images yet')).toBeTruthy();
  view.unmount();
});

it('M9: the collapsed thinking preview keeps inline code, fenced code, and identifiers', async () => {
  const app = await launch();
  await selectTextAndOpenChat(app);
  await send(app, 'Explain the variable.', '<think># Plan\n**Keep** _this_ my_var_x and `some_code`.\n```python\nmy_var_x = some_code + 1\n```\nDone.</think>The code is ready.');
  const { view, rtl } = app;
  if (view.queryByTestId('assistant-work-toggle')) rtl.fireEvent.press(view.getByTestId('assistant-work-toggle'));
  const toggle = await view.findByTestId('thinking-block-toggle');
  if (!view.queryByTestId('thinking-block-preview')) rtl.fireEvent.press(toggle);
  expect(rtl.within(view.getByTestId('thinking-block-preview')).getByText(
    'Plan Keep this my_var_x and some_code. my_var_x = some_code + 1 Done.',
  )).toBeTruthy();
  view.unmount();
});

it('M14: Android remembers a refused mic request after a fresh launch and clears it on grant', async () => {
  const app = await launch({ mic: 'Undetermined' });
  const { view, rtl } = app;
  rtl.fireEvent.press(view.getByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('transcription-models-tab'));
  rtl.fireEvent.press(await view.findByTestId('transcription-model-card-0'));
  rtl.fireEvent.press(view.getByTestId('home-tab'));
  await selectTextAndOpenChat(app);
  const mic = await view.findByTestId('voice-record-button');
  const touch = {
    nativeEvent: { touches: [], changedTouches: [], identifier: 1, pageX: 0, pageY: 0, timestamp: 0 },
    touchHistory: { touchBank: [], numberActiveTouches: 0, indexOfSingleActiveTouch: -1, mostRecentTimeStamp: 0 },
  };
  rtl.fireEvent(mic, 'responderGrant', touch);
  rtl.fireEvent(mic, 'responderRelease', { ...touch, nativeEvent: { ...touch.nativeEvent, timestamp: 80 } });
  await view.findByTestId('voice-record-button-mic-denied');
  view.unmount();

  const next = await launch({ preserveStorage: true, mic: 'Undetermined' });
  next.rtl.fireEvent.press(next.view.getByTestId('new-chat-button'));
  expect(await next.view.findByTestId('voice-record-button-mic-denied')).toBeTruthy();
  expect(next.view.queryByTestId('voice-record-button')).toBeNull();
  next.rtl.fireEvent.press(next.view.getByTestId('voice-record-button-mic-denied'));
  expect(await next.view.findByText('Microphone Access Is Off')).toBeTruthy();
  next.rtl.fireEvent.press(next.view.getByText('Open Settings'));
  next.boundary.setMicPermission('Granted');
  await next.rtl.act(async () => {
    next.boundary.emitAppStateChange('background');
    next.boundary.emitAppStateChange('active');
  });
  expect(await next.view.findByTestId('voice-record-button')).toBeTruthy();
  next.view.unmount();

  const granted = await launch({ preserveStorage: true, mic: 'Undetermined' });
  granted.rtl.fireEvent.press(granted.view.getByTestId('new-chat-button'));
  expect(await granted.view.findByTestId('voice-record-button')).toBeTruthy();
  expect(granted.view.queryByTestId('voice-record-button-mic-denied')).toBeNull();
  granted.view.unmount();
});

it('M16: a stale downloaded voice record does not offer Speak when its files are absent', async () => {
  const app = await launch({ pro: true, staleVoice: true });
  await selectTextAndOpenChat(app);
  await send(app, 'Say hello.', 'Hello from the device.');
  app.rtl.fireEvent(app.view.getByTestId('assistant-message'), 'longPress');
  await app.view.findByTestId('action-menu');
  expect(app.view.queryByTestId('action-speak')).toBeNull();
  app.view.unmount();
  await require('../../pro').deactivate();
});

it('M15: the Pro purchase action opens the canonical payment page', async () => {
  const app = await launch();
  const { Linking } = require('react-native');
  const original = Linking.openURL;
  let browserAddress = '';
  Linking.openURL = async (url: string) => { browserAddress = url; };
  try {
    app.rtl.fireEvent.press(app.view.getByTestId('settings-tab'));
    app.rtl.fireEvent.press(await app.view.findByText('Off Grid AI PRO'));
    app.rtl.fireEvent.press(await app.view.findByRole('button', { name: 'Get Pro' }));
    await app.rtl.waitFor(() => expect(browserAddress).toMatch(/^https:\/\/getoffgridai\.co\/pay\/\?/));
  } finally {
    Linking.openURL = original;
    app.view.unmount();
  }
});

/** Desktop's model-management and asynchronous image-job HTTP boundary. */
function desktopImageServer(error: { message: string; code?: string }, hold = false) {
  const original = globalThis.fetch;
  let override = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== 'http://192.168.1.60:7878') return original(input, init);
    switch (url.pathname) {
      case '/v1/models/activate': return json({ success: true });
      case '/v1/models/catalog': return json({ kinds: ['image'], models: [{ id: 'flux-schnell', name: 'Flux Schnell', kind: 'image', files: [] }] });
      case '/v1/models/installed': return json({ installed: ['flux-schnell'] });
      case '/v1/models/active': return json({ image: 'flux-schnell' });
      case '/v1/models': return json({ data: [] });
      case '/v1/images/generations':
        override = JSON.parse(String(init?.body ?? '{}')).allow_unsafe_memory_override === true;
        return json({ request_id: 'image-job' }, 202);
      case '/v1/requests/image-job':
        if (init?.method === 'DELETE') return json({ cancelled: true, status: 'cancelled' });
        if (hold) return json({ status: 'running', progress: { step: 1, total: 4 } });
        return json(override
          ? { status: 'completed', result: { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }] } }
          : { status: 'failed', error });
      default: return json({ error: 'Not found' }, 404);
    }
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; } };
}

async function selectRemoteImage(app: App) {
  app.rtl.fireEvent.press(app.view.getByTestId('model-summary-image-open'));
  app.rtl.fireEvent.press(await app.view.findByTestId('remote-image-model-image-server-flux-schnell'));
  await app.rtl.waitFor(() => expect(app.view.queryByTestId('remote-image-model-image-server-flux-schnell')).toBeNull());
}

async function draw(app: App) {
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('quick-settings-button'));
  rtl.fireEvent.press(await view.findByTestId('quick-image-mode'));
  await view.findByTestId('image-mode-force-badge');
  rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'draw a lake at dawn');
  rtl.fireEvent.press(view.getByTestId('send-button'));
}

it.each([
  { message: 'OFFGRID_IMAGE_MEMORY_LIMIT:Not enough memory for this image.' },
  { code: 'OFFGRID_IMAGE_MEMORY_LIMIT', message: 'Not enough memory for this image.' },
])('M23: a polled memory error offers Run anyway without exposing its prefix (%j)', async error => {
  const app = await launch({ remoteImage: true });
  const server = desktopImageServer(error);
  try {
    await selectRemoteImage(app);
    app.rtl.fireEvent.press(app.view.getByText('Trip photos'));
    await draw(app);
    expect(await app.view.findByText(/Not enough memory for this image/)).toBeTruthy();
    expect(app.view.queryByText(/OFFGRID_IMAGE_MEMORY_LIMIT/)).toBeNull();
    app.rtl.fireEvent.press(app.view.getByText('Run anyway'));
    expect(await app.view.findByTestId('generated-image')).toBeTruthy();
    expect(app.view.queryByTestId('model-failure-image')).toBeNull();
  } finally {
    await require('../../src/services/imageGenerationService').imageGenerationService.cancelGeneration();
    app.view.unmount();
    server.restore();
  }
});

it.each(['Home', 'ProjectDetail', 'ProjectChats'] as const)(
  'M5: %s stops an image job before deleting its chat', async surface => {
    const app = await launch({ remoteImage: true });
    const desktop = desktopImageServer({ message: 'Unused' }, true);
    const { view, rtl } = app;
    try {
      await selectRemoteImage(app);
      if (surface !== 'Home') {
        rtl.fireEvent.press(view.getByTestId('projects-tab'));
        rtl.fireEvent.press(await view.findByTestId('project-row-trip'));
        if (surface === 'ProjectChats') rtl.fireEvent.press(await view.findByText('Chats'));
      }
      rtl.fireEvent.press(await view.findByText('Trip photos'));
      await draw(app);
      expect(await view.findByText('Generating Image')).toBeTruthy();
      rtl.fireEvent.press(view.getByLabelText('Back'));
      if (surface === 'Home') rtl.fireEvent.press(await view.findByTestId('delete-conversation-button'));
      else rtl.fireEvent.press(await view.findByLabelText('Delete Trip photos'));
      await view.findByText(/Delete "Trip photos"/);
      await confirmDelete(app);
      await rtl.waitFor(() => expect(view.queryByText('Trip photos')).toBeNull());
      if (surface === 'ProjectChats') rtl.fireEvent.press(view.getByLabelText('Back'));
      if (surface !== 'Home') {
        rtl.fireEvent.press(view.getByLabelText('Back'));
        rtl.fireEvent.press(view.getByTestId('home-tab'));
      }
      await openGallery(app);
      expect(await view.findByText('No generated images yet')).toBeTruthy();
      expect(view.queryByText('Generating...')).toBeNull();
      expect(view.queryByText('Refining...')).toBeNull();
    } finally {
      await require('../../src/services/imageGenerationService').imageGenerationService.cancelGeneration();
      view.unmount();
      desktop.restore();
    }
  },
);

it('M16: Speak returns after a real voice download and disappears when the device loses its files', async () => {
  const app = await launch({ pro: true });
  const { view, rtl } = app;
  try {
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    rtl.fireEvent.press(await view.findByTestId('voice-models-tab'));
    rtl.fireEvent.press(await view.findByTestId('voice-model-kokoro-download'));
    await view.findByTestId('voice-model-kokoro-delete');
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await selectTextAndOpenChat(app);
    await send(app, 'Say hello.', 'Hello with a downloaded voice.');
    rtl.fireEvent(view.getByTestId('assistant-message'), 'longPress');
    expect(await view.findByTestId('action-speak')).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('action-copy'));
    await rtl.waitFor(() => expect(view.queryByTestId('action-menu')).toBeNull());
    app.voiceFiles.clear();
    await rtl.act(async () => {
      rtl.fireEvent(view.getByTestId('assistant-message'), 'longPress');
    });
    expect(await view.findByTestId('action-menu')).toBeTruthy();
    expect(view.queryByTestId('action-speak')).toBeNull();
  } finally {
    view.unmount();
    await require('../../pro').deactivate();
  }
});

it('M28: the Assistant control exposes its off and on states after pairing a Desktop', async () => {
  const app = await launch({ pro: true, licensed: true });
  const { view, rtl, mesh } = app;
  const { syncService } = require('../../pro/sync/syncService');
  const { buildSyncEngine } = require('../../src/services/sync/engine');
  const tcp = require('react-native-tcp-socket').default;
  const { getDiscoveryBoundaries } = require('../utils/nativeSyncBoundaries');
  const { pairingCodeOnScreen } = require('../utils/pairFromPeer');
  const device = { id: 'helmet-desktop', name: 'Studio Desktop', platform: 'macos', version: '1', host: '127.0.0.1', port: 0 };
  const peer = buildSyncEngine({
    localDevice: device, tcpModule: tcp,
    pairingEntitlement: mesh!.joiner({ name: device.name, platform: device.platform }),
  });
  try {
    await peer.engine.start(0);
    device.port = peer.transport.boundPort;
    await rtl.act(async () => { await syncService.start(); });
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    const code = await pairingCodeOnScreen(view);
    const { useSyncStore } = require('../../pro/sync/syncStore');
    const phone = useSyncStore.getState().thisDevice;
    await rtl.act(async () => {
      await peer.engine.pair({ ...phone, host: '127.0.0.1', port: getDiscoveryBoundaries().at(-1).publishedPort }, code);
    });
    expect(await view.findByTestId(`sync-paired-${device.id}`)).toBeTruthy();
    await rtl.act(async () => {
      peer.engine.sendApp(phone.id, 'mcp-task-capability', {
        version: 1, executionDevice: { id: device.id, name: device.name }, remoteTasksAllowed: true,
        tools: [{ name: 'web_use', description: 'Use the browser', inputSchema: { type: 'object', properties: {} } }],
      });
    });
    rtl.fireEvent.press(view.getByLabelText('Back'));
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await selectTextAndOpenChat(app);
    expect(view.getByRole('button', { name: 'Assistant', selected: false })).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('assistant-toggle'));
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Assistant', selected: true, busy: false })).toBeTruthy());
    rtl.fireEvent.press(view.getByTestId('assistant-toggle'));
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Assistant', selected: false, busy: false })).toBeTruthy());
  } finally {
    view.unmount();
    await peer.engine.stop();
    await syncService.stop();
    await require('../../pro').deactivate();
    mesh!.restore();
  }
});
