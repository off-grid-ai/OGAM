import { Buffer } from 'buffer';
import { installRealSqlite } from '../../harness/sqliteFake';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import {
  createLicensedMesh,
  installLicensedPhone,
  registerThisPhone,
} from '../../harness/licensedMesh';
import { MembershipPersistenceBoundary } from '../../utils/membershipPersistenceBoundary';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary,
  } = require('../../utils/modelTransferFsBoundary');
  return {
    __esModule: true,
    default: modelTransferFsBoundary.module,
    ...modelTransferFsBoundary.module,
  };
});

async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();

/**
 * The pairing code this phone is showing. A peer proves it is the device the user is looking at by
 * presenting this code, which is why nothing has to be accepted afterwards.
 */
function phonePairingCode(): string {
  const { useSyncStore } =
    require('../../../pro/sync/syncStore') as typeof import('../../../pro/sync/syncStore');
  const code = useSyncStore.getState().pairingCode.code;
  if (!code) throw new Error('the phone has not issued a pairing code yet');
  return code;
}

describe('Pro mobile knowledge document sync journey', () => {
  it('stages file-first input, indexes it visibly, sends a picked file back, and applies a tombstone', async () => {
    const globals = globalThis as unknown as {
      Buffer: typeof Buffer | undefined;
    };
    const previousGlobalBuffer = globals.Buffer;
    globals.Buffer = undefined;
    installNativeBoundary({ llama: true });
    installRealSqlite();
    const React = require('react');
    const rtl = requireRTL();
    const { NavigationContainer } = require('@react-navigation/native');
    const asyncStorageModule = require('@react-native-async-storage/async-storage');
    const AsyncStorage = asyncStorageModule.default ?? asyncStorageModule;
    const Keychain = require('react-native-keychain');
    const TcpSocket = require('react-native-tcp-socket').default;
    const RNFS = require('react-native-fs').default;
    const picker = require('@react-native-documents/picker');
    const {
      FileTransferManager,
      IncrementalChecksum,
      KNOWLEDGE_DOCUMENT_ENTITY,
      KNOWLEDGE_DOCUMENT_MIME,
      OpLog,
      StateSync,
      createKnowledgeDocumentStateFields,
      createKnowledgeDocumentTransferMetadata,
    } = require('@offgrid/sync');
    const { AppNavigator } = require('../../../src/navigation/AppNavigator');
    const { SyncScreen } = require('../../../pro/ui/SyncScreen');
    const { SyncHomeCard } = require('../../../pro/ui/SyncHomeCard');
    const { registerScreen, _clearScreensForTesting } = require('../../../src/navigation/screenRegistry');
    const { registerSlot, SLOTS, _clearSlotsForTesting } = require('../../../src/bootstrap/slotRegistry');
    const {
      HOOKS,
      _clearHooksForTesting,
      registerHook,
    } = require('../../../src/bootstrap/hookRegistry');
    const { useAppStore } = require('../../../src/stores/appStore');
    const { useChatStore } = require('../../../src/stores/chatStore');
    const { knowledgeBase } = require('../../../src/services/rag');
    const { buildSyncEngine } = require('../../../src/services/sync/engine');
    const {
      knowledgeDocumentSyncService,
    } = require('../../../pro/sync/knowledgeDocumentSyncService');
    const { stateSyncService } = require('../../../pro/sync/stateSyncService');
    const { syncService } = require('../../../pro/sync/syncService');
    const { useSyncStore } = require('../../../pro/sync/syncStore');
    const {
      getDiscoveryBoundaries,
      resetDiscoveryBoundaries,
    } = require('../../utils/nativeSyncBoundaries');
    const {
      modelTransferFsBoundary,
    } = require('../../utils/modelTransferFsBoundary');
    const { createDownloadedModel } = require('../../utils/factories');

    const remoteProjectId = '11111111-1111-4111-8111-111111111111';
    const remoteDocumentId = '22222222-2222-4222-8222-222222222222';
    const prePairProjectId = '33333333-3333-4333-8333-333333333333';
    const createdAt = '2026-07-28T08:00:00.000Z';
    const remoteBytes = Buffer.from(
      'The OGAD launch brief says the private beta begins on Thursday.',
    );
    const remoteDescriptor = {
      syncId: remoteDocumentId,
      projectId: remoteProjectId,
      name: 'launch-brief.txt',
      createdAt,
      enabled: true,
    };
    const receivedByDesktop: Array<{
      request: Record<string, any>;
      bytes: Buffer;
    }> = [];
    const renderApp = () =>
      rtl.render(
        React.createElement(
          NavigationContainer,
          null,
          React.createElement(AppNavigator),
        ),
      );

    modelTransferFsBoundary.reset();
    await RNFS.writeFile(
      `${RNFS.MainBundlePath}/all-MiniLM-L6-v2-Q8_0.gguf`,
      'native embedding model fixture',
      'utf8',
    );
    resetDiscoveryBoundaries();
    await AsyncStorage.clear();
    // An older build could persist Projects as off. The shared catalogue now owns this rule, so that
    // obsolete host value must neither survive loading nor stop the document bytes below.
    await AsyncStorage.setItem(
      'offgrid-sync-preferences-v1',
      JSON.stringify({ projects: false }),
    );
    _clearHooksForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerSlot(SLOTS.homeSyncCard, SyncHomeCard);
    useSyncStore.getState().reset();
    useChatStore.getState().clearAllConversations();
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    // A licence to belong to, first. This suite has no beforeEach - it builds everything inside the one
    // journey - so the provider is started here rather than being assumed.
    mesh.reset();
    // A licensed phone under the fingerprint it actually has, and a desktop that holds an installation
    // like any licensed Mac. Without both, the two sides either refuse each other as different licences
    // or the peer is retired by reconciliation moments after pairing.
    installLicensedPhone(mesh);
    await registerThisPhone(mesh);
    mesh.register({
      id: 'desktop-knowledge-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
    });
    Keychain.setGenericPassword.mockResolvedValue(true);

    const remoteDevice = {
      id: 'desktop-knowledge-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remoteRecords = new Map<string, Record<string, unknown>>();
    const remoteLog = new OpLog({
      deviceId: remoteDevice.id,
      materializer: {
        put: (
          entity: string,
          entityId: string,
          fields: Record<string, unknown>,
        ) => remoteRecords.set(`${entity}:${entityId}`, fields),
        remove: (entity: string, entityId: string) =>
          remoteRecords.delete(`${entity}:${entityId}`),
      },
      uuid: (() => {
        let index = 0;
        return () => `desktop-knowledge-op-${++index}`;
      })(),
      now: () => Date.now(),
    });
    let remoteState: InstanceType<typeof StateSync>;
    let remoteTransfers: InstanceType<typeof FileTransferManager>;
    const remotePersistence = new MembershipPersistenceBoundary();
    const remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: TcpSocket,
      getSharedSecret: (deviceId: string) =>
        remotePersistence.getActive(deviceId)?.sharedSecret,
      pairingPersistence: remotePersistence,
      membershipPersistence: remotePersistence,
      onMessage: (deviceId: string, message: Record<string, unknown>) => {
        remoteTransfers.handleMessage(deviceId, message);
      },
      onAppMessage: (deviceId: string, channel: string, data: unknown) => {
        if (channel === 'state') remoteState.onMessage(deviceId, data);
      },
      onPaired: (device: { id: string }) => remoteState.onConnect(device.id),
    });
    remoteState = new StateSync({
      oplog: remoteLog,
      send: (deviceId: string, message: unknown) => {
        remote.engine.sendApp(deviceId, 'state', message);
      },
    });
    remoteTransfers = new FileTransferManager({
      send: (deviceId: string, message: Record<string, unknown>) =>
        remote.engine.send(deviceId, message),
      createSink: async (_deviceId: string, request: Record<string, any>) => {
        if (request.payload.mimeType !== KNOWLEDGE_DOCUMENT_MIME) return null;
        const bytes = Buffer.alloc(request.payload.fileSize);
        return {
          prepare: async () => 0,
          write: async (offset: number, data: Uint8Array) => {
            Buffer.from(data).copy(bytes, offset);
          },
          finalize: async () => {
            receivedByDesktop.push({ request, bytes });
            return true;
          },
          abort: async () => undefined,
        };
      },
    });

    registerHook(HOOKS.syncRecordLocalMutation, (mutation: unknown) => {
      stateSyncService.recordMutation(mutation);
    });
    registerHook(HOOKS.syncKnowledgeDocumentMutation, (mutation: unknown) => {
      knowledgeDocumentSyncService
        .handleLocalMutation(mutation)
        .catch(() => undefined);
    });
    knowledgeDocumentSyncService.start({
      recordStateMutation: (mutation: unknown) =>
        stateSyncService.recordMutation(mutation),
    });

    let view: ReturnType<typeof rtl.render> | undefined;
    try {
      await remote.engine.start(0);
      remoteDevice.port = remote.transport.boundPort ?? 0;
      await stateSyncService.start();
      expect(stateSyncService.preferences().projects).toBe(true);
      await syncService.start();

      const prePairPath = '/docs/phone-before-pair.txt';
      const prePairText =
        'This knowledge document existed on the phone before the desktop paired.';
      await RNFS.writeFile(prePairPath, prePairText, 'utf8');
      await knowledgeBase.addFile({
        projectId: prePairProjectId,
        filePath: prePairPath,
        fileName: 'phone-before-pair.txt',
        fileSize: Buffer.byteLength(prePairText),
      });

      const mobile = useSyncStore.getState().thisDevice;
      const discovery = getDiscoveryBoundaries().at(-1);
      if (!mobile || !discovery?.publishedPort) {
        throw new Error('Sync did not publish the mobile device');
      }
      // There is no accept step and no separate passphrase: the peer presents the code THIS phone is
      // showing, and a code that matches is the whole confirmation. Waiting for the intermediate
      // `waiting_for_confirmation` stage is also gone - over an in-memory transport the attempt passes
      // through it in under a millisecond, so it is a frame that has already been and gone.
      await remote.engine.pair(
        {
          ...mobile,
          host: '127.0.0.1',
          port: discovery.publishedPort,
        },
        phonePairingCode(),
      );
      await waitForCondition(
        () =>
          remote.engine.isPaired(mobile.id) &&
          useSyncStore
            .getState()
            .knownDevices.some(
              (device: { id: string; status: string }) =>
                device.id === remoteDevice.id && device.status === 'connected',
            ),
        'Mobile and Desktop did not reach connected state',
      );
      await waitForCondition(
        () =>
          receivedByDesktop.some(
            transfer =>
              transfer.request.payload.metadata.name ===
              'phone-before-pair.txt',
          ),
        'Desktop did not receive the knowledge document that existed before pairing',
      );
      const prePairTransfer = receivedByDesktop.find(
        transfer =>
          transfer.request.payload.metadata.name === 'phone-before-pair.txt',
      );
      expect(prePairTransfer?.bytes.toString('utf8')).toBe(prePairText);
      await waitForCondition(
        () =>
          [...remoteRecords.values()].some(
            fields => fields.name === 'phone-before-pair.txt',
          ),
        'Desktop did not receive the durable control for the pre-pair document',
      );

      view = renderApp();
      rtl.fireEvent.press(await view.findByTestId('open-sync-from-home'));
      await rtl.waitFor(() => {
        expect(view!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy();
      });
      remote.engine.disconnect(mobile.id);
      await rtl.waitFor(() => {
        expect(view!.getByTestId(`sync-reconnect-${remoteDevice.id}`)).toBeTruthy();
      });
      await knowledgeDocumentSyncService.stop();
      knowledgeDocumentSyncService.start({
        recordStateMutation: (mutation: unknown) =>
          stateSyncService.recordMutation(mutation),
      });
      rtl.fireEvent.press(view.getByTestId(`sync-reconnect-${remoteDevice.id}`));
      await waitForCondition(
        () =>
          useSyncStore.getState().knownDevices.some(
            (device: { id: string; status: string }) =>
              device.id === remoteDevice.id && device.status === 'connected',
          ),
        'Mobile did not reconnect to Desktop',
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(receivedByDesktop.filter(transfer =>
        transfer.request.payload.metadata.name === 'phone-before-pair.txt',
      )).toHaveLength(1);
      rtl.fireEvent.press(view.getByLabelText('Back'));

      const remoteChecksum = new IncrementalChecksum();
      remoteChecksum.update(remoteBytes);
      await remoteTransfers.sendFile(mobile.id, {
        fileName: remoteDescriptor.name,
        fileSize: remoteBytes.length,
        mimeType: KNOWLEDGE_DOCUMENT_MIME,
        metadata: createKnowledgeDocumentTransferMetadata(remoteDescriptor),
        checksum: async () => remoteChecksum.digest(),
        read: async (offset: number, length: number) =>
          new Uint8Array(remoteBytes.subarray(offset, offset + length)),
      });
      expect(
        (await knowledgeBase.getAllDocumentsForSync()).some(
          (document: { syncId: string }) =>
            document.syncId === remoteDocumentId,
        ),
      ).toBe(false);

      const projectOp = remoteLog.record('project', remoteProjectId, 'put', {
        name: 'OGAD',
        description: 'Launch documents',
        system_prompt: 'Use the launch brief.',
        icon: null,
        include_memory: 1,
        created_at: createdAt,
        updated_at: createdAt,
      });
      const documentOp = remoteLog.record(
        KNOWLEDGE_DOCUMENT_ENTITY,
        remoteDocumentId,
        'put',
        createKnowledgeDocumentStateFields(remoteDescriptor),
      );
      remote.engine.sendApp(mobile.id, 'state', {
        t: 'ops',
        ops: [documentOp, projectOp],
      });

      await waitForCondition(
        async () =>
          (await knowledgeBase.getAllDocumentsForSync()).some(
            (document: { syncId: string }) =>
              document.syncId === remoteDocumentId,
          ),
        'Mobile did not index the streamed Desktop document',
      );
      expect(await knowledgeBase.getDocumentsByProject(remoteProjectId)).toEqual([
        expect.objectContaining({
          name: 'launch-brief.txt',
          project_id: remoteProjectId,
          sync_id: remoteDocumentId,
        }),
      ]);

      let repeatedReads = 0;
      const repeatedChecksum = new IncrementalChecksum();
      repeatedChecksum.update(remoteBytes);
      await remoteTransfers.sendFile(mobile.id, {
        fileName: remoteDescriptor.name,
        fileSize: remoteBytes.length,
        mimeType: KNOWLEDGE_DOCUMENT_MIME,
        metadata: createKnowledgeDocumentTransferMetadata(remoteDescriptor),
        checksum: async () => repeatedChecksum.digest(),
        read: async (offset: number, length: number) => {
          repeatedReads += 1;
          return new Uint8Array(remoteBytes.subarray(offset, offset + length));
        },
      });
      // Reconnect backfill may offer a document again. The receiver proves it already has the same
      // checksum and resumes at the end, so no payload crosses the mesh and no document is re-indexed.
      expect(repeatedReads).toBe(0);
      expect(
        (await knowledgeBase.getAllDocumentsForSync()).filter(
          (document: { syncId: string }) =>
            document.syncId === remoteDocumentId,
        ),
      ).toHaveLength(1);

      rtl.fireEvent.press(await view.findByTestId('projects-tab'));
      await rtl.waitFor(() => {
        expect(view!.queryByText('OGAD')).not.toBeNull();
      });
      rtl.fireEvent.press(view.getByText('OGAD'));
      // A project opens on Chats; its documents are behind the Knowledge base tab.
      rtl.fireEvent.press(await view.findByTestId('project-tab-knowledge'));
      await rtl.waitFor(() => {
        expect(view!.queryByText('launch-brief.txt')).not.toBeNull();
        expect(view!.queryByLabelText('Use launch-brief.txt, ON')).not.toBeNull();
        expect(
          view!.queryByLabelText('Remove launch-brief.txt'),
        ).not.toBeNull();
      });

      await RNFS.writeFile(
        '/docs/phone-notes.txt',
        'The phone note confirms the Thursday beta and the Friday review.',
        'utf8',
      );
      picker.pick.mockResolvedValue([
        {
          uri: 'file:///docs/phone-notes.txt',
          name: 'phone-notes.txt',
          type: 'text/plain',
          size: 65,
        },
      ]);
      // The tab row's + adds to the open tab: File, then the picker.
      rtl.fireEvent.press(view.getByTestId('kb-add'));
      rtl.fireEvent.press(await view.findByText('File'));
      await rtl.waitFor(
        () => {
          expect(view!.queryByText('phone-notes.txt')).not.toBeNull();
          expect(view!.queryByLabelText('Use phone-notes.txt, ON')).not.toBeNull();
          expect(
            view!.queryByLabelText('Remove phone-notes.txt'),
          ).not.toBeNull();
        },
        { timeout: 6000 },
      );
      await waitForCondition(
        () =>
          receivedByDesktop.some(
            transfer =>
              transfer.request.payload.metadata.name === 'phone-notes.txt',
          ),
        'Desktop did not receive the phone knowledge document',
      );
      const phoneTransfer = receivedByDesktop.find(
        transfer =>
          transfer.request.payload.metadata.name === 'phone-notes.txt',
      );
      expect(phoneTransfer?.bytes.toString('utf8')).toContain('Thursday beta');
      expect(
        [...remoteRecords.entries()].some(
          ([key, fields]) =>
            key.startsWith(`${KNOWLEDGE_DOCUMENT_ENTITY}:`) &&
            fields.name === 'phone-notes.txt',
        ),
      ).toBe(true);

      const deleteOp = remoteLog.record(
        KNOWLEDGE_DOCUMENT_ENTITY,
        remoteDocumentId,
        'delete',
      );
      remote.engine.sendApp(mobile.id, 'state', {
        t: 'ops',
        ops: [deleteOp],
      });
      await waitForCondition(
        async () =>
          !(
            await knowledgeBase.getAllDocumentsForSync()
          ).some(
            (document: { syncId: string }) =>
              document.syncId === remoteDocumentId,
          ),
        'Mobile did not apply the Desktop knowledge tombstone',
      );
      rtl.fireEvent.press(view.getByLabelText('Back'));
      await rtl.waitFor(() => {
        expect(view!.queryByText('OGAD')).not.toBeNull();
      });
      rtl.fireEvent.press(view.getByText('OGAD'));
      rtl.fireEvent.press(await view.findByTestId('project-tab-knowledge'));
      await rtl.waitFor(() => {
        expect(view!.queryByText('launch-brief.txt')).toBeNull();
        expect(view!.queryByText('phone-notes.txt')).not.toBeNull();
      });
    } finally {
      globals.Buffer = previousGlobalBuffer;
      view?.unmount();
      _clearHooksForTesting();
      _clearScreensForTesting();
      _clearSlotsForTesting();
      await remoteTransfers.dispose();
      await knowledgeDocumentSyncService.stop();
      await stateSyncService.stop();
      await remote.engine.stop();
      await syncService.stop();
    }
  });
});
