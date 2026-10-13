import React from 'react';
import {
  NativeEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
  type RenderAPI,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import {
  FileTransferManager,
  OpLog,
  SHARED_FILE_ENTITY,
  SHARED_FILE_MIME,
  StateSync,
  sharedFileActivityId,
  type DeviceInfo,
  type FileRequestMessage,
  type StateMsg,
  type TransferFileSink,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  _clearScreensForTesting,
  registerScreen,
} from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { SyncNotificationsScreen } from '../../../pro/ui/SyncNotificationsScreen';
import { HomeNotificationsButton } from '../../../pro/ui/HomeNotificationsButton';
import { SyncHomeCard } from '../../../pro/ui/SyncHomeCard';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { stateSyncService } from '../../../pro/sync/stateSyncService';
import { sharedFileSyncService } from '../../../pro/sync/sharedFileSyncService';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { ambientShareService } from '../../../pro/sync/ambientShareService';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncSharingSettingsScreen } from '../../../pro/ui/SyncScreen/SyncSharingSettingsScreen';
import { SyncActivityScreen } from '../../../pro/ui/SyncScreen/SyncActivityScreen';
import { SyncFilesScreen } from '../../../pro/ui/SyncScreen/SyncFilesScreen';
import { ProRoot } from '../../../pro/ui/ProRoot';
import {
  getDiscoveryBoundaries,
  resetDiscoveryBoundaries,
} from '../../utils/nativeSyncBoundaries';
import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

/**
 * The approval row asking a given question, found by walking up from the question itself.
 *
 * Rows are `sync-approval-<id>` and the id is minted per approval, so a test cannot name it up front.
 * The row's own buttons are `sync-approval-approve-<id>` and `-reject-<id>`, which share the prefix -
 * hence naming them out, or the walk stops on a button whose subtree holds no question.
 */
function approvalRow(ui: RenderAPI, question: RegExp): ReactTestInstance {
  const heading = ui.getByText(question);
  for (let node = heading.parent; node; node = node.parent) {
    const testID = node.props?.testID;
    if (
      typeof testID === 'string' &&
      testID.startsWith('sync-approval-') &&
      !/^sync-approval-(approve|reject)-/.test(testID)
    ) {
      return node;
    }
  }
  throw new Error(`no approval row asks ${question}`);
}

/** The approval id carried by a row, for addressing its buttons. */
function approvalId(row: ReactTestInstance): string {
  return String(row.props.testID).replace('sync-approval-', '');
}

/** This phone's fingerprint, which is also the sync device id its installation registers under. */
const PHONE_FINGERPRINT = 'fp-this-phone';

jest.unmock('@react-navigation/native');

// The sync op store keeps its history in SQLite and reads stored payloads back on use, so it needs a
// database that remembers: a real one. Every other database keeps the global inert mock.
jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({
    only: ['offgrid-sync.sqlite'],
  }),
);

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
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return {
    __esModule: true,
    default: boundary.module,
    ...boundary.module,
  };
});

interface ScreenshotEvent {
  syncId: string;
  name: string;
  mimeType: string;
  filePath: string;
  fileSize: number;
  createdAt: string;
  width: number;
  height: number;
}

const desktopDevice: DeviceInfo = {
  id: 'desktop-ambient-peer',
  name: 'Off Grid AI Desktop',
  platform: 'macos',
  version: '1',
  host: '127.0.0.1',
  port: 0,
};

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();

