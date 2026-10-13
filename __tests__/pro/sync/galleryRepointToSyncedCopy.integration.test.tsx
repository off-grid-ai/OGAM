/**
 * A Gallery image whose own file is gone is drawn from the copy that synced back.
 *
 * DEVICE (pro a5537976, iPhone): six images made on the phone pointed at generated_images files that
 * had been removed, while the same images - sent to the Mac and back under the same id - sat in
 * shared_files. The Gallery drew a blank tile over bytes that were still on the device.
 *
 * SPEC (OGAM user's view): if this phone holds the picture, the Gallery shows it. A record whose
 * original file is missing, once the synced copy is on the phone, shows the picture from that copy.
 *
 * Journey: the phone's disk holds a Gallery record whose generated_images file is gone (restored as
 * the app restores it on launch). The user opens the Gallery from Home and sees a blank tile. The
 * Desktop pairs and sends the same image back under the same id, over the real sync engine and file
 * transfer (in-memory TCP, real SQLite op store). The user opens the Gallery again and the picture
 * loads. The image decoder is the native boundary: it loads a tile only when its file exists.
 */
import { Buffer } from 'buffer';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  act,
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import {
  FileTransferManager,
  IncrementalChecksum,
  OpLog,
  SHARED_FILE_ENTITY,
  SHARED_FILE_MIME,
  StateSync,
  createSharedFileStateFields,
  createSharedFileDescriptor,
  createSharedFileTransferMetadata,
  generatedImageMetadataJson,
  type DeviceInfo,
  type StateMsg,
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
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { stateSyncService } from '../../../pro/sync/stateSyncService';
import { sharedFileSyncService } from '../../../pro/sync/sharedFileSyncService';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncHomeCard } from '../../../pro/ui/SyncHomeCard';
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
import { decodeRenderedImages } from '../../harness/nativeImageLoader';

const PHONE_FINGERPRINT = 'fp-this-phone';

jest.unmock('@react-navigation/native');

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

const desktopDevice: DeviceInfo = {
  id: 'desktop-gallery-peer',
  name: 'Off Grid AI Desktop',
  platform: 'macos',
  version: '1',
  host: '127.0.0.1',
  port: 0,
};

const mesh = createLicensedMesh();

const IMAGE_ID = '77777777-7777-4777-8777-777777777777';
const PROMPT = 'a lighthouse at dusk';
const IMAGE_NAME = `${IMAGE_ID}.png`;
const IMAGE_BYTES = Buffer.from('lighthouse png bytes');
const ORIGINAL_PATH = `${modelTransferFsBoundary.DocumentDirectoryPath}/generated_images/${IMAGE_NAME}`;

