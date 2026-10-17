/**
 * proHarness — activate the PRO feature set (audio/voice mode, TTS, MCP, pro screens/settings) in a test,
 * the SAME way the app bootstrap does. Pro features register into core via the slot/hook/screen/settings
 * registries; core renders them by looking those up. Without this, a mounted screen shows only the free
 * shell (e.g. no header text/voice mode toggle, no audio-mode layout), so any real pro user-flow is
 * unreachable.
 *
 * Call AFTER installNativeBoundary() (so it registers into the same fresh module graph the screens read)
 * and BEFORE render(). Idempotent-ish: registering a slot twice just overwrites with the same component.
 *
 * This is the ONE reusable pro seam — voice-mode, TTS, and MCP flow tests all use it instead of hand-
 * registering individual slots per test.
 */
export async function installPro(): Promise<void> {
  // isPro=true → the real bootstrap requires @offgrid/pro and calls pro.activate({...registries}),
  // registering every pro slot (chatInput.modeToggle, chatInput.audioMode, message.speakButton, …).
   
  const { loadProFeatures } = require('../../src/bootstrap/loadProFeatures');
  await loadProFeatures(true);
}

/** Start the real app over device storage. The returned controls use only visible gestures. */
export async function launchVoiceApp(options: {
  files?: Set<string>;
  preserveStorage?: boolean;
  cachedVoice?: boolean;
  delayedStorage?: boolean;
  configureRuntime?: () => void;
} = {}) {
  const { installNativeBoundary, requireRTL, GB } = require('./nativeBoundary');
  const boundary = installNativeBoundary({ fs: true, llama: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const cache = require('./kokoroResourceBoundary').installKokoroResourceBoundary(options.files);
  if (options.cachedVoice) cache.seedVoice();
  const storage = require('@react-native-async-storage/async-storage');
  if (!options.preserveStorage) {
    await storage.clear();
    const { createDownloadedModel } = require('../utils/factories');
    const model = createDownloadedModel({ id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: '/docs/models/small.gguf', engine: 'llama', fileSize: 500 * 1024 * 1024 });
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
      hasCompletedOnboarding: true, checklistDismissed: true,
      settings: { autoDiscoverRemoteModels: false },
    }, version: 0 }));
  }
  boundary.fs.seedFile('/docs/models/small.gguf', 500 * 1024 * 1024);
  if (options.delayedStorage) {
    const read = storage.getItem;
    storage.getItem = async (key: string) => {
      await new Promise(resolve => setTimeout(resolve, 40));
      return read(key);
    };
  }
  const executorch = require('react-native-executorch');
  executorch.useTextToSpeech = (_config: unknown, opts?: { preventLoad?: boolean }) => ({
    isReady: !opts?.preventLoad, downloadProgress: opts?.preventLoad ? 0 : 1, error: null,
    stream: async () => {}, streamStop: () => {},
  });
  options.configureRuntime?.();
  const React = require('react');
  const rtl = requireRTL();
  await installPro();
  const App = require('../../App').default;
  const view = rtl.render(React.createElement(App));
  await view.findByTestId('home-screen');
  return {
    boundary, cache, view, rtl,
    async voicePanel() {
      rtl.fireEvent.press(view.getByTestId('models-tab'));
      rtl.fireEvent.press(await view.findByTestId('voice-models-tab'));
      await view.findByTestId('voice-model-kokoro');
    },
    async downloadVoice() {
      rtl.fireEvent.press(await view.findByTestId('voice-model-kokoro-download'));
      await view.findByTestId('voice-model-kokoro-delete');
    },
    async chat() {
      rtl.fireEvent.press(view.getByTestId('home-tab'));
      rtl.fireEvent.press(view.getByTestId('browse-models-button'));
      rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
      await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
      rtl.fireEvent.press(view.getByTestId('new-chat-button'));
      await view.findByTestId('chat-input');
    },
    async send(prompt: string, answer: string) {
      boundary.llama.scriptCompletion({ text: answer });
      rtl.fireEvent.changeText(view.getByTestId('chat-input'), prompt);
      rtl.fireEvent.press(view.getByTestId('send-button'));
      await view.findByText(answer);
      await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());
    },
    async actions() {
      rtl.fireEvent.press(rtl.within(view.getByTestId('assistant-message')).getByText('•••'));
      await view.findByTestId('action-menu');
    },
    async close() {
      view.unmount();
      await require('../../src/services/generationService').generationService.stopGeneration();
      await require('../../pro').deactivate();
      await require('../../pro/sync/stateSyncService').stateSyncService.stop();
      await require('../../pro/sync/syncService').syncService.stop();
    },
  };
}

