import React from 'react';
import { NativeModules } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import { CORE_SYNC_ENTITIES } from '@offgrid/application';
import {
  OpLog,
  StateSync,
  createSharedFileDescriptor,
  TASK_LAUNCH_ENTITY,
  TASK_RUN_ENTITY,
  TASK_VISUAL_STEP_ENTITY,
  taskVisualStepId,
  type DeviceInfo,
  type Materializer,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import {
  HOOKS,
  _clearHooksForTesting,
  registerHook,
} from '../../../src/bootstrap/hookRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import {
  sharedFilePutMutation,
  type SyncMutation,
} from '../../../src/services/sync/mutation';
import {
  STATE_CHANNEL,
  stateSyncService,
} from '../../../pro/sync/stateSyncService';
import { useTaskRunStore } from '../../../pro/tasks/taskRunStore';
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
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

jest.mock('@op-engineering/op-sqlite', () => {
  const { createRealSqliteModule } = require('../../harness/sqliteFake');
  return createRealSqliteModule();
});

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

const nativeTcpBoundary = TcpSocket as unknown as RnTcpModule;

class RemoteRecords implements Materializer {
  readonly records = new Map<string, Record<string, unknown>>();

  put(entity: string, entityId: string, fields: Record<string, unknown>): void {
    this.records.set(`${entity}:${entityId}`, fields);
  }

  remove(entity: string, entityId: string): void {
    this.records.delete(`${entity}:${entityId}`);
  }
}

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();
let AppNavigator: typeof import('../../../src/navigation/AppNavigator').AppNavigator;
let SyncScreen: typeof import('../../../pro/ui/SyncScreen').SyncScreen;
let SyncSharingSettingsScreen: typeof import('../../../pro/ui/SyncScreen/SyncSharingSettingsScreen').SyncSharingSettingsScreen;
let ProRoot: typeof import('../../../pro/ui/ProRoot').ProRoot;