describe('Gallery record repointed at its synced copy', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let remoteTransfers: FileTransferManager | undefined;
  let ui: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    mesh.reset();
    modelTransferFsBoundary.reset();
    resetDiscoveryBoundaries();
    await AsyncStorage.clear();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    _clearSlotsForTesting();
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
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({ id: PHONE_FINGERPRINT, name: 'This phone', platform: 'ios' });
    mesh.register({
      id: desktopDevice.id,
      name: desktopDevice.name,
      platform: 'macos',
    });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    mesh.restore();
    ui?.unmount();
    await remoteTransfers?.dispose();
    await remote?.engine.stop();
    await stateSyncService.stop();
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    _clearSlotsForTesting();
    jest.restoreAllMocks();
  });

  it('shows the picture from the synced copy instead of a blank tile once the copy is on the phone', async () => {
    // DISK, as the phone was left: the persisted Gallery record for an image made here, whose
    // generated_images file has since been removed. The app restores it the way launch does.
    const persisted = JSON.parse(
      (await AsyncStorage.getItem('local-llm-app-storage')) ?? '{"state":{},"version":0}',
    );
    await AsyncStorage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        ...persisted,
        state: {
          ...persisted.state,
          generatedImages: [
            {
              id: IMAGE_ID,
              prompt: PROMPT,
              imagePath: ORIGINAL_PATH,
              fileName: IMAGE_NAME,
              width: 512,
              height: 512,
              steps: 8,
              seed: 17,
              modelId: 'off-grid/image',
              createdAt: '2026-10-01T09:00:00.000Z',
            },
          ],
        },
      }),
    );
    await act(async () => {
      await useAppStore.persist.rehydrate();
    });

    // The Desktop: a real sync engine, op log and file transfer manager over in-memory TCP.
    const remoteLog = new OpLog({
      deviceId: desktopDevice.id,
      materializer: { put: () => undefined, remove: () => undefined },
      uuid: (() => {
        let index = 0;
        return () => `desktop-gallery-op-${++index}`;
      })(),
      now: () => Date.now(),
    });
    let remoteState: StateSync;
    remote = buildSyncEngine({
      pairingEntitlement: mesh.joiner({
        name: desktopDevice.name,
        platform: desktopDevice.platform,
      }),
      localDevice: desktopDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
      onMessage: (deviceId, message) => {
        remoteTransfers?.handleMessage(deviceId, message);
      },
      onAppMessage: (deviceId, channel, data) => {
        if (channel === 'state') remoteState.onMessage(deviceId, data as StateMsg);
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
      createSink: async () => null,
    });

    await remote.engine.start(0);
    desktopDevice.port = remote.transport.boundPort ?? 0;
    await sharedFileSyncService.start({
      stageStateMutation: mutation => stateSyncService.stageMutation(mutation),
      recordStateMutation: mutation => stateSyncService.recordMutation(mutation),
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
    await act(async () => {
      await syncService.start();
    });

    // BEFORE: the Gallery holds the record, and its tile is blank - the file it names is gone.
    fireEvent.press(await waitFor(() => ui!.getByText('Image Gallery')));
    const tile = await waitFor(() => ui!.getByTestId(`gallery-image-${IMAGE_ID}`));
    expect(await modelTransferFsBoundary.module.exists(ORIGINAL_PATH)).toBe(false);
    const before = await decodeRenderedImages(tile, modelTransferFsBoundary.module);
    expect(before).toEqual([{ uri: `file://${ORIGINAL_PATH}`, loaded: false }]);
    expect(
      ui.getByLabelText(`Generated image unavailable: ${PROMPT}`),
    ).toBeTruthy();
    expect(ui.queryByLabelText(`Generated image loaded: ${PROMPT}`)).toBeNull();
    fireEvent.press(ui.getByLabelText('Close gallery'));

    // The user pairs the Desktop from Settings > Sync.
    fireEvent.press(await waitFor(() => ui!.getByTestId('settings-tab')));
    fireEvent.press(await waitFor(() => ui!.getByTestId('open-sync-settings')));
    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await waitFor(() =>
      expect(
        within(ui!.getByTestId(`sync-paired-${desktopDevice.id}`)).getByText(
          /Connected/,
        ),
      ).toBeTruthy(),
    );

    // The Desktop sends the same image back under the same id: the bytes, then the record.
    // Built by the shared builder a sender uses, so the envelope is exactly what a peer would send.
    const descriptor = createSharedFileDescriptor({
      syncId: IMAGE_ID,
      kind: 'generated_media',
      name: IMAGE_NAME,
      mimeType: 'image/png',
      fileSize: IMAGE_BYTES.length,
      createdAt: '2026-10-01T09:00:00.000Z',
      width: 512,
      height: 512,
      metadataJson: generatedImageMetadataJson({
        prompt: PROMPT,
        steps: 8,
        seed: 17,
        modelId: 'off-grid/image',
      }),
    });
    if (!descriptor) throw new Error('the Desktop could not describe the image');
    const checksum = new IncrementalChecksum();
    checksum.update(IMAGE_BYTES);
    await remoteTransfers.sendFile(mobile.id, {
      fileName: descriptor.name,
      fileSize: descriptor.fileSize,
      mimeType: SHARED_FILE_MIME,
      metadata: createSharedFileTransferMetadata(descriptor),
      checksum: async () => checksum.digest(),
      read: async (offset: number, length: number) =>
        new Uint8Array(IMAGE_BYTES.subarray(offset, offset + length)),
    });
    const controlOp = remoteLog.record(
      SHARED_FILE_ENTITY,
      IMAGE_ID,
      'put',
      createSharedFileStateFields(descriptor),
    );
    remote.engine.sendApp(mobile.id, 'state', { t: 'ops', ops: [controlOp] });

    // The synced copy lands in the phone's shared files.
    const syncedCopy = `${modelTransferFsBoundary.DocumentDirectoryPath}/shared_files/generated_media/${IMAGE_ID}-${IMAGE_NAME}`;
    await waitFor(async () =>
      expect(await modelTransferFsBoundary.module.exists(syncedCopy)).toBe(true),
    );

    // AFTER: back on Home, the user opens the Gallery again and the picture loads.
    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('home-tab')));
    fireEvent.press(await waitFor(() => ui!.getByText('Image Gallery')));
    await waitFor(async () => {
      const shown = ui!.getByTestId(`gallery-image-${IMAGE_ID}`);
      const decoded = await decodeRenderedImages(shown, modelTransferFsBoundary.module);
      expect(decoded).toEqual([{ uri: `file://${syncedCopy}`, loaded: true }]);
    });
    expect(ui.getByLabelText(`Generated image loaded: ${PROMPT}`)).toBeTruthy();
    // Still one picture, not the record plus a duplicate.
    expect(ui.getAllByTestId(/^gallery-image-/)).toHaveLength(1);
  }, 30_000);
});
