import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import {
  OpLog,
  StateSync,
  TASK_LAUNCH_ENTITY,
  TASK_RUN_ENTITY,
  TASK_VISUAL_STEP_ENTITY,
  serializeSyncedMessageContext,
  taskVisualStepId,
  type DeviceInfo,
  type Materializer,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
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
import { useChatStore } from '../../../src/stores/chatStore';
import { useProjectStore } from '../../../src/stores/projectStore';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import {
  CORE_SYNC_ENTITIES,
  messagePutMutation,
  type SyncMutation,
} from '../../../src/services/sync/mutation';
import { syncService } from '../../../pro/sync/syncService';
import {
  STATE_CHANNEL,
  stateSyncService,
} from '../../../pro/sync/stateSyncService';
import { useTaskRunStore } from '../../../pro/tasks/taskRunStore';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncSharingSettingsScreen } from '../../../pro/ui/SyncScreen/SyncSharingSettingsScreen';
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

describe('Pro mobile state sync journey', () => {
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
    useSyncStore.getState().reset();
    useChatStore.getState().clearAllConversations();
    for (const project of useProjectStore.getState().projects) {
      useProjectStore.getState().deleteProject(project.id);
    }
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
    let remoteStateOpsSent = 0;
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
        if (message.t === 'ops') remoteStateOpsSent += message.ops.length;
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
    const toolRequest = messagePutMutation('remote-conversation', {
      id: 'remote-tool-request',
      uuid: 'remote-tool-request',
      role: 'assistant',
      content: '',
      timestamp: new Date(createdAt).getTime(),
      toolCalls: [
        {
          id: 'contacts-search-call',
          name: 'contacts_search',
          arguments: '{"query":"ali hafizji"}',
        },
      ],
    });
    if (!toolRequest?.fields)
      throw new Error('Tool request was not serialized');
    remoteLog.record(
      toolRequest.entity,
      toolRequest.entityId,
      toolRequest.kind,
      toolRequest.fields,
    );
    remoteLog.record(
      CORE_SYNC_ENTITIES.message,
      'remote-reasoning-message',
      'put',
      {
        conversation_id: 'remote-conversation',
        role: 'assistant',
        content: 'The field notes are ready.',
        context: serializeSyncedMessageContext({
          reasoning: 'I should confirm the notes before answering.',
          timeline: [
            {
              kind: 'thinking',
              text: 'I should confirm the notes before searching.',
            },
            { kind: 'tool', toolIndex: 0 },
            {
              kind: 'thinking',
              text: 'The search result is enough to answer.',
            },
          ],
          toolCalls: [
            {
              name: 'web_search',
              result: 'The field notes were found.',
              status: 'completed',
            },
          ],
          metrics: { modelName: 'Field Model', decodeTokensPerSecond: 42.5, completionTokens: 128 },
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
    fireEvent.press(ui.getByText('Model Settings'));
    fireEvent.press(ui.getByTestId('text-generation-accordion'));
    fireEvent.press(ui.getByTestId('show-gen-details-on-button'));
    fireEvent.press(ui.getByLabelText('Back'));
    fireEvent.press(await waitFor(() => ui!.getByTestId('open-sync-settings')));

    const mobile = useSyncStore.getState().thisDevice;
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

    // The peer presents the code this phone is showing, which is the whole confirmation.
    const firstPairing = remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      await pairingCodeOnScreen(ui),
    );
    await firstPairing;
    await waitFor(() =>
      expect(ui!.getByTestId(`sync-paired-${remoteDevice.id}`)).toBeTruthy(),
    );

    // A live turn may reach this phone before its parent chat in a separate frame.
    // Both records must appear in the rendered chat after the parent arrives.
    remoteLog.record(CORE_SYNC_ENTITIES.message, 'late-parent-message', 'put', {
      conversation_id: 'late-parent-conversation',
      role: 'assistant',
      content: 'The late chat turn arrived.',
      context: null,
      created_at: createdAt,
    });
    remoteLog.record(CORE_SYNC_ENTITIES.conversation, 'late-parent-conversation', 'put', {
      title: 'Late parent chat',
      project_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    });
    remoteState.sendRecord(mobile.id, CORE_SYNC_ENTITIES.message, 'late-parent-message');
    remoteState.sendRecord(mobile.id, CORE_SYNC_ENTITIES.conversation, 'late-parent-conversation');

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
    await waitFor(() => expect(ui!.getByText('Late parent chat')).toBeTruthy());
    fireEvent.press(ui.getByText('Late parent chat'));
    await waitFor(() =>
      expect(ui!.getByText('The late chat turn arrived.')).toBeTruthy(),
    );
    fireEvent.press(ui.getByLabelText('Back'));
    expect(ui.getByText('The field notes are ready.')).toBeTruthy();
    expect(ui.getByText('Desktop Research')).toBeTruthy();
    fireEvent.press(ui.getByText('Field planning'));
    await waitFor(() =>
      expect(ui!.getByText('The field notes are ready.')).toBeTruthy(),
    );
    expect(ui.getByText('Using contacts_search: ali hafizji')).toBeTruthy();
    expect(
      ui
        .getAllByText(/^(Thought process|Web search result)$/)
        .map(node => React.Children.toArray(node.props.children).join('')),
    ).toEqual(['Thought process', 'Web search result', 'Thought process']);
    fireEvent.press(ui.getAllByTestId('thinking-block-toggle')[0]);
    expect(
      ui.getByText('I should confirm the notes before searching.'),
    ).toBeTruthy();
    fireEvent.press(ui.getByText('Generation details'));
    expect(ui.getByText('42.5 tok/s')).toBeTruthy();

    remoteLog.record(CORE_SYNC_ENTITIES.message, 'older-gap-message', 'put', {
      conversation_id: 'remote-conversation',
      role: 'user',
      content: 'An older turn was missed.',
      context: null,
      created_at: '2026-07-27T12:01:00.000Z',
    });
    remoteLog.record(CORE_SYNC_ENTITIES.message, 'newer-gap-message', 'put', {
      conversation_id: 'remote-conversation',
      role: 'assistant',
      content: 'A newer turn arrived.',
      context: null,
      created_at: '2026-07-27T12:02:00.000Z',
    });
    remoteState.sendRecord(mobile.id, CORE_SYNC_ENTITIES.message, 'newer-gap-message');
    await waitFor(() => expect(ui!.getByText('A newer turn arrived.')).toBeTruthy());
    expect(ui.queryByText('An older turn was missed.')).toBeNull();
    const sentBeforeGapRepair = remoteStateOpsSent;
    remoteState.requestSync(mobile.id);
    await waitFor(() => expect(ui!.getByText('An older turn was missed.')).toBeTruthy());
    expect(remoteStateOpsSent - sentBeforeGapRepair).toBe(1);
    fireEvent.press(ui.getByLabelText('Back'));

    useChatStore.getState().addMessage('remote-conversation', {
      role: 'assistant',
      content: 'The phone checked the notes.',
      reasoningContent: 'I should send the reasoning back to Desktop.',
    });
    await waitFor(() =>
      expect(
        remoteRecords.records.get(
          `${CORE_SYNC_ENTITIES.message}:${
            useChatStore
              .getState()
              .conversations.find(item => item.id === 'remote-conversation')
              ?.messages.at(-1)?.uuid
          }`,
        ),
      ).toMatchObject({ content: 'The phone checked the notes.' }),
    );
    // The context is read as the structure it is, not as an exact string. It carries the reasoning AND
    // now a status, and pinning the whole blob turns every future field into a failure while proving
    // nothing more about the field under test.
    const deliveredContext = JSON.parse(
      (remoteRecords.records.get(
        `${CORE_SYNC_ENTITIES.message}:${
          useChatStore
            .getState()
            .conversations.find(item => item.id === 'remote-conversation')
            ?.messages.at(-1)?.uuid
        }`,
      )?.context ?? '{}') as string,
    );
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

    const phoneProject = useProjectStore
      .getState()
      .projects.find(project => project.name === 'Phone Notes');
    if (!phoneProject) throw new Error('Phone project was not saved');
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
      expect(syncService.connectedDeviceIds()).not.toContain(remoteDevice.id),
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
    const currentCode = useSyncStore.getState().pairingCode.code;
    if (!currentCode)
      throw new Error('the phone has not issued a pairing code');
    await remote.engine.pair(
      { ...mobile, host: '127.0.0.1', port: discovery.publishedPort },
      currentCode,
    );
    await waitFor(() =>
      expect(syncService.connectedDeviceIds()).toContain(remoteDevice.id),
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

  });

  it('reconnects before slow owners finish and rejects forged task state', async () => {
    let releaseSlowStartup: (() => void) | undefined;
    const slowStartup = new Promise<void>(resolve => {
      releaseSlowStartup = resolve;
    });
    await stateSyncService.start(slowStartup);
    await syncService.start();
    expect(syncService.isRunning()).toBe(true);

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
      send: (deviceId, message) => {
        remote!.engine.sendApp(deviceId, STATE_CHANNEL, message);
      },
    });
    await remote.engine.start(0);

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    const pairingCode = useSyncStore.getState().pairingCode.code;
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
      expect(syncService.connectedDeviceIds()).toContain(remoteDevice.id),
    );
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

    releaseSlowStartup?.();
    await stateSyncService.whenReady();

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
  });
});