/** A device already on the licence before the app starts, the way one paired weeks ago is. */
export interface SavedInstallation {
  id: string;
  name: string;
  platform: string;
}

/**
 * Start the real App with Pro decided by a real licence, the way a shipped build decides it.
 *
 * Nothing forces Pro on: the developer unlock is off (`devProDisabled`), and `installPro()` is NOT
 * called, because that passes `isPro: true` and would make every "still Pro" assertion true by
 * construction. App boot runs `loadProFeatures()` itself, which reads the credential from the
 * Keychain, asks the licence provider (the Keygen fake at the HTTP boundary) and follows the roster.
 *
 * `relaunch: true` is a cold start over the same device: a fresh module graph (installNativeBoundary
 * resets modules), the same AsyncStorage, the same Keychain contents and the same provider. Nothing is
 * seeded again, so whatever the first run left behind is what the second run finds.
 *
 * The op-sqlite boundary is the test file's own `jest.mock` (an in-memory database per open), so a
 * relaunch starts with an empty sync op store. Journeys that need the op history to survive a
 * relaunch cannot use this helper.
 */
export async function launchLicensedApp(options: {
  mesh: import('./licensedMesh').LicensedMesh;
  /** The Keychain. Pass the same map to a relaunch so the credential outlives the first run. */
  secrets: Map<string, string>;
  relaunch?: boolean;
  /** Other installations on the licence, oldest first. They register after this phone. */
  savedInstallations?: readonly SavedInstallation[];
  /**
   * More device boundary, installed into the fresh module graph before any app module loads (for
   * example `installDocumentEngine(boundary.fs, ...)`, which needs exactly that window).
   */
  configure?: (boundary: import('./nativeBoundary').NativeBoundary) => void;
}) {
  const { installNativeBoundary, requireRTL, GB } = require('./nativeBoundary');
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  options.configure?.(boundary);
  const docs = boundary.fs!.DocumentDirectoryPath;
  const { createDownloadedModel } = require('../utils/factories');
  const model = createDownloadedModel({
    id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: `${docs}/models/small.gguf`,
    engine: 'llama', fileSize: 500 * 1024 * 1024,
  });
  // The model file is on the phone's disk across a relaunch, as it would be.
  boundary.fs!.seedFile(model.filePath, model.fileSize);
  const storageModule = require('@react-native-async-storage/async-storage');
  const storage = storageModule.default ?? storageModule;
  const { installLicensedPhone, registerThisPhone } = require('./licensedMesh');
  if (!options.relaunch) {
    await storage.clear();
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
      hasCompletedOnboarding: true, checklistDismissed: true, downloadedModels: [model],
      devProDisabled: true, settings: { autoDiscoverRemoteModels: false },
    }, version: 0 }));
    options.secrets.clear();
  }
  installLicensedPhone(options.mesh, { secrets: options.secrets, reuse: options.relaunch });
  if (!options.relaunch) {
    await registerThisPhone(options.mesh, { name: 'This phone', platform: 'android' });
    for (const installation of options.savedInstallations ?? []) {
      options.mesh.register(installation);
    }
  }
  const React = require('react');
  const rtl = requireRTL();
  const App = require('../../App').default;
  const view = rtl.render(React.createElement(App));
  await view.findByTestId('home-screen', {}, { timeout: 10_000 });
  return {
    boundary,
    view,
    rtl,
    /** The app is killed: the screen goes, every owned runtime stops. Disk and Keychain stay. */
    async close() {
      view.unmount();
      await require('../../src/services/generationService').generationService.stopGeneration();
      await require('../../pro').deactivate();
      await require('../../pro/sync/stateSyncService').stateSyncService.stop();
      await require('../../pro/sync/syncService').syncService.stop();
    },
  };
}

