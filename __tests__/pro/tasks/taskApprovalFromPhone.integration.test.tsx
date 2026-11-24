/**
 * A task started from the phone asks for an approval on the computer: the phone answers it.
 *
 * SPEC (OGAM user's view): my Mac is running a task from this chat and stops to ask "Send the
 * email?". The task card on my phone shows the request with Approve and Reject. When I tap Approve,
 * the Mac receives my answer in the same request, still as its own request, so it runs the action.
 *
 * The real sync service, state sync and its SQLite op log, the real materializer and task card. Fakes
 * only at the device boundaries: the TCP socket and discovery natives, the licence provider
 * (licensedMesh), and the Mac itself — a real sync engine with its own op log on the other end.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  ACTION_APPROVAL_ENTITY,
  OpLog,
  StateSync,
  TASK_LAUNCH_ENTITY,
  TASK_RUN_ENTITY,
  type DeviceInfo,
  type Materializer,
  type RecordProvenance,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { syncService } from '../../../pro/sync/syncService';
import { stateSyncService } from '../../../pro/sync/stateSyncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { TaskChatCard } from '../../../pro/ui/TaskChatCard';
import { getDiscoveryBoundaries, resetDiscoveryBoundaries } from '../../utils/nativeSyncBoundaries';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import { createLicensedMesh, installLicensedPhone } from '../../harness/licensedMesh';

const PHONE_FINGERPRINT = 'fp-this-phone';

jest.unmock('@react-navigation/native');
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

/** What the Mac holds: each record its op log materialized, with the record's creator. */
class MacRecords implements Materializer {
  readonly records = new Map<string, { fields: Record<string, unknown>; provenance?: RecordProvenance }>();
  put(entity: string, entityId: string, fields: Record<string, unknown>, provenance?: RecordProvenance): void {
    this.records.set(`${entity}:${entityId}`, { fields, provenance });
  }
  remove(entity: string, entityId: string): void {
    this.records.delete(`${entity}:${entityId}`);
  }
}

const mesh = createLicensedMesh();
const CHAT = 'phone-chat-send-email';
const ACTION = 'action-send-email';

describe('Approving a computer task from the phone', () => {
  let mac: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let card: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    mesh.reset();
    await stateSyncService.stop();
    await syncService.stop();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    useAppStore.getState().setOnboardingComplete(true);
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({ id: PHONE_FINGERPRINT, name: 'This phone', platform: 'ios' });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    card?.unmount();
    card = undefined;
    ui?.unmount();
    ui = undefined;
    mesh.restore();
    await stateSyncService.stop();
    await mac?.engine.stop();
    mac = undefined;
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  it('shows the request on the task card, and Approve reaches the Mac as its own request', async () => {
    const macDevice: DeviceInfo = {
      id: 'office-mac', name: 'Office Mac', platform: 'macos', version: '1', host: '127.0.0.1', port: 0,
    };
    // The Mac is running a task from this phone's chat, and the task stopped for an approval.
    const startedAt = Date.parse('2026-11-20T09:00:00.000Z');
    const macRecords = new MacRecords();
    let opIndex = 0;
    const macLog = new OpLog({
      deviceId: macDevice.id,
      deviceName: macDevice.name,
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
    macLog.record('conversation', CHAT, 'put', {
      title: 'Email the venue',
      created_at: new Date(startedAt).toISOString(),
      updated_at: new Date(startedAt).toISOString(),
      project_id: null,
    });
    await mac.engine.start(0);
    macDevice.port = mac.transport.boundPort ?? 0;
    await stateSyncService.start();
    await syncService.start();

    ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    await waitFor(() => expect(ui!.getByText('Model settings')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-settings'));
    await waitFor(() => expect(ui!.getByTestId('sync-pairing-code-value')).toBeTruthy());
    const phone = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!phone || !discovery?.publishedPort) throw new Error('Sync did not publish this phone');
    // The phone started this task from its chat: its own launch record names the Mac to run it. A run
    // the phone never launched is forged state and is refused, so the Mac answers this launch.
    stateSyncService.recordMutation({
      entity: TASK_LAUNCH_ENTITY,
      entityId: 'launch-send-email',
      kind: 'put',
      fields: {
        version: 1,
        launchId: 'launch-send-email',
        conversationId: CHAT,
        kind: 'web_use',
        requestingDeviceId: phone.id,
        executionDeviceId: macDevice.id,
        requestedAt: startedAt,
      },
    });
    macLog.record(TASK_RUN_ENTITY, 'task-send-email', 'put', {
      version: 1,
      launchId: 'launch-send-email',
      requestingDeviceId: phone.id,
      taskId: 'task-send-email',
      conversationId: CHAT,
      kind: 'web_use',
      executionDevice: { id: macDevice.id, name: macDevice.name },
      title: 'Email the venue',
      status: 'running',
      phase: 'acting',
      currentAction: 'Writing the email',
      progress: [],
      startedAt,
      updatedAt: startedAt + 1,
    });
    macLog.record(ACTION_APPROVAL_ENTITY, ACTION, 'put', {
      version: 1,
      actionId: ACTION,
      executionChatId: 'mac-execution-chat',
      title: 'Send the email to the venue',
      args: { to: 'venue@example.com' },
      risk: 'mutate',
      status: 'pending',
      createdAt: startedAt + 2,
      updatedAt: startedAt + 2,
    });

    await mac.engine.pair({ ...phone, host: '127.0.0.1', port: discovery.publishedPort }, await pairingCodeOnScreen(ui));

    // The chat's task card, as the chat shows it.
    await waitFor(
      () => expect(useChatStore.getState().conversations.some(item => item.id === CHAT)).toBe(true),
      { timeout: 15_000 },
    );
    useChatStore.getState().setActiveConversation(CHAT);
    card = render(
      <NavigationContainer>
        <TaskChatCard
          message={{ toolName: 'web_use', toolCallId: 'call-send-email', content: 'Task started. Task reference: task-send-email.' }}
        />
      </NavigationContainer>,
    );
    await waitFor(() => expect(card!.getByText('Send the email to the venue')).toBeTruthy(), { timeout: 15_000 });
    expect(card.getByText('Needs your approval')).toBeTruthy();

    fireEvent.press(card.getByTestId('task-approval-approve'));
    await waitFor(() => expect(card!.getByTestId('task-approval-sent')).toBeTruthy());

    // The Mac has the answer in its own request: it is still the Mac's, so the Mac runs it.
    await waitFor(() => {
      const record = macRecords.records.get(`${ACTION_APPROVAL_ENTITY}:${ACTION}`);
      expect(record?.fields.decision).toMatchObject({ kind: 'approve', deviceId: phone.id });
      expect(record?.fields.status).toBe('pending');
      expect(record?.provenance?.originDeviceId).toBe(macDevice.id);
    }, { timeout: 10_000 });
  }, 60_000);
});