describe('Pro mobile state sync journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let applicationFixture: MobileApplicationFixture;

  beforeAll(() => {
    const { registerMobileApplicationPorts } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    const { createMobileApplicationPorts } =
      require('../../../pro/composition/application') as typeof import('../../../pro/composition/application');
    registerMobileApplicationPorts(createMobileApplicationPorts);
    ({ AppNavigator } =
      require('../../../src/navigation/AppNavigator') as typeof import('../../../src/navigation/AppNavigator'));
    ({ SyncScreen } =
      require('../../../pro/ui/SyncScreen') as typeof import('../../../pro/ui/SyncScreen'));
    ({ SyncSharingSettingsScreen } =
      require('../../../pro/ui/SyncScreen/SyncSharingSettingsScreen') as typeof import('../../../pro/ui/SyncScreen/SyncSharingSettingsScreen'));
    ({ ProRoot } =
      require('../../../pro/ui/ProRoot') as typeof import('../../../pro/ui/ProRoot'));
  });

  beforeEach(async () => {
    (require('@op-engineering/op-sqlite') as { reset(): void }).reset();
    mesh.reset();
    _clearHooksForTesting();
    if (applicationFixture) {
      await stateSyncService.stop();
      await applicationFixture.application.sync.stop();
    }
    resetDiscoveryBoundaries();
    await AsyncStorage.clear();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerScreen({
      name: 'SyncSharingSettings',
      component: SyncSharingSettingsScreen,
    });
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    registerHook(HOOKS.syncRecordLocalMutation, (mutation: SyncMutation) => {
      stateSyncService.recordMutation(mutation);
    });
    // A licensed phone that has activated its own machine: without both, the provider never admits the
    // licence, the roster is never requested, and a peer that pairs has nowhere to appear.
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    mesh.register({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
    const { ProximityAir } =
      require('../../utils/proximityNativeBoundary') as typeof import('../../utils/proximityNativeBoundary');
    NativeModules.SyncProximityModule = new ProximityAir().device({
      id: PHONE_FINGERPRINT,
      name: 'This phone',
      platform: 'ios',
    });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    if (!applicationFixture) {
      const { startMobileApplicationFixture } =
        require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
      applicationFixture = await startMobileApplicationFixture({ pro: true });
    } else {
      await applicationFixture.application.sync.start();
    }
    const browsing = await applicationFixture.application.sync.setBrowsing(
      true,
    );
    if (!browsing.ok) throw new Error('Could not enable device discovery.');
    const discoverable =
      await applicationFixture.application.sync.setDiscoverable(true);
    if (!discoverable.ok)
      throw new Error('Could not enable device advertising.');
  });

  afterEach(async () => {
    mesh.restore();
    ui?.unmount();
    _clearHooksForTesting();
    await stateSyncService.stop();
    await remote?.engine.stop();
    await applicationFixture?.application.sync.stop();
    delete NativeModules.SyncProximityModule;
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  afterAll(async () => {
    await applicationFixture?.dispose();
  });

  it('converges state and honors visible sharing controls through the rendered app', async () => {
    const remoteDevice: DeviceInfo = {
      id: 'desktop-state-peer',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    const remoteRecords = new RemoteRecords();
    let opIndex = 0;
    const remoteLog = new OpLog({
      deviceId: remoteDevice.id,
      materializer: remoteRecords,
      uuid: () => `desktop-op-${++opIndex}`,
      now: () => Date.now(),
    });
    let remoteState: StateSync;
    remote = buildSyncEngine({
      pairingEntitlement: mesh.joiner({
        name: remoteDevice.name,
        platform: remoteDevice.platform,
      }),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
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

    const createdAt = '2026-07-27T12:00:00.000Z';
    remoteLog.record(CORE_SYNC_ENTITIES.project, 'remote-project', 'put', {
      name: 'Desktop Research',
      description: 'Notes created before pairing',
      system_prompt: 'Keep the research grounded.',
      icon: null,
      include_memory: 1,
      created_at: createdAt,
      updated_at: createdAt,
    });
    remoteLog.record(
      CORE_SYNC_ENTITIES.conversation,
      'remote-conversation',
      'put',
      {
        title: 'Field planning',
        project_id: 'remote-project',
        created_at: createdAt,
        updated_at: createdAt,
      },
    );
    remoteLog.record(CORE_SYNC_ENTITIES.message, 'remote-message', 'put', {
      conversation_id: 'remote-conversation',
      role: 'user',
      content: 'Bring the field notes',
      context: null,
      created_at: createdAt,
    });
    remoteLog.record(
      CORE_SYNC_ENTITIES.message,
      'remote-reasoning-message',
      'put',
      {
        conversation_id: 'remote-conversation',
        role: 'assistant',
        content: 'The field notes are ready.',
        context: JSON.stringify({
          reasoning: 'I should confirm the notes before answering.',
        }),
        created_at: createdAt,
      },
    );
    for (let revision = 0; revision < 20; revision += 1) {
      remoteLog.record(CORE_SYNC_ENTITIES.modelSetting, 'temperature', 'put', {
        value_json: revision === 19 ? '0.55' : '0.5',
      });
    }

    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await stateSyncService.start();

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

    let reconciliation!: ReturnType<
      typeof applicationFixture.application.sync.reconcileEntitlement
    >;
    act(() => {
      reconciliation =
        applicationFixture.application.sync.reconcileEntitlement('manual');
    });

    const sync = applicationFixture.application.sync.snapshot();
    const mobile = sync.self;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    // The authoritative roster can settle after discovery starts. Reconciliation owns the follow-up
    // scan, so the rendered journey must show that automatic work instead of briefly claiming there
    // are no devices and making the user press Rescan themselves.
    await waitFor(() => expect(ui!.getByTestId('sync-scanning')).toBeTruthy());
    expect(ui.queryByTestId('sync-no-devices')).toBeNull();
    discovery.resolve(remoteDevice);
    await waitFor(() =>
      expect(
        ui!.getByTestId(`sync-discovered-${remoteDevice.id}`),
      ).toBeTruthy(),
    );
    expect(ui.queryByTestId('sync-no-devices')).toBeNull();
    // The heading is there while there IS a device under it - the other half of the pair, so a fix that simply
    // deleted the heading would fail here.
    expect(ui.getByText('Available')).toBeTruthy();
    expect(ui.queryByTestId('sync-scanning')).toBeNull();
    expect(ui.queryByTestId('sync-rescan-error')).toBeNull();
    expect(discovery.publishedPort).toBeGreaterThan(0);
    if (!(await reconciliation).ok) {
      throw new Error('Entitlement reconciliation failed.');
    }

    // The peer presents the code this phone is showing, which is the whole confirmation.
    const firstPairing = remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await firstPairing;
    await waitFor(() =>
      expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy(),
    );

    // A live Desktop resend can publish the user turn before its new conversation reaches this
    // device. Each op arrives in its own live frame, so catch-up's batch ordering cannot repair it.
    // The durable user turn must appear when the parent arrives and survive replacement of the old
    // assistant answer.
    const sendLiveOp = (
      entity: string,
      entityId: string,
      kind: 'put' | 'delete',
      fields?: Record<string, unknown>,
    ): void => {
      const op = remoteLog.record(entity, entityId, kind, fields);
      remote!.engine.sendApp(mobile.id, STATE_CHANNEL, { t: 'ops', ops: [op] });
    };
    sendLiveOp(CORE_SYNC_ENTITIES.message, 'resend-user-message', 'put', {
      conversation_id: 'resend-conversation',
      role: 'user',
      content: 'Explain React state in one sentence.',
      context: null,
      created_at: '2026-07-27T12:01:00.000Z',
    });
    sendLiveOp(CORE_SYNC_ENTITIES.conversation, 'resend-conversation', 'put', {
      title: 'Resend keeps the user turn',
      project_id: null,
      created_at: '2026-07-27T12:00:00.000Z',
      updated_at: '2026-07-27T12:03:00.000Z',
    });
    sendLiveOp(CORE_SYNC_ENTITIES.message, 'resend-old-answer', 'put', {
      conversation_id: 'resend-conversation',
      role: 'assistant',
      content: 'The first answer that was replaced.',
      context: null,
      created_at: '2026-07-27T12:02:00.000Z',
    });
    sendLiveOp(CORE_SYNC_ENTITIES.message, 'resend-old-answer', 'delete');
    sendLiveOp(CORE_SYNC_ENTITIES.message, 'resend-new-answer', 'put', {
      conversation_id: 'resend-conversation',
      role: 'assistant',
      content: 'React state stores data that changes over time.',
      context: null,
      created_at: '2026-07-27T12:03:00.000Z',
    });

    // The "no devices found, open Sync on a nearby device" notice must NOT come back, or the screen tells the user
    // to go and do the thing they have just finished doing, directly above the device they did it to. It reads as
    // the app failing to see the peer it is holding a pairing with.
    expect(ui.queryByTestId('sync-no-devices')).toBeNull();
    // AVAILABLE now means "on the network right now", saved or not - not "not yet saved". A device you just paired
    // with is the most available thing on the screen, and burying it under SAVED next to devices that have been off
    // for weeks made the one you can actually use the hardest to find. So the heading stays, with the device under
    // it, rendered by the SAVED row template: it keeps disconnect, rename, forget and send-model, which a discovery
    // row does not have. Offering "Pair" for a device already paired is what moving the row naively would produce.
    expect(ui.getByText('Available')).toBeTruthy();
    expect(ui.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy();
    // No Saved heading at all here, and that is the point of the split: the only saved device is the one
    // reachable above, so the Saved section has nothing left and hides itself rather than captioning blank
    // space. Two headings - one from the reachable group, one from the rest - was the bug this replaced.
    expect(ui.queryAllByText('Saved')).toHaveLength(0);

    fireEvent.press(ui.getByTestId('sync-open-sharing'));
    expect(ui.getByTestId('sync-sending-accordion')).toBeTruthy();
    expect(ui.getByTestId('sync-clipboard-toggle')).toBeTruthy();

    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('projects-tab')));
    await waitFor(() => expect(ui!.getByText('Desktop Research')).toBeTruthy());
    fireEvent.press(ui.getByTestId('chats-tab'));
    await waitFor(() => expect(ui!.getByText('Field planning')).toBeTruthy());
    expect(ui.getByText('The field notes are ready.')).toBeTruthy();
    expect(ui.getByText('Desktop Research')).toBeTruthy();
    fireEvent.press(ui.getByText('Field planning'));
    await waitFor(() =>
      expect(ui!.getByText('The field notes are ready.')).toBeTruthy(),
    );
    expect(ui.getByText('Thought process')).toBeTruthy();
    fireEvent.press(ui.getByTestId('thinking-block-toggle'));
    expect(
      ui.getByText('I should confirm the notes before answering.'),
    ).toBeTruthy();
    fireEvent.press(ui.getByLabelText('Back'));

    fireEvent.press(ui.getByText('Resend keeps the user turn'));
    await waitFor(() =>
      expect(
        ui!.getByText('Explain React state in one sentence.'),
      ).toBeTruthy(),
    );
    expect(
      ui.getByText('React state stores data that changes over time.'),
    ).toBeTruthy();
    expect(ui.queryByText('The first answer that was replaced.')).toBeNull();
    fireEvent.press(ui.getByLabelText('Back'));

    const phoneMessageId = 'phone-message-after-pairing';
    const phoneMessage =
      await applicationFixture.application.workspaceContent.execute({
        type: 'append_message',
        origin: 'local',
        conversationId: 'remote-conversation',
        messageId: phoneMessageId,
        portable: {
          role: 'assistant',
          content: 'The phone checked the notes.',
          context: {
            reasoning: 'I should send the reasoning back to Desktop.',
          },
        },
      });
    if (!phoneMessage.ok) throw new Error(phoneMessage.failure.message);
    await waitFor(() =>
      expect(
        remoteRecords.records.get(
          `${CORE_SYNC_ENTITIES.message}:${phoneMessageId}`,
        ),
      ).toMatchObject({ content: 'The phone checked the notes.' }),
    );
    // The context is read as the structure it is, not as an exact string. It carries the reasoning AND
    // now a status, and pinning the whole blob turns every future field into a failure while proving
    // nothing more about the field under test.
    const deliveredContext = remoteRecords.records.get(
      `${CORE_SYNC_ENTITIES.message}:${phoneMessageId}`,
    )?.context;
    expect(deliveredContext).toMatchObject({
      reasoning: 'I should send the reasoning back to Desktop.',
    });

    fireEvent.press(ui.getByTestId('projects-tab'));
    fireEvent.press(ui.getByText('New'));
    fireEvent.changeText(
      ui.getByPlaceholderText('e.g., Spanish Learning, Code Review'),
      'Phone Notes',
    );
    fireEvent.changeText(
      ui.getByPlaceholderText(
        'Enter the instructions or context for the AI...',
      ),
      'Keep these notes concise.',
    );
    fireEvent.press(ui.getByText('Save'));

    const phoneProject = await waitFor(() => {
      const savedProject = applicationFixture.application.workspaceContent
        .snapshot()
        .projects.find(project => project.name === 'Phone Notes');
      if (!savedProject) throw new Error('Phone project was not saved');
      return savedProject;
    });
    await waitFor(() =>
      expect(
        remoteRecords.records.get(
          `${CORE_SYNC_ENTITIES.project}:${phoneProject.id}`,
        ),
      ).toMatchObject({ name: 'Phone Notes' }),
    );

    fireEvent.press(ui.getByText('Desktop Research'));
    fireEvent.press(await waitFor(() => ui!.getByText('Delete Project')));
    fireEvent.press(await waitFor(() => ui!.getByText('Delete')));
    await waitFor(() =>
      expect(
        remoteRecords.records.has(
          `${CORE_SYNC_ENTITIES.project}:remote-project`,
        ),
      ).toBe(false),
    );
    expect(
      remoteRecords.records.get(
        `${CORE_SYNC_ENTITIES.conversation}:remote-conversation`,
      ),
    ).toMatchObject({ project_id: null });
    expect(
      remoteRecords.records.get(`${CORE_SYNC_ENTITIES.message}:remote-message`),
    ).toMatchObject({ content: 'Bring the field notes' });
    fireEvent.press(ui.getByTestId('chats-tab'));
    await waitFor(() => expect(ui!.getByText('Field planning')).toBeTruthy());
    expect(ui.getByText('The phone checked the notes.')).toBeTruthy();

    fireEvent.press(ui.getByTestId('settings-tab'));
    fireEvent.press(ui.getByText('Model Settings'));
    fireEvent.press(
      await waitFor(() => ui!.getByTestId('text-generation-accordion')),
    );
    await waitFor(() =>
      expect(ui!.getByTestId('llama-temperature-value').props.children).toBe(
        '0.55',
      ),
    );
    fireEvent(
      ui.getByTestId('llama-temperature-slider'),
      'slidingComplete',
      1.25,
    );
    await waitFor(() =>
      expect(
        remoteRecords.records.get(
          `${CORE_SYNC_ENTITIES.modelSetting}:temperature`,
        ),
      ).toMatchObject({ value_json: '1.25' }),
    );

    await waitFor(() =>
      expect(remoteLog.size()).toBe(stateSyncService.opCount()),
    );
    await remote.engine.stop();
    await waitFor(() =>
      expect(
        applicationFixture!.application.sync.snapshot().connections[
          remoteDevice.id
        ],
      ).not.toBe('connected'),
    );

    fireEvent(
      ui.getByTestId('llama-temperature-slider'),
      'slidingComplete',
      0.75,
    );
    remoteLog.record(CORE_SYNC_ENTITIES.modelSetting, 'temperature', 'put', {
      value_json: '0.85',
    });
    expect(ui.getByTestId('llama-temperature-value').props.children).toBe(
      '0.75',
    );
    expect(
      remoteRecords.records.get(
        `${CORE_SYNC_ENTITIES.modelSetting}:temperature`,
      ),
    ).toMatchObject({ value_json: '0.85' });

    // Pairing again after the peer restarted. There is no accept step: the peer presents the code this
    // phone is showing and a code that matches IS the confirmation, so nothing is waiting to be tapped.
    await remote.engine.start(0);
    // Read from the store rather than the screen: this part of the journey is on another screen, and
    // the store holds the same code the Sync screen renders.
    const currentCode =
      applicationFixture.application.sync.snapshot().pairingCode?.code;
    if (!currentCode)
      throw new Error('the phone has not issued a pairing code');
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      currentCode,
    );
    await waitFor(() =>
      expect(
        applicationFixture!.application.sync.snapshot().connections[
          remoteDevice.id
        ],
      ).toBe('connected'),
    );

    const winningTemperature =
      mobile.id > remoteDevice.id
        ? { value: '0.75', json: '0.75' }
        : {
            value: '0.85',
            json: '0.85',
          };
    await waitFor(() =>
      expect(ui!.getByTestId('llama-temperature-value').props.children).toBe(
        winningTemperature.value,
      ),
    );
    await waitFor(() =>
      expect(
        remoteRecords.records.get(
          `${CORE_SYNC_ENTITIES.modelSetting}:temperature`,
        ),
      ).toMatchObject({ value_json: winningTemperature.json }),
    );

    const persistedOpCount = stateSyncService.opCount();
    ui.unmount();
    ui = undefined;
    await stateSyncService.stop();
    await stateSyncService.start();
    await stateSyncService.whenReady();
    // The log is collapsed at startup, so it comes back SMALLER, not identical - superseded ops are
    // dropped and only the winner for each record is kept. What has to survive is the state itself,
    // which the temperature below is read for. A log that came back empty, or bigger, would be wrong.
    expect(stateSyncService.opCount()).toBeGreaterThan(0);
    expect(stateSyncService.opCount()).toBeLessThanOrEqual(persistedOpCount);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);

    ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    fireEvent.press(ui.getByText('Model Settings'));
    fireEvent.press(
      await waitFor(() => ui!.getByTestId('text-generation-accordion')),
    );
    expect(ui.getByTestId('llama-temperature-value').props.children).toBe(
      winningTemperature.value,
    );
  }, 30_000);

  it('starts before slow owners finish, reconnects, and rejects forged task state', async () => {
    let releaseSlowStartup: (() => void) | undefined;
    const slowStartup = new Promise<void>(resolve => {
      releaseSlowStartup = resolve;
    });
    const reconciliation =
      await applicationFixture.application.sync.reconcileEntitlement('manual');
    if (!reconciliation.ok) {
      throw new Error('Entitlement reconciliation failed.');
    }
    const stateStartup = stateSyncService.start(slowStartup);
    await stateStartup;
    expect(applicationFixture.application.sync.snapshot().running).toBe(true);

    const remoteDevice: DeviceInfo = {
      id: 'desktop-task-owner',
      name: 'Office Mac',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    let opIndex = 0;
    const remoteLog = new OpLog({
      deviceId: remoteDevice.id,
      deviceName: remoteDevice.name,
      materializer: new RemoteRecords(),
      uuid: () => `owner-op-${++opIndex}`,
      now: () => Date.now(),
    });
    const task = {
      version: 1 as const,
      launchId: 'launch-during-slow-startup',
      requestingDeviceId: remoteDevice.id,
      taskId: 'task-during-slow-startup',
      conversationId: 'chat-during-slow-startup',
      kind: 'computer_use' as const,
      executionDevice: {
        id: remoteDevice.id,
        name: remoteDevice.name,
      },
      title: 'Open the report',
      status: 'running' as const,
      progress: [],
      startedAt: 1,
      updatedAt: 1,
    };
    remoteLog.record(TASK_LAUNCH_ENTITY, task.launchId, 'put', {
      version: 1,
      launchId: task.launchId,
      conversationId: task.conversationId,
      kind: task.kind,
      requestingDeviceId: task.requestingDeviceId,
      executionDeviceId: task.executionDevice.id,
      requestedAt: 1,
    });
    remoteLog.record(TASK_RUN_ENTITY, task.taskId, 'put', task);
    const visualStep = {
      version: 1 as const,
      visualStepId: taskVisualStepId(task.taskId, 1),
      taskId: task.taskId,
      conversationId: task.conversationId,
      sequence: 1,
      executionDevice: task.executionDevice,
      phase: 'observing',
      actionLabel: 'Open the report',
      frame: {
        sequence: 1,
        mimeType: 'image/jpeg' as const,
        payloadBase64: 'c2NyZWVu',
        width: 100,
        height: 50,
        capturedAt: 1,
      },
    };
    remoteLog.record(
      TASK_VISUAL_STEP_ENTITY,
      visualStep.visualStepId,
      'put',
      visualStep,
    );
    let remoteState: StateSync;
    remote = buildSyncEngine({
      pairingEntitlement: mesh.joiner({
        name: remoteDevice.name,
        platform: remoteDevice.platform,
      }),
      localDevice: remoteDevice,
      tcpModule: nativeTcpBoundary,
      onPaired: device => remoteState.onConnect(device.id),
      onAppMessage: (deviceId, channel, data) => {
        if (channel === STATE_CHANNEL) remoteState.onMessage(deviceId, data);
      },
    });
    remoteState = new StateSync({
      oplog: remoteLog,
      send: (deviceId, message) =>
        remote!.engine.sendApp(deviceId, STATE_CHANNEL, message),
    });
    await remote.engine.start(0);

    const sync = applicationFixture.application.sync.snapshot();
    const mobile = sync.self;
    const discovery = getDiscoveryBoundaries().at(-1);
    const pairingCode = sync.pairingCode?.code;
    if (!mobile || !discovery?.publishedPort || !pairingCode) {
      throw new Error(
        'Mobile Sync did not become available during slow startup',
      );
    }
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      pairingCode,
    );
    await waitFor(() =>
      expect(
        applicationFixture!.application.sync.snapshot().connections[
          remoteDevice.id
        ],
      ).toBe('connected'),
    );

    const screenshot = createSharedFileDescriptor({
      syncId: '66e332d1-1809-4d70-a6da-36095c8cb5c9',
      kind: 'screenshot',
      name: 'Screenshot 2026-09-09 at 12.45.06 AM.png',
      mimeType: 'image/png',
      fileSize: 382_000,
      createdAt: '2026-09-09T07:45:06.000Z',
      width: 1179,
      height: 2556,
    });
    if (!screenshot) throw new Error('The screenshot descriptor was invalid.');
    await stateSyncService.stageMutation(sharedFilePutMutation(screenshot));
    expect(
      stateSyncService.sendSharedFileRecord(
        remoteDevice.id,
        screenshot.syncId,
      ),
    ).toBe(true);

    releaseSlowStartup?.();
    await stateSyncService.whenReady();

    await waitFor(() =>
      expect(useTaskRunStore.getState().runs[task.taskId]).toMatchObject({
        title: task.title,
        executionDevice: task.executionDevice,
      }),
    );
    await waitFor(() =>
      expect(
        useTaskRunStore.getState().visualSteps[visualStep.visualStepId],
      ).toMatchObject({ actionLabel: visualStep.actionLabel }),
    );

    const ownerUpdate = remoteLog.record(TASK_RUN_ENTITY, task.taskId, 'put', {
      ...task,
      updatedAt: 2,
      currentAction: 'Read the report',
    });
    remote.engine.sendApp(mobile.id, STATE_CHANNEL, {
      t: 'ops',
      ops: [
        {
          opId: 'forged-put',
          entity: TASK_RUN_ENTITY,
          entityId: 'forged-task',
          kind: 'put',
          fields: { ...task, taskId: 'forged-task' },
          lamport: 100,
          deviceId: 'forged-device',
          ts: 100,
          provenance: {
            originDeviceId: remoteDevice.id,
            originDeviceName: remoteDevice.name,
          },
        },
        {
          opId: 'forged-delete',
          entity: TASK_RUN_ENTITY,
          entityId: task.taskId,
          kind: 'delete',
          lamport: 101,
          deviceId: 'forged-device',
          ts: 101,
          provenance: {
            originDeviceId: 'forged-device',
            originDeviceName: 'Forged device',
          },
        },
        ownerUpdate,
      ],
    });
    await waitFor(() =>
      expect(useTaskRunStore.getState().runs[task.taskId]?.updatedAt).toBe(2),
    );
    expect(useTaskRunStore.getState().runs['forged-task']).toBeUndefined();
    expect(useTaskRunStore.getState().runs[task.taskId]?.title).toBe(
      task.title,
    );
  }, 30_000);
});
