import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import {
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

/**
 * The activity row a rendered node sits in.
 *
 * Rows carry `sync-activity-<id>`, and a test does not know the id the transfer was given, so the row
 * is found by walking up from something inside it. Worth the few lines: this screen also has a
 * "Received" direction FILTER, so an unscoped text query matches the chip as readily as the row and
 * would pass even if the row said Sent.
 */
function activityRow(node: ReactTestInstance): ReactTestInstance {
  // The row is `sync-activity-<id>`. Its own controls are `sync-activity-open-<id>` and friends, and
  // the file name lives inside one of them - so matching the prefix alone finds the BUTTON, whose
  // subtree has no status text in it. The actions are named out to keep the row unambiguous.
  const notARow = /^sync-activity-(open|retry|cancel|dismiss|filter|filters)\b/;
  for (
    let current: ReactTestInstance | null = node;
    current;
    current = current.parent
  ) {
    const testID = current.props?.testID;
    if (
      typeof testID === 'string' &&
      testID.startsWith('sync-activity-') &&
      !notARow.test(testID)
    ) {
      return current;
    }
  }
  throw new Error('that node is not inside an activity row');
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import TcpSocket from 'react-native-tcp-socket';
import {
  FileTransferManager,
  IncrementalChecksum,
  MODEL_TRANSFER_MIME,
  type DeviceInfo,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { modelManager } from '../../../src/services/modelManager';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { modelTransferService } from '../../../pro/sync/modelTransferService';
import { modelTransferJobs } from '../../../pro/sync/modelTransferJobs';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncActivityScreen } from '../../../pro/ui/SyncScreen/SyncActivityScreen';
import { ProRoot } from '../../../pro/ui/ProRoot';
import {
  getDiscoveryBoundaries,
  resetDiscoveryBoundaries,
} from '../../utils/nativeSyncBoundaries';
import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';
import {
  createDownloadedModel,
  createVisionModel,
} from '../../utils/factories';
import { ModelTransferSheet } from '../../../pro/ui/ModelTransferSheet';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

/** This phone's fingerprint, which is also the sync device id its installation registers under. */
const PHONE_FINGERPRINT = 'fp-this-phone';

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
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return {
    __esModule: true,
    default: boundary.module,
    ...boundary.module,
  };
});

const nativeTcpBoundary = TcpSocket as unknown as RnTcpModule;

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();

