/**
 * Films shaped on one device are on the other: Video Studio stories and characters over Sync.
 *
 * SPEC (OGAM user's view): after I pair my Mac, a film I storyboarded there — and the person kept in
 * it — shows in Your videos on the phone, and opening it shows its shots and that person. A change I
 * make to it on the phone reaches the Mac. A film I delete on the Mac leaves the phone too.
 *
 * The real app on the real navigation stack, the real sync service, state sync and its SQLite op log,
 * and Pro's studio stores and sync wiring (registered the way pro/index.ts does). Fakes only at the
 * device boundaries: the TCP socket and discovery natives, the licence provider (licensedMesh), and the
 * Mac itself — a real sync engine with its own op log on the other end of the socket.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { OpLog, StateSync, type DeviceInfo, type Materializer } from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import type { SyncMutation } from '../../../src/services/sync/mutation';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { HOOKS, _clearHooksForTesting, registerHook } from '../../../src/bootstrap/hookRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { syncService } from '../../../pro/sync/syncService';
import { stateSyncService } from '../../../pro/sync/stateSyncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { ProRoot } from '../../../pro/ui/ProRoot';
import { LibraryScreen } from '../../../pro/video/ui/studio/LibraryScreen';
import { StoryScreen } from '../../../pro/video/ui/studio/StoryScreen';
import { MakingScreen } from '../../../pro/video/ui/studio/MakingScreen';
import { STUDIO_SCREENS } from '../../../pro/video/ui/studio/navigation';
import { startStudioSync } from '../../../pro/video/studio/studioSync';
import { useStudioStore } from '../../../pro/video/studio/studioStore';
import { getDiscoveryBoundaries, resetDiscoveryBoundaries } from '../../utils/nativeSyncBoundaries';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import { createLicensedMesh, installLicensedPhone } from '../../harness/licensedMesh';

const PHONE_FINGERPRINT = 'fp-this-phone';

jest.unmock('@react-navigation/native');
// The sync op store keeps its history in SQLite: a real database for it, the inert mock elsewhere.
jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

/** What the Mac holds: every record its op log materialized, by entity:id. */
class MacRecords implements Materializer {
  readonly records = new Map<string, Record<string, unknown>>();
  put(entity: string, entityId: string, fields: Record<string, unknown>): void {
    this.records.set(`${entity}:${entityId}`, fields);
  }
  remove(entity: string, entityId: string): void {
    this.records.delete(`${entity}:${entityId}`);
  }
}

const mesh = createLicensedMesh();
const STORY = 'mac-story-fox';
const CHARACTER = 'mac-character-mia';

