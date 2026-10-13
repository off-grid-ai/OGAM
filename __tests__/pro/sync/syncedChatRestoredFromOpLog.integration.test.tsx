/**
 * A synced chat that only survives in the sync history still shows its full text after a relaunch.
 *
 * Pro c8cbcad1 (with shared #46): the phone keeps each stored op's payload in SQLite and reads it on
 * use, instead of holding the whole history in memory. That payload is what rebuilds a chat on the
 * next launch when the chat itself was not saved - the app killed after a synced turn reached the
 * sync history but before the chat list was written to disk.
 *
 * SPEC (OGAM user's view): a message that synced to this phone is still there, word for word, after
 * the app is reopened.
 *
 * Journey: a real sync round over the real engine (in-memory TCP, real SQLite op store). The Desktop
 * pairs and sends a chat; the user opens it and reads the whole message. The app is then killed
 * before the chat list reached disk (the on-disk chat store is the one from before the sync) and
 * reopened with the Desktop gone. The chat is not on screen until sync history loads; then it is,
 * with the message in full. Nothing re-sent it: the Desktop is offline for the relaunch.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import {
  OpLog,
  StateSync,
  type DeviceInfo,
  type Materializer,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  _clearScreensForTesting,
  registerScreen,
} from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import {
  HOOKS,
  _clearHooksForTesting,
  registerHook,
} from '../../../src/bootstrap/hookRegistry';
import { _clearSlotsForTesting } from '../../../src/bootstrap/slotRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import {
  CORE_SYNC_ENTITIES,
  type SyncMutation,
} from '../../../src/services/sync/mutation';
import { syncService } from '../../../pro/sync/syncService';
import { stateSyncService } from '../../../pro/sync/stateSyncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { ProRoot } from '../../../pro/ui/ProRoot';
import {
  getDiscoveryBoundaries,
  resetDiscoveryBoundaries,
} from '../../utils/nativeSyncBoundaries';
import { createDownloadedModel } from '../../utils/factories';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

const PHONE_FINGERPRINT = 'fp-this-phone';
const CHAT_STORAGE_KEY = 'local-llm-chat-storage';

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

class RemoteRecords implements Materializer {
  readonly records = new Map<string, Record<string, unknown>>();
  put(entity: string, entityId: string, fields: Record<string, unknown>): void {
    this.records.set(`${entity}:${entityId}`, fields);
  }
  remove(entity: string, entityId: string): void {
    this.records.delete(`${entity}:${entityId}`);
  }
}

const mesh = createLicensedMesh();

const CHAT_TITLE = 'Harbour survey notes';
// Long enough that a payload cut short, or read back empty, cannot pass for the real thing.
const MESSAGE_TEXT =
  'The harbour survey starts at the north breakwater at six, moves along the fuel pier by eight, ' +
  'and finishes at the ferry ramp before the tide turns. Bring the depth sounder, the spare ' +
  'batteries, the laminated chart of the inner basin and two copies of the mooring list. Record ' +
  'every bollard that shows rust past the collar and photograph the cracked fender on berth four. ' +
  'If the wind is above twenty knots, skip the outer wall and survey the slipway instead. ' +
  'Last line of the brief: meet at the harbour office at noon.';

describe('synced chat restored from the sync history on relaunch', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    mesh.reset();
    _clearHooksForTesting();
    await stateSyncService.stop();
    await syncService.stop();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    _clearSlotsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    useChatStore.getState().clearAllConversations();
    registerHook(HOOKS.syncRecordLocalMutation, (mutation: SyncMutation) => {
      stateSyncService.recordMutation(mutation);
    });
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({ id: PHONE_FINGERPRINT, name: 'This phone', platform: 'ios' });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    mesh.restore();
    ui?.unmount();
    _clearHooksForTesting();
    await stateSyncService.stop();
    await remote?.engine.stop();
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    _clearSlotsForTesting();
  });

  const renderApp = () =>
    render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );

  it('shows the synced message in full after a relaunch that lost the saved chat list', async () => {
    const remoteDevice: DeviceInfo = {
      id: 'desktop-history-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    let opIndex = 0;
    const remoteLog = new OpLog({
      deviceId: remoteDevice.id,
      materializer: new RemoteRecords(),
      uuid: () => `desktop-history-op-${++opIndex}`,
      now: () => Date.now(),
    });
    let remoteState: StateSync;
    remote = buildSyncEngine({
      pairingEntitlement: mesh.joiner({
        name: remoteDevice.name,
        platform: remoteDevice.platform,
      }),
      localDevice: remoteDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
      onPaired: device => remoteState.onConnect(device.id),
      onAppMessage: (deviceId, channel, data) => {
        if (channel === 'state') remoteState.onMessage(deviceId, data);
      },
    });
    remoteState = new StateSync({
      oplog: remoteLog,
      send: (deviceId, message) => {
        remote!.engine.sendApp(deviceId, 'state', message);
      },
    });

    const createdAt = '2026-10-08T07:00:00.000Z';
    remoteLog.record(CORE_SYNC_ENTITIES.conversation, 'harbour-conversation', 'put', {
      title: CHAT_TITLE,
      project_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
    remoteLog.record(CORE_SYNC_ENTITIES.message, 'harbour-message', 'put', {
      conversation_id: 'harbour-conversation',
      role: 'assistant',
      content: MESSAGE_TEXT,
      context: null,
      created_at: createdAt,
    });

    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await stateSyncService.start();
    await syncService.start();

    // The chat list as saved on disk before any sync: the copy a kill before the next save leaves.
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(CHAT_STORAGE_KEY)).not.toBeNull(),
    );
    const chatsOnDiskBeforeSync = (await AsyncStorage.getItem(CHAT_STORAGE_KEY))!;

    ui = renderApp();
    fireEvent.press(ui.getByTestId('settings-tab'));
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
      expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy(),
    );

    // The synced chat reaches the phone and reads in full.
    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('chats-tab')));
    fireEvent.press(await waitFor(() => ui!.getByText(CHAT_TITLE)));
    await waitFor(() => expect(ui!.getByText(MESSAGE_TEXT)).toBeTruthy());

    // KILL: the Desktop goes away, the app dies before the chat list is saved again.
    ui.unmount();
    ui = undefined;
    await remote.engine.stop();
    remote = undefined;
    await stateSyncService.stop();
    await syncService.stop();
    await AsyncStorage.setItem(CHAT_STORAGE_KEY, chatsOnDiskBeforeSync);

    // RELAUNCH: the chat list is restored from disk as launch restores it. BEFORE sync history
    // loads, the synced chat is not on screen.
    await act(async () => {
      await useChatStore.persist.rehydrate();
    });
    ui = renderApp();
    // This journey's model list was never written to disk, so the relaunched app offers setup first.
    fireEvent.press(await waitFor(() => ui!.getByTestId('auto-setup-skip')));
    fireEvent.press(await waitFor(() => ui!.getByTestId('chats-tab')));
    expect(ui.queryByText(CHAT_TITLE)).toBeNull();
    expect(ui.queryByText(MESSAGE_TEXT)).toBeNull();

    // Sync starts with the app. The chat comes back from the stored history, word for word.
    await act(async () => {
      await stateSyncService.start();
      await syncService.start();
    });
    fireEvent.press(await waitFor(() => ui!.getByText(CHAT_TITLE)));
    await waitFor(() => expect(ui!.getByText(MESSAGE_TEXT)).toBeTruthy());
  }, 30_000);
});