describe('Pro mobile model transfer journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let remoteTransfers: FileTransferManager | undefined;
  let ui: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    mesh.reset();
    modelTransferFsBoundary.reset();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerScreen({ name: 'SyncActivity', component: SyncActivityScreen });
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    // A licensed phone has activated its OWN machine on the licence. Without that the provider answers
    // NO_MACHINE, the licence is never admitted, the installation roster is never even requested, and
    // the saved-device list has nothing to build a row from.
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
  });

  afterEach(async () => {
    mesh.restore();
    ui?.unmount();
    await remoteTransfers?.dispose();
    await remote?.engine.stop();
    await syncService.stop();
    await modelTransferService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  it('receives, rejects, and sends a GGUF through Settings to Sync', async () => {
    const remoteDevice: DeviceInfo = {
      id: 'desktop-model-source',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
      capabilities: { modelTransfer: true },
    };
    // A licensed Mac holds an installation on the licence. The phone's saved-device list is built from
    // the licence roster, so without it the peer pairs successfully and then shows up nowhere.
    mesh.register({
      id: remoteDevice.id,
      name: remoteDevice.name,
      platform: remoteDevice.platform,
    });
    let returnedModel: Buffer | undefined;
    let returnedFileName: string | undefined;

    remote = buildSyncEngine({
      pairingEntitlement: mesh.peer(),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      onMessage: (deviceId, message) => {
        remoteTransfers?.handleMessage(deviceId, message);
      },
    });
    remoteTransfers = new FileTransferManager({
      send: (deviceId, message) => remote!.engine.send(deviceId, message),
      createSink: async (_deviceId, request) => {
        const received = Buffer.alloc(request.payload.fileSize);
        return {
          prepare: async () => {
            if (returnedModel) {
              throw new Error(
                'Gemma Mobile is already installed on the receiving device',
              );
            }
            return 0;
          },
          write: async (offset: number, data: Uint8Array) => {
            Buffer.from(data).copy(received, offset);
          },
          finalize: async () => {
            const checksum = new IncrementalChecksum();
            checksum.update(received);
            if (checksum.digest() !== request.payload.checksum) return false;
            returnedModel = received;
            returnedFileName = request.payload.fileName;
            return true;
          },
          abort: async () => undefined,
        };
      },
    });

    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    modelTransferService.start();
    await syncService.start();

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('open-sync-settings')));
    // The device card marks the Sync screen having arrived. Previously this waited for the word
    // "Discoverable", which was only ever standing in for "the screen is here" - the card no longer
    // prints it when the device is simply discoverable, because the switch beneath it already does.
    await waitFor(() =>
      expect(ui!.getByTestId('sync-this-device')).toBeTruthy(),
    );

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    expect(mobile.capabilities).toEqual({ modelTransfer: true });
    const pairing = remote.engine.pair(
      {
        ...mobile,
        host: '127.0.0.1',
        port: discovery.publishedPort,
      },
      await pairingCodeOnScreen(ui),
    );
    await pairing;
    // Waited on the OUTCOME rather than the progress sheet. A correct pairing over an in-memory
    // transport finishes in a couple of milliseconds, so the sheet has been and gone before any
    // assertion can see it - and a test that waits for a flash of UI fails for a reason that has
    // nothing to do with whether pairing worked. The sheet's own behaviour belongs in a test that
    // holds an attempt open; here what matters is that the device joined the mesh.
    // STILL RED, and the reason is understood: the saved-device list is built from the licence roster,
    // and this phone holds no licence credential, so the roster comes back `unavailable` and there is
    // nothing to build a row from. The peer pairs and connects correctly - knownDevices shows it as
    // `connected` - it simply has no row. Giving the phone a licence via installLicensedPhone gets
    // further and then trips a reconciliation issue (`replacement_incomplete`) that needs its own look.
    await waitFor(() =>
      expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy(),
    );
    expect(
      useSyncStore
        .getState()
        .knownDevices.find(device => device.id === remoteDevice.id)
        ?.capabilities,
    ).toEqual({ modelTransfer: true });

    const payload = Buffer.alloc(96 * 1024 + 4, 0x5a);
    payload.write('GGUF', 0, 'ascii');
    const checksum = new IncrementalChecksum();
    checksum.update(payload);
    const fileName = 'gemma-mobile-Q4_K_M.gguf';
    await remoteTransfers.sendFile(mobile.id, {
      fileName,
      fileSize: payload.length,
      mimeType: MODEL_TRANSFER_MIME,
      metadata: {
        type: 'offgrid-model',
        version: 2,
        packageId: 'text-package',
        fileIndex: 0,
        manifest: {
          id: 'google/gemma-mobile',
          name: 'Gemma Mobile',
          kind: 'text',
          source: 'downloaded',
          files: [
            {
              name: fileName,
              sizeBytes: payload.length,
              role: 'primary',
            },
          ],
        },
      },
      checksum: async () => checksum.digest(),
      read: async (offset, length) =>
        new Uint8Array(payload.subarray(offset, offset + length)),
    });

    fireEvent.press(ui.getByTestId('sync-open-activity'));
    const arrival = await waitFor(() => ui!.getByText('Gemma Mobile'));
    // Scoped to the row. "Received" is also a direction filter on this screen, so an unscoped query
    // matches the filter chip as readily as the row and would pass even if the row said Sent.
    expect(within(activityRow(arrival)).getByText(/Received/)).toBeTruthy();
    await expect(modelManager.getDownloadedModels()).resolves.toEqual([
      expect.objectContaining({
        id: `google/gemma-mobile/${fileName}`,
        name: 'Gemma Mobile',
        author: 'google',
        engine: 'llama',
        fileName,
        fileSize: payload.length,
      }),
    ]);
    await expect(
      modelTransferFsBoundary.readAscii(
        `${modelTransferFsBoundary.DocumentDirectoryPath}/models/${fileName}`,
        4,
        0,
      ),
    ).resolves.toBe('GGUF');

    const invalidPayload = Buffer.alloc(4096, 0x58);
    const invalidChecksum = new IncrementalChecksum();
    invalidChecksum.update(invalidPayload);
    const invalidFileName = 'not-really-a-model.gguf';
    await expect(
      remoteTransfers.sendFile(mobile.id, {
        fileName: invalidFileName,
        fileSize: invalidPayload.length,
        mimeType: MODEL_TRANSFER_MIME,
        metadata: {
          type: 'offgrid-model',
          version: 2,
          packageId: 'invalid-package',
          fileIndex: 0,
          manifest: {
            id: 'offgrid/invalid-model',
            name: 'Invalid model',
            kind: 'text',
            source: 'downloaded',
            files: [
              {
                name: invalidFileName,
                sizeBytes: invalidPayload.length,
                role: 'primary',
              },
            ],
          },
        },
        checksum: async () => invalidChecksum.digest(),
        read: async (offset, length) =>
          new Uint8Array(invalidPayload.subarray(offset, offset + length)),
      }),
    ).rejects.toThrow('receiver could not verify or register the file');
    // A refused arrival is listed under the model it claimed to be, and its status node reads
    // "Could not receive - 100%" - one Text with the progress appended - so the status is matched
    // loosely and the row is found from the name the row actually shows.
    const refusal = await waitFor(() => ui!.getByText('Invalid model'));
    expect(
      within(activityRow(refusal)).getByText(/Could not receive/),
    ).toBeTruthy();
    expect(ui.queryByLabelText('Retry Invalid model')).toBeNull();
    await expect(modelManager.getDownloadedModels()).resolves.toHaveLength(1);
    await expect(
      modelTransferFsBoundary.exists(
        `${modelTransferFsBoundary.DocumentDirectoryPath}/models/${invalidFileName}`,
      ),
    ).resolves.toBe(false);
    await expect(
      modelTransferFsBoundary.exists(
        `${modelTransferFsBoundary.DocumentDirectoryPath}/models/${invalidFileName}.part`,
      ),
    ).resolves.toBe(false);

    fireEvent.press(ui.getByLabelText('Back'));
    const whisperPath = `${modelTransferFsBoundary.DocumentDirectoryPath}/whisper-models/ggml-base.bin`;
    const whisperBytes = Buffer.alloc(11 * 1024 * 1024);
    await modelTransferFsBoundary.module.writeFile(
      whisperPath,
      whisperBytes.toString('base64'),
      'base64',
    );
    fireEvent.press(ui.getByTestId(`sync-send-model-${remoteDevice.id}`));
    await waitFor(() =>
      expect(
        ui!.getByTestId(`transfer-model-google/gemma-mobile/${fileName}`),
      ).toBeTruthy(),
    );
    expect(ui.getByTestId('model-transfer-type-filter')).toBeTruthy();
    fireEvent.press(
      ui.getByTestId(`transfer-model-google/gemma-mobile/${fileName}`),
    );
    fireEvent.press(ui.getByTestId('send-selected-model'));

    await waitFor(
      () =>
        expect(
          ui!.getByText(`Gemma Mobile is available on ${remoteDevice.name}.`),
        ).toBeTruthy(),
      { timeout: 5000 },
    );
    expect(returnedFileName).toBe(fileName);
    expect(returnedModel).toEqual(payload);

    fireEvent.press(ui.getByTestId('send-selected-model'));
    await waitFor(() =>
      expect(
        ui!.getByText(
          `Gemma Mobile is already installed on ${remoteDevice.name}. Open Models on ${remoteDevice.name} to use or remove it.`,
        ),
      ).toBeTruthy(),
    );
    // The same aggregated picker resolves Whisper from its own disk registry and sends the real
    // package to a Mac. This is the Android/iOS -> macOS route that was absent when transfer queried
    // only the text-model registry.
    returnedModel = undefined;
    returnedFileName = undefined;
    fireEvent.press(
      ui.getByTestId('transfer-model-ggerganov/whisper.cpp/base'),
    );
    fireEvent.press(ui.getByTestId('send-selected-model'));
    await waitFor(
      () =>
        expect(
          ui!.getByText(`Whisper Base is available on ${remoteDevice.name}.`),
        ).toBeTruthy(),
      // This moves a real 11 MB model through the transport. The full pre-push suite runs other
      // integration tests at the same time, so allow the transfer to finish under that load.
      { timeout: 60000 },
    );
    expect(returnedFileName).toBe('ggml-base.bin');
    expect(returnedModel).toEqual(whisperBytes);
    // Not asserted: the sheet's "Sent <file>" progress line. The completion state replaces it, so
    // matching it means catching a moment that has already passed - and the outcome is covered twice
    // over, by the sentence the user reads and by the peer holding the exact bytes.
  }, 90_000);

  // A phone whose every model is vision-capable used to be told it had nothing to send: the send side
  // refused any model with an mmproj, while the receiving side had installed those packages all along.
  it('offers vision and Whisper packages to a Mac and withholds a runtime it cannot run', async () => {
    const vision = createVisionModel({
      id: 'google/gemma-4-E2B/gemma-4-E2B-it-Q4_K_M.gguf',
      name: 'Gemma 4 E2B',
      fileName: 'gemma-4-E2B-it-Q4_K_M.gguf',
      mmProjFileName: 'gemma-4-e2b-it-mmproj-F16.gguf',
    });
    const liteRT = createDownloadedModel({
      id: 'google/gemma-4-litert/gemma-4.task',
      name: 'Gemma 4 LiteRT',
      fileName: 'gemma-4.task',
      engine: 'litert',
    });
    // Installed models are a device leaf: the rows the app persisted plus the files on disk. The
    // service reads them back through its real storage, exactly as it does after a download.
    const modelsDir = `${modelTransferFsBoundary.DocumentDirectoryPath}/models`;
    await modelTransferFsBoundary.module.mkdir(modelsDir);
    for (const name of [
      vision.fileName,
      'gemma-4-e2b-it-mmproj-F16.gguf',
      liteRT.fileName,
    ]) {
      await modelTransferFsBoundary.module.writeFile(
        `${modelsDir}/${name}`,
        'x',
      );
    }
    await AsyncStorage.setItem(
      '@local_llm/downloaded_models',
      JSON.stringify([
        {
          ...vision,
          filePath: `${modelsDir}/${vision.fileName}`,
          mmProjPath: `${modelsDir}/gemma-4-e2b-it-mmproj-F16.gguf`,
        },
        { ...liteRT, filePath: `${modelsDir}/${liteRT.fileName}` },
      ]),
    );
    modelTransferFsBoundary.seedFile(
      `${modelTransferFsBoundary.DocumentDirectoryPath}/whisper-models/ggml-base.bin`,
      142 * 1024 * 1024,
    );
    const mac: DeviceInfo = {
      id: 'paired-mac',
      name: 'Mac',
      platform: 'macos',
      version: '1.0.0',
      host: '192.168.1.20',
      port: 51000,
    };

    ui = render(
      <NavigationContainer>
        <ModelTransferSheet target={mac} onClose={() => {}} />
      </NavigationContainer>,
    );

    // The vision model is offerable: GGUF runs on any Off Grid AI device, mmproj included.
    await waitFor(() =>
      expect(ui!.getByTestId(`transfer-model-${vision.id}`)).toBeTruthy(),
    );
    // LiteRT exists only on Android, so an iPhone is never offered one.
    expect(ui.queryByTestId(`transfer-model-${liteRT.id}`)).toBeNull();
    // Download Manager and model transfer both discover Whisper from its real disk registry.
    expect(
      ui.getByTestId('transfer-model-ggerganov/whisper.cpp/base'),
    ).toBeTruthy();
    expect(ui.getByText('Whisper Base')).toBeTruthy();
    // Its size is the whole package, not just the primary file.
    expect(ui.getByText(/4\.5 GB|4\.49 GB/)).toBeTruthy();
  });

  it('reopens on the model owned by the active transfer, not the first model', async () => {
    const first = createDownloadedModel({
      id: 'unsloth/qwen/first-Q4_K_M.gguf',
      name: 'First quant',
      fileName: 'first-Q4_K_M.gguf',
    });
    const moving = createDownloadedModel({
      id: 'unsloth/qwen/moving-Q4_0.gguf',
      name: 'Moving quant',
      fileName: 'moving-Q4_0.gguf',
    });
    const modelsDir = `${modelTransferFsBoundary.DocumentDirectoryPath}/models`;
    await modelTransferFsBoundary.module.mkdir(modelsDir);
    for (const model of [first, moving]) {
      await modelTransferFsBoundary.module.writeFile(
        `${modelsDir}/${model.fileName}`,
        'GGUF payload',
      );
    }
    await AsyncStorage.setItem(
      '@local_llm/downloaded_models',
      JSON.stringify(
        [first, moving].map(model => ({
          ...model,
          filePath: `${modelsDir}/${model.fileName}`,
        })),
      ),
    );
    const target: DeviceInfo = {
      id: 'paired-mac',
      name: 'Mac',
      platform: 'macos',
      version: '1.0.0',
      host: '192.168.1.10',
      port: 51000,
    };
    let active: ReturnType<typeof modelTransferJobs.start> | undefined;
    try {
      ui = render(
        <NavigationContainer>
          <ModelTransferSheet target={target} onClose={() => {}} />
        </NavigationContainer>,
      );

      await waitFor(() =>
        expect(ui!.getByTestId(`transfer-model-${first.id}`)).toBeTruthy(),
      );
      active = modelTransferJobs.start({
        direction: 'send',
        peerDeviceId: target.id,
        peerPlatform: target.platform,
        modelId: 'model-package-v1:exact-transcription-variant',
        requestedModelId: moving.id,
        modelName: moving.name,
        fileCount: 1,
        bytesTotal: moving.fileSize,
      });

      await waitFor(() =>
        expect(
          ui!.getByTestId(`transfer-model-${moving.id}`).props
            .accessibilityState.selected,
        ).toBe(true),
      );
      expect(
        ui.getByTestId(`transfer-model-${first.id}`).props.accessibilityState
          .selected,
      ).toBe(false);
    } finally {
      if (active) modelTransferJobs.dismiss(active.id);
    }
  });

  it('keeps the loaded model list when the same target is reprojected', async () => {
    const target: DeviceInfo = {
      id: 'paired-mac',
      name: 'Mac',
      platform: 'macos',
      version: '1.0.0',
      host: '192.168.1.10',
      port: 51000,
      capabilities: { modelTransfer: true },
    };
    const reads = jest.spyOn(modelManager, 'getDownloadedModels');

    ui = render(
      <NavigationContainer>
        <ModelTransferSheet target={target} onClose={() => {}} />
      </NavigationContainer>,
    );
    await waitFor(() =>
      expect(ui!.queryByTestId('model-transfer-loading')).toBeNull(),
    );
    const readsAfterLoad = reads.mock.calls.length;

    ui.rerender(
      <NavigationContainer>
        <ModelTransferSheet target={{ ...target }} onClose={() => {}} />
      </NavigationContainer>,
    );

    expect(ui.queryByTestId('model-transfer-loading')).toBeNull();
    expect(reads).toHaveBeenCalledTimes(readsAfterLoad);
    reads.mockRestore();
  });
});