describe('Video Studio over Sync', () => {
  let mac: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let stopStudioSync: (() => void) | undefined;

  beforeEach(async () => {
    mesh.reset();
    _clearHooksForTesting();
    await stateSyncService.stop();
    await syncService.stop();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    // Registered the way pro/video/index.ts registers them.
    registerScreen({ name: STUDIO_SCREENS.library, component: LibraryScreen });
    registerScreen({ name: STUDIO_SCREENS.story, component: StoryScreen });
    registerScreen({ name: STUDIO_SCREENS.making, component: MakingScreen });
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    for (const id of Object.keys(useStudioStore.getState().stories)) useStudioStore.getState().removeStory(id);
    for (const id of Object.keys(useStudioStore.getState().characters)) useStudioStore.getState().removeCharacter(id);
    registerHook(HOOKS.syncRecordLocalMutation, (mutation: SyncMutation) => {
      stateSyncService.recordMutation(mutation);
    });
    // What pro/video/index.ts starts: studio changes become sync mutations.
    stopStudioSync = startStudioSync(mutation => stateSyncService.recordMutation(mutation as unknown as SyncMutation));
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({ id: PHONE_FINGERPRINT, name: 'This phone', platform: 'ios' });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    ui?.unmount();
    ui = undefined;
    stopStudioSync?.();
    mesh.restore();
    _clearHooksForTesting();
    await stateSyncService.stop();
    await mac?.engine.stop();
    mac = undefined;
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  it('a film storyboarded on the Mac shows on the phone with its person; edits go back; a delete follows', async () => {
    const macDevice: DeviceInfo = {
      id: 'studio-mac', name: 'Studio Mac', platform: 'macos', version: '1', host: '127.0.0.1', port: 0,
    };
    const macRecords = new MacRecords();
    let opIndex = 0;
    const macLog = new OpLog({
      deviceId: macDevice.id,
      materializer: macRecords,
      uuid: () => `mac-op-${++opIndex}`,
      now: () => Date.now(),
    });
    let macState: StateSync;
    mac = buildSyncEngine({
      pairingEntitlement: mesh.joiner({ name: macDevice.name, platform: macDevice.platform }),
      localDevice: macDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
      onPaired: device => macState.onConnect(device.id),
      onAppMessage: (deviceId, channel, data) => {
        if (channel === 'state') macState.onMessage(deviceId, data);
      },
    });
    macState = new StateSync({
      oplog: macLog,
      scheduleBackfill: send => send(),
      send: (deviceId, message) => {
        mac!.engine.sendApp(deviceId, 'state', message);
      },
    });
    // What the Mac's studio wrote before pairing, in the shared wire shape (storyFields, characterFields).
    const at = Date.parse('2026-10-20T09:00:00.000Z');
    macLog.record('video_character', CHARACTER, 'put', { name: 'Mia', consentAt: at, createdAt: at, updatedAt: at });
    macLog.record('video_story', STORY, 'put', {
      title: 'Fox in the snow',
      sentence: 'a fox trotting through fresh snow',
      format: 'landscape',
      characterIds: [CHARACTER],
      shots: [
        { id: 'shot-a', index: 0, prompt: 'Wide shot of a snowy field at dawn', narration: 'It begins.', seconds: 5, start: 'cut', characterIds: [CHARACTER], status: 'pending' },
        { id: 'shot-b', index: 1, prompt: 'The fox leaps into the drift', narration: '', seconds: 7, start: 'cut', characterIds: [CHARACTER], status: 'pending' },
      ],
      voice: 'default',
      captions: true,
      quality: 'final',
      schedule: 'now',
      status: 'storyboard',
      createdAt: at,
      updatedAt: at,
    });

    await mac.engine.start(0);
    macDevice.port = mac.transport.boundPort ?? 0;
    await stateSyncService.start();
    await syncService.start();

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    // Settings › Sync, and the Mac pairs with the code on screen.
    fireEvent.press(ui.getByTestId('settings-tab'));
    await waitFor(() => expect(ui!.getByText('Model Settings')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-settings'));
    await waitFor(() => expect(ui!.getByTestId('sync-pairing-code-value')).toBeTruthy());
    const phone = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!phone || !discovery?.publishedPort) throw new Error('Sync did not publish this phone');
    await mac.engine.pair({ ...phone, host: '127.0.0.1', port: discovery.publishedPort }, await pairingCodeOnScreen(ui));

    // Home › Image Gallery › Videos: Your videos.
    fireEvent.press(ui.getAllByLabelText('Back').pop()!);
    fireEvent.press(await waitFor(() => ui!.getByTestId('home-tab')));
    fireEvent.press(await waitFor(() => ui!.getByText('Image Gallery')));
    fireEvent.press(await waitFor(() => ui!.getByText(/^Videos \(/)));
    await waitFor(() => expect(ui!.getByTestId('library-grid')).toBeTruthy());
    const film = await waitFor(() => ui!.getByText('Fox in the snow'), { timeout: 15_000 });
    expect(film).toBeTruthy();

    // Its storyboard: the Mac's shots, and Mia kept in every one.
    fireEvent.press(ui.getByTestId(`library-item-${STORY}`));
    await waitFor(() => expect(ui!.getByLabelText('Shot 2, what happens').props.value).toBe('The fox leaps into the drift'));
    expect(ui.getByLabelText('Shot 1, narration').props.value).toBe('It begins.');
    expect(ui.getByText('Mia')).toBeTruthy();
    expect(ui.getByLabelText('Captions on')).toBeTruthy();

    // Captions off on the phone reaches the Mac.
    fireEvent.press(ui.getByLabelText('Captions on'));
    await waitFor(() => expect(ui!.getByLabelText('Captions off')).toBeTruthy());
    await waitFor(() => expect(macRecords.records.get(`video_story:${STORY}`)?.captions).toBe(false), { timeout: 10_000 });

    // Deleted on the Mac, it leaves the phone.
    macLog.record('video_story', STORY, 'delete');
    macState.sendRecord(phone.id, 'video_story', STORY);
    await waitFor(() => expect(ui!.queryByLabelText('Shot 2, what happens')).toBeNull(), { timeout: 10_000 });
  }, 60_000);
});