/**
 * THE PAIRED-PEER OP INJECTOR — another device on the LAN, which is the sync boundary.
 *
 * Everything on the phone is real: its sync engine, its state sync, its op store, its materializer,
 * its screens. The only thing substituted is the device on the other end of the socket, and it is
 * built from the same shared engine a Desktop runs (`@offgrid/sync`'s OpLog + StateSync + SyncEngine
 * over the in-memory TCP boundary), so what reaches the phone is exactly what a Desktop puts on the
 * wire: ops with real lamport clocks, real device ids, real backfill on connect, and real file
 * transfers.
 *
 * - `record(entity, id, kind, fields)` writes an op on the peer and delivers it the way the transport
 *   would (an `ops` message on the `state` channel to every connected phone).
 * - `records` is the peer's own materialized view: what it has learned from the phone. A Desktop
 *   appending to a chat knows the chat's messages this way, and nowhere else.
 * - `sendFile(...)` streams bytes through the peer's FileTransferManager.
 *
 * Call AFTER the app's module graph is installed (after `launchLicensedApp` / `installNativeBoundary`),
 * so the peer dials the same in-memory network the phone listens on.
 */
export async function startPairedPeer(options: {
  mesh: import('./licensedMesh').LicensedMesh;
  device: { id: string; name: string; platform?: string };
  /**
   * 'joiner' (default): a device with no licence yet, sponsored by the phone on pairing - a NEW
   * device. 'licensed': a device that already holds this licence and an installation on it.
   */
  entitlement?: 'joiner' | 'licensed';
  /** Accept knowledge-document files the phone sends (they are kept in `receivedFiles`). */
  acceptFiles?: boolean;
}) {
  const {
    OpLog, StateSync, FileTransferManager, KNOWLEDGE_DOCUMENT_MIME,
  } = require('@offgrid/sync');
  const { buildSyncEngine } = require('../../src/services/sync/engine');
  const tcpModule = require('react-native-tcp-socket').default;
  const { MembershipPersistenceBoundary } = require('../utils/membershipPersistenceBoundary');
  const device = {
    id: options.device.id,
    name: options.device.name,
    platform: options.device.platform ?? 'macos',
    version: '1',
    host: '127.0.0.1',
    port: 0,
  };
  const records = new Map<string, Record<string, unknown>>();
  const receivedFiles: Array<{ request: Record<string, any>; bytes: Buffer }> = [];
  let index = 0;
  const log = new OpLog({
    deviceId: device.id,
    materializer: {
      put: (entity: string, entityId: string, fields: Record<string, unknown>) => {
        records.set(`${entity}:${entityId}`, fields);
      },
      remove: (entity: string, entityId: string) => {
        records.delete(`${entity}:${entityId}`);
      },
    },
    uuid: () => `${device.id}-op-${++index}`,
    now: () => Date.now(),
  });
  const connected = new Set<string>();
  const persistence = new MembershipPersistenceBoundary();
  // eslint-disable-next-line prefer-const
  let state: InstanceType<typeof StateSync>;
  // eslint-disable-next-line prefer-const
  let transfers: InstanceType<typeof FileTransferManager>;
  const peer = buildSyncEngine({
    pairingEntitlement:
      options.entitlement === 'licensed'
        ? options.mesh.peer()
        : options.mesh.joiner({ name: device.name, platform: device.platform }),
    localDevice: device,
    tcpModule,
    getSharedSecret: (deviceId: string) => persistence.getActive(deviceId)?.sharedSecret,
    pairingPersistence: persistence,
    membershipPersistence: persistence,
    onPaired: (paired: { id: string }) => {
      connected.add(paired.id);
      state.onConnect(paired.id);
    },
    onDisconnected: (deviceId: string) => {
      connected.delete(deviceId);
    },
    onMessage: (deviceId: string, message: Record<string, unknown>) => {
      transfers.handleMessage(deviceId, message);
    },
    onAppMessage: (deviceId: string, channel: string, data: unknown) => {
      if (channel === 'state') state.onMessage(deviceId, data);
    },
  });
  state = new StateSync({
    oplog: log,
    send: (deviceId: string, message: unknown) => {
      peer.engine.sendApp(deviceId, 'state', message);
    },
  });
  transfers = new FileTransferManager({
    send: (deviceId: string, message: Record<string, unknown>) => peer.engine.send(deviceId, message),
    createSink: async (_deviceId: string, request: Record<string, any>) => {
      if (!options.acceptFiles || request.payload.mimeType !== KNOWLEDGE_DOCUMENT_MIME) return null;
      const bytes = Buffer.alloc(request.payload.fileSize);
      return {
        prepare: async () => 0,
        write: async (offset: number, data: Uint8Array) => {
          Buffer.from(data).copy(bytes, offset);
        },
        finalize: async () => {
          receivedFiles.push({ request, bytes });
          return true;
        },
        abort: async () => undefined,
      };
    },
  });
  await peer.engine.start(0);
  device.port = peer.transport.boundPort ?? 0;

  return {
    device,
    engine: peer.engine,
    log,
    records,
    receivedFiles,
    /** The phone ids this peer is connected to right now. */
    connected,
    /**
     * Dial the phone and present the pairing code it is showing. The Sync screen must be open: the
     * code is read off it, exactly as a person reads it to type on the other device.
     */
    async pairWithPhone(view: any) {
      const rtl = requireRTLForPeer();
      const { pairingCodeOnScreen } = require('../utils/pairFromPeer');
      const { getDiscoveryBoundaries } = require('../utils/nativeSyncBoundaries');
      const { useSyncStore } = require('../../pro/sync/syncStore');
      const code = await pairingCodeOnScreen(view);
      const phone = useSyncStore.getState().thisDevice;
      const port = getDiscoveryBoundaries().at(-1)?.publishedPort;
      if (!phone || !port) throw new Error('the phone is not advertising itself');
      await rtl.act(async () => {
        await peer.engine.pair({ ...phone, host: '127.0.0.1', port }, code);
      });
      await view.findByTestId(`sync-paired-${device.id}`, {}, { timeout: 10_000 });
      return phone.id as string;
    },
    /** Write an op on this device and put it on the wire to every connected phone. */
    record(
      entity: string,
      entityId: string,
      kind: 'put' | 'delete',
      fields?: Record<string, unknown>,
    ) {
      const op = log.record(entity, entityId, kind, fields);
      for (const phoneId of connected) {
        peer.engine.sendApp(phoneId, 'state', { t: 'ops', ops: [op] });
      }
      return op;
    },
    /** The id of the first record of `entity` this peer holds that matches. */
    findRecord(
      entity: string,
      matches: (fields: Record<string, unknown>) => boolean,
    ): string | undefined {
      for (const [key, fields] of records) {
        if (key.startsWith(`${entity}:`) && matches(fields)) return key.slice(entity.length + 1);
      }
      return undefined;
    },
    /** Stream a file to the phone the way a Desktop sends one. */
    async sendFile(phoneId: string, file: {
      fileName: string;
      bytes: Uint8Array;
      mimeType: string;
      metadata: Record<string, unknown>;
    }) {
      const { IncrementalChecksum } = require('@offgrid/sync');
      const checksum = new IncrementalChecksum();
      checksum.update(file.bytes);
      await transfers.sendFile(phoneId, {
        fileName: file.fileName,
        fileSize: file.bytes.length,
        mimeType: file.mimeType,
        metadata: file.metadata,
        checksum: async () => checksum.digest(),
        read: async (offset: number, length: number) =>
          new Uint8Array(file.bytes.subarray(offset, offset + length)),
      });
    },
    async stop() {
      await transfers.dispose();
      await peer.engine.stop();
    },
  };
}

function requireRTLForPeer() {
  return require('./nativeBoundary').requireRTL();
}