describe('mobile ambient sharing journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let screenshotListener: ((event: ScreenshotEvent) => void) | undefined;

  beforeEach(async () => {
    mesh.reset();
    modelTransferFsBoundary.reset();
    resetDiscoveryBoundaries();
    await AsyncStorage.clear();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerScreen({
      name: 'SyncSharingSettings',
      component: SyncSharingSettingsScreen,
    });
    registerScreen({ name: 'SyncActivity', component: SyncActivityScreen });
    registerScreen({ name: 'SyncFiles', component: SyncFilesScreen });
    // An ambient share waits for an answer on the Notifications screen, reached from the bell on Home -
    // so both have to be registered, the way pro/index.ts registers them when the app starts.
    registerScreen({
      name: 'Notifications',
      component: SyncNotificationsScreen,
    });
    _clearSlotsForTesting();
    registerSlot(SLOTS.homeNotificationsButton, HomeNotificationsButton);
    registerSlot(SLOTS.homeSyncCard, SyncHomeCard);
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useAppStore.getState().clearGeneratedImages();
    useChatStore.getState().clearAllConversations();
    useSyncStore.getState().reset();
    // A licensed phone with its own machine activated: the saved-device list is built from the licence
    // roster, so without both the desktop pairs and appears nowhere.
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);

    NativeModules.SyncScreenshotModule = {
      setEnabled: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((eventName, listener) => {
        if (eventName === 'SyncScreenshotCaptured') {
          screenshotListener = listener as (event: ScreenshotEvent) => void;
        }
        return { remove: jest.fn() } as unknown as EmitterSubscription;
      });
  });

  afterEach(async () => {
    mesh.restore();
    await ambientShareService.setRule({
      source: 'screenshot',
      destinationId: desktopDevice.id,
      mode: 'off',
    });
    ui?.unmount();
    await remote?.engine.stop();
    await stateSyncService.stop();
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    jest.restoreAllMocks();
  });

  it('asks before sending, survives a refusal, and lets the user retry successfully', async () => {
    const remoteRecords = new Map<string, Record<string, unknown>>();
    const receivedFiles: Array<{ name: string; bytes: Buffer }> = [];
    let rejectTransfers = false;
    let remoteState: StateSync;
    let remoteTransfers: FileTransferManager;

    const remoteLog = new OpLog({
      deviceId: desktopDevice.id,
      materializer: {
        put: (
          entity: string,
          entityId: string,
          fields: Record<string, unknown>,
        ) => {
          remoteRecords.set(`${entity}:${entityId}`, fields);
        },
        remove: (entity: string, entityId: string) =>
          remoteRecords.delete(`${entity}:${entityId}`),
      },
      uuid: (() => {
        let index = 0;
        return () => `desktop-ambient-op-${++index}`;
      })(),
      now: () => Date.now(),
    });

    remote = buildSyncEngine({
      pairingEntitlement: mesh.joiner({
        name: desktopDevice.name,
        platform: desktopDevice.platform,
      }),
      localDevice: desktopDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
      onMessage: (deviceId, message) => {
        remoteTransfers.handleMessage(deviceId, message);
      },
      onAppMessage: (deviceId, channel, data) => {
        if (channel === 'state') {
          remoteState.onMessage(deviceId, data as StateMsg);
        }
      },
    });
    remoteState = new StateSync({
      oplog: remoteLog,
      send: (deviceId, message) => {
        remote?.engine.sendApp(deviceId, 'state', message);
      },
    });
    remoteTransfers = new FileTransferManager({
      send: (deviceId, message) => remote!.engine.send(deviceId, message),
      createSink: async (
        _deviceId: string,
        request: FileRequestMessage,
      ): Promise<TransferFileSink | null> => {
        if (rejectTransfers || request.payload.mimeType !== SHARED_FILE_MIME) {
          return null;
        }
        const bytes = Buffer.alloc(request.payload.fileSize);
        return {
          prepare: async () => 0,
          write: async (offset, data) => {
            Buffer.from(data).copy(bytes, offset);
          },
          finalize: async () => {
            receivedFiles.push({
              name: request.payload.fileName,
              bytes,
            });
            return true;
          },
          abort: async () => undefined,
        };
      },
    });

    const existingGeneratedId = '33333333-3333-4333-8333-333333333333';
    const existingAttachmentId = '44444444-4444-4444-8444-444444444444';
    const generatedPath = `${modelTransferFsBoundary.DocumentDirectoryPath}/generated/late-pair-generated.png`;
    const attachmentPath = `${modelTransferFsBoundary.DocumentDirectoryPath}/attachments/late-pair-attachment.jpg`;
    await modelTransferFsBoundary.module.writeFile(
      generatedPath,
      'generated before pairing',
      'utf8',
    );
    await modelTransferFsBoundary.module.writeFile(
      attachmentPath,
      'attached before pairing',
      'utf8',
    );
    const existingConversationId = useChatStore
      .getState()
      .createConversation('off-grid/text', 'Files made before pairing');
    useChatStore.getState().addMessage(existingConversationId, {
      role: 'user',
      content: 'Keep this attachment with the chat.',
      attachments: [
        {
          id: existingAttachmentId,
          type: 'image',
          uri: `file://${attachmentPath}`,
          mimeType: 'image/jpeg',
          fileName: 'late-pair-attachment.jpg',
        },
      ],
    });
    useChatStore.getState().addMessage(existingConversationId, {
      role: 'assistant',
      content: 'Generated image for: "a lighthouse before pairing"',
      attachments: [
        {
          id: existingGeneratedId,
          type: 'image',
          uri: `file://${generatedPath}`,
          mimeType: 'image/png',
          fileName: 'late-pair-generated.png',
        },
      ],
    });
    useAppStore.getState().addGeneratedImage({
      id: existingGeneratedId,
      prompt: 'a lighthouse before pairing',
      imagePath: generatedPath,
      fileName: 'late-pair-generated.png',
      width: 512,
      height: 512,
      steps: 8,
      seed: 17,
      modelId: 'off-grid/image',
      createdAt: '2026-07-28T09:00:00.000Z',
      conversationId: existingConversationId,
    });

    await remote.engine.start(0);
    desktopDevice.port = remote.transport.boundPort ?? 0;
    await sharedFileSyncService.start({
      stageStateMutation: mutation => stateSyncService.stageMutation(mutation),
      recordStateMutation: mutation =>
        stateSyncService.recordMutation(mutation),
      // Wired as the app wires it. Without this the control record is never published and every send
      // throws "This shared file is not ready to send" - which reads as a transfer failure and is
      // actually a half-built service.
      publishControl: (deviceId, syncId) =>
        stateSyncService.sendSharedFileRecord(deviceId, syncId),
    });
    await stateSyncService.start();

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    let syncStart = Promise.resolve();
    act(() => {
      syncStart = syncService.start();
    });
    expect(ui.getByTestId('home-notifications-syncing')).toBeTruthy();
    await act(async () => syncStart);
    await waitFor(() =>
      expect(ui!.queryByTestId('home-notifications-syncing')).toBeNull(),
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('open-sync-settings')));

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const pairing = remote.engine.pair(
      {
        ...mobile,
        host: '127.0.0.1',
        port: discovery.publishedPort,
      },
      await pairingCodeOnScreen(ui),
    );
    // Waited on the outcome below rather than the progress sheet, which is gone in a couple of
    // milliseconds over an in-memory transport.
    await pairing;
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${desktopDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );

    // Both files existed before this device was known. The connection must create the first delivery
    // grants, publish each durable control through StateSync, and move the real bytes through the file
    // manager. A store-only assertion would miss the production gap this journey protects.
    await waitFor(() => {
      expect(receivedFiles.map(file => file.name)).toEqual(
        expect.arrayContaining([
          'late-pair-generated.png',
          'late-pair-attachment.jpg',
        ]),
      );
    });
    expect(
      receivedFiles.find(file => file.name === 'late-pair-generated.png')
        ?.bytes,
    ).toEqual(Buffer.from('generated before pairing'));
    expect(
      receivedFiles.find(file => file.name === 'late-pair-attachment.jpg')
        ?.bytes,
    ).toEqual(Buffer.from('attached before pairing'));
    await waitFor(() => {
      expect(
        remoteRecords.has(`${SHARED_FILE_ENTITY}:${existingGeneratedId}`),
      ).toBe(true);
      expect(
        remoteRecords.has(`${SHARED_FILE_ENTITY}:${existingAttachmentId}`),
      ).toBe(true);
    });
    receivedFiles.splice(0);

    // UI eviction enters this same production lifecycle. Reconnecting the stable installation id
    // must not turn its completed files into a new late-pair backlog.
    await ambientShareService.forgetDevice(desktopDevice.id);
    await ambientShareService.connected(desktopDevice.id);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(receivedFiles).toEqual([]);

    // A new image follows the same order as production: Gallery is written first, then the chat
    // message that owns the attachment. The first store notification must not publish a gallery-only
    // record. The second must send one linked control and the real bytes to the connected Desktop.
    const liveGeneratedId = '55555555-5555-4555-8555-555555555555';
    const liveMessageId = '66666666-6666-4666-8666-666666666666';
    const liveGeneratedPath = `${modelTransferFsBoundary.DocumentDirectoryPath}/generated/live-generated.png`;
    await modelTransferFsBoundary.module.writeFile(
      liveGeneratedPath,
      'generated after connection',
      'utf8',
    );
    const liveConversationId = useChatStore
      .getState()
      .createConversation('off-grid/text', 'Files made after connection');
    useAppStore.getState().addGeneratedImage({
      id: liveGeneratedId,
      prompt: 'a lighthouse after connection',
      imagePath: liveGeneratedPath,
      fileName: 'live-generated.png',
      width: 512,
      height: 512,
      steps: 8,
      seed: 23,
      modelId: 'off-grid/image',
      createdAt: '2026-07-28T10:00:00.000Z',
      conversationId: liveConversationId,
    });
    useChatStore.getState().addMessage(liveConversationId, {
      uuid: liveMessageId,
      role: 'assistant',
      content: 'Generated image for: "a lighthouse after connection"',
      attachments: [
        {
          id: liveGeneratedId,
          type: 'image',
          uri: `file://${liveGeneratedPath}`,
          mimeType: 'image/png',
          fileName: 'live-generated.png',
        },
      ],
    });

    await waitFor(() =>
      expect(
        receivedFiles.some(file => file.name === 'live-generated.png'),
      ).toBe(true),
    );
    expect(
      receivedFiles.find(file => file.name === 'live-generated.png')?.bytes,
    ).toEqual(Buffer.from('generated after connection'));
    await waitFor(() =>
      expect(
        remoteRecords.get(`${SHARED_FILE_ENTITY}:${liveGeneratedId}`),
      ).toMatchObject({
        kind: 'message_attachment',
        conversation_id: liveConversationId,
        message_id: liveMessageId,
      }),
    );
    receivedFiles.splice(0);

    fireEvent.press(ui.getByTestId('sync-open-sharing'));
    fireEvent.press(
      await waitFor(() => ui!.getByTestId('ambient-destination-select')),
    );
    fireEvent.press(
      await waitFor(() =>
        ui!.getByTestId(
          `ambient-destination-select-option-${desktopDevice.id}`,
        ),
      ),
    );
    fireEvent.press(ui.getByTestId('ambient-open-settings'));
    fireEvent.press(ui.getByTestId('ambient-screenshot-ask'));
    await waitFor(() => expect(screenshotListener).toBeDefined());

    const rejectedScreenshot = await captureScreenshot({
      syncId: '11111111-1111-4111-8111-111111111111',
      name: 'Screenshot-rejected.png',
      contents: 'not approved',
    });
    // An approval waits on the Notifications screen now, not in a sheet over whatever you were doing.
    // The question names the file and the device, so it can be answered without guessing what it is
    // about - and it is matched loosely because the two names are separate text children.
    // Sharing sits two screens deep, so Home is two Backs away. Each step waits for the screen it lands
    // on: a screen navigated away from stays MOUNTED but hidden, and a query skips hidden elements - so
    // pressing on before the transition settles finds nothing while the tree still shows everything.
    // The bell lives on Home, and this journey opened Sync from the SETTINGS tab - so backing out lands
    // on Settings, not Home. Out of the pushed screen first, then across by the tab bar, which is only
    // on screen once nothing is pushed over it.
    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() =>
      expect(ui!.getByTestId('sync-open-sharing')).toBeTruthy(),
    );
    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('home-tab')));
    fireEvent.press(await waitFor(() => ui!.getByTestId('home-notifications')));
    const rejectedRow = await waitFor(() =>
      approvalRow(ui!, /Screenshot-rejected\.png with/),
    );
    expect(
      remoteRecords.has(`${SHARED_FILE_ENTITY}:${rejectedScreenshot.syncId}`),
    ).toBe(false);
    expect(receivedFiles).toHaveLength(0);
    const rejectButton = within(rejectedRow).getByTestId(
      `sync-approval-reject-${approvalId(rejectedRow)}`,
    );
    fireEvent.press(rejectButton);
    expect(rejectButton.props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    await waitFor(() =>
      expect(ui!.queryByText(/Screenshot-rejected\.png with/)).toBeNull(),
    );
    expect(receivedFiles).toHaveLength(0);

    rejectTransfers = true;
    const retriedScreenshot = await captureScreenshot({
      syncId: '22222222-2222-4222-8222-222222222222',
      name: 'Screenshot-retry.png',
      contents: 'share after recovery',
    });
    const retryRow = await waitFor(() =>
      approvalRow(ui!, /Screenshot-retry\.png with/),
    );
    fireEvent.press(
      within(retryRow).getByTestId(
        `sync-approval-approve-${approvalId(retryRow)}`,
      ),
    );
    // Back out of Notifications to Home, then into Sync from the card there. Activity is where the
    // outcome of an approved share is recorded, so that is where the rest of this journey happens.
    fireEvent.press(ui.getByLabelText('Back'));
    await waitFor(() => expect(ui!.getByTestId('home-screen')).toBeTruthy());
    fireEvent.press(
      await waitFor(() => ui!.getByTestId('open-sync-from-home')),
    );
    fireEvent.press(await waitFor(() => ui!.getByTestId('sync-open-activity')));

    const activityId = sharedFileActivityId(
      desktopDevice.id,
      retriedScreenshot.syncId,
    );
    await waitFor(() => {
      const failedActivity = ui!.getByTestId(`sync-activity-${activityId}`);
      // Matched loosely: an activity row's status carries its progress in the same node, as
      // "Could not send - 0%".
      expect(within(failedActivity).getByText(/Could not send/)).toBeTruthy();
      expect(
        within(failedActivity).getByText(retriedScreenshot.name),
      ).toBeTruthy();
    });
    expect(receivedFiles).toHaveLength(0);

    rejectTransfers = false;
    fireEvent.press(ui.getByTestId(`sync-activity-retry-${activityId}`));
    await waitFor(() => expect(receivedFiles).toHaveLength(1));
    expect(receivedFiles[0]).toEqual({
      name: retriedScreenshot.name,
      bytes: Buffer.from('share after recovery'),
    });
    await waitFor(() =>
      expect(
        remoteRecords.has(`${SHARED_FILE_ENTITY}:${retriedScreenshot.syncId}`),
      ).toBe(true),
    );
    await waitFor(() => {
      const completedActivity = ui!.getByTestId(`sync-activity-${activityId}`);
      expect(within(completedActivity).getByText(/Sent/)).toBeTruthy();
    });
    const activityToolbar = ui.getByTestId('sync-activity-toolbar');
    expect(
      within(activityToolbar).getByTestId('sync-activity-filter-status'),
    ).toBeTruthy();
    expect(
      within(activityToolbar).getByTestId('sync-activity-clear'),
    ).toBeTruthy();
    fireEvent.press(ui.getByTestId('sync-activity-clear'));
    await waitFor(() =>
      expect(ui!.queryByTestId(`sync-activity-${activityId}`)).toBeNull(),
    );
    expect(ui.queryByText('SHARED FILES')).toBeNull();

    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(ui.getByTestId('sync-open-files'));
    await waitFor(() =>
      expect(
        ui!.getByTestId(`sync-file-${retriedScreenshot.syncId}`),
      ).toBeTruthy(),
    );
    expect(
      ui.queryByTestId(`sync-file-${rejectedScreenshot.syncId}`),
    ).toBeNull();
    expect(ui.getByText(retriedScreenshot.name)).toBeTruthy();
    // One line says where it went, instead of an origin ("This phone") and a count ("Shared with 1
    // device") that the reader had to put together.
    //
    // ONE row, not four. Four files were sent and all four completed, but the library lists only the
    // kinds the sharing catalogue marks `library: 'listed'`. Generated media lives in the gallery and
    // the chat that made it; a message attachment lives in its bubble. Listing them here too is the
    // bug the catalogue removed - it "showed hundreds of apparent files nobody shared". So the
    // screenshot is the only row, and what is asserted is the LABEL, which was this journey's point.
    expect(ui.getAllByText(`Sent to ${desktopDevice.name}`).length).toBe(1);

    // Filters are behind a disclosure on this screen, the same two taps a user makes.
    fireEvent.press(ui.getByTestId('sync-files-open-filters'));
    fireEvent.press(
      await waitFor(() => ui!.getByTestId('sync-file-filter-download')),
    );
    expect(
      ui.getByText('No downloads have crossed your devices yet.'),
    ).toBeTruthy();
    fireEvent.press(ui.getByTestId('sync-file-filter-screenshot'));
    expect(ui.getByText(retriedScreenshot.name)).toBeTruthy();

  }, 30_000);

  async function captureScreenshot(options: {
    syncId: string;
    name: string;
    contents: string;
  }): Promise<ScreenshotEvent> {
    const filePath = `${modelTransferFsBoundary.DocumentDirectoryPath}/sync_screenshots/${options.name}`;
    await modelTransferFsBoundary.module.writeFile(
      filePath,
      options.contents,
      'utf8',
    );
    const event: ScreenshotEvent = {
      syncId: options.syncId,
      name: options.name,
      mimeType: 'image/png',
      filePath,
      fileSize: Buffer.byteLength(options.contents),
      createdAt: '2026-07-28T10:00:00.000Z',
      width: 1179,
      height: 2556,
    };
    screenshotListener?.(event);
    return event;
  }
});
