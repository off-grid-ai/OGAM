/**
 * A Computer Use call from the phone reaches the Desktop the model named, and only that one.
 *
 * SPEC (OGAM user's view): with two Desktops connected, I ask for the task on "Studio Alias". The
 * Studio Mac runs it, the Office Mac never hears of it, and my chat gets the task's summary and its
 * reference.
 *
 * The real App with Pro decided by a real licence; the phone's real sync service and companion task
 * mesh. The two Desktops are real shared sync engines over the in-memory TCP boundary, paired by the
 * code the phone shows. Each one answers `companion-task-call` the way Desktop does: it accepts the
 * call on `companion-task-result`, then syncs the finished task run back as a state op.
 */
import type { LicensedMesh } from '../../harness/licensedMesh';
import type { PairedPeer } from '../../harness/proHarness';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));
jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

type App = Awaited<ReturnType<typeof import('../../harness/proHarness').launchLicensedApp>>;

const OFFICE = { id: 'desktop-office', name: 'Office Mac' };
// The Studio is known on the mesh by its alias; its MCP grant carries the machine name.
const STUDIO = { id: 'desktop-studio', name: 'Studio Alias' };

const computerTask = {
  name: 'computer_use',
  description: `Use the selected Desktop. ${'Route carefully. '.repeat(80)}`,
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'The work to complete.' },
      execution_device: {
        type: 'string',
        description: 'The connected Desktop name or alias.',
      },
      notes: { type: 'string', description: 'Optional details.'.repeat(80) },
    },
    required: ['goal'],
  },
};

interface ReceivedCall {
  requestId: string;
  name: string;
  args: Record<string, unknown>;
  origin: Record<string, any>;
}

/** A Desktop: it accepts each task call, then syncs the finished run back. */
function answerLikeDesktop(received: ReceivedCall[], machineName: string) {
  return (peer: PairedPeer, phoneId: string, channel: string, data: unknown) => {
    if (channel !== 'companion-task-call') return;
    const call = data as ReceivedCall;
    received.push(call);
    peer.engine.sendApp(phoneId, 'companion-task-result', {
      version: 1,
      requestId: call.requestId,
      ok: true,
      content: 'task started',
      durationMs: 5,
    });
    const { TASK_RUN_ENTITY } = require('@offgrid/sync');
    peer.record(TASK_RUN_ENTITY, `${peer.device.id}-task-1`, 'put', {
      version: 1,
      taskId: `${peer.device.id}-task-1`,
      launchId: call.origin.launchId,
      requestingDeviceId: call.origin.deviceId,
      conversationId: call.origin.conversationId,
      kind: 'computer_use',
      executionDevice: { id: peer.device.id, name: machineName },
      title: 'Open the project plan.',
      status: 'done',
      progress: [],
      startedAt: 1,
      updatedAt: 2,
      finishedAt: 2,
      summary: 'The project plan is open.',
    });
  };
}

describe('Mobile companion task routing integration', () => {
  let mesh: LicensedMesh;
  let app: App | undefined;
  const peers: PairedPeer[] = [];

  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset(3);
  });

  afterEach(async () => {
    for (const peer of peers.splice(0)) await peer.stop();
    await app?.close();
    app = undefined;
    mesh.restore();
  });

  it('keeps Desktop selection visible to the model and sends the call to the named Desktop only', async () => {
    const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness');
    app = await launchLicensedApp({ mesh, secrets: new Map() });
    const { view, rtl } = app!;

    const officeCalls: ReceivedCall[] = [];
    const studioCalls: ReceivedCall[] = [];
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    const office: PairedPeer = await startPairedPeer({
      mesh, device: OFFICE, onAppMessage: answerLikeDesktop(officeCalls, 'Office Mac'),
    });
    peers.push(office);
    await office.pairWithPhone(view);
    const studio: PairedPeer = await startPairedPeer({
      mesh, device: STUDIO, onAppMessage: answerLikeDesktop(studioCalls, 'Studio Mac'),
    });
    peers.push(studio);
    await studio.pairWithPhone(view);

    const { useSyncStore } = require('../../../pro/sync/syncStore');
    await rtl.waitFor(() =>
      expect(useSyncStore.getState().connectedDeviceIds).toEqual(
        expect.arrayContaining([OFFICE.id, STUDIO.id]),
      ),
    );

    // The MCP tools each Desktop granted, as the phone's own store holds them.
    const { useMcpStore } = require('../../../pro/mcp/mcpStore');
    const { useRemoteServerStore } = require('../../../src/stores');
    useRemoteServerStore.getState().setActiveRemoteTextModelId(null);
    for (const [serverId, deviceId, name] of [
      ['office-tools', OFFICE.id, 'Office Mac'],
      ['studio-tools', STUDIO.id, 'Studio Mac'],
    ] as const) {
      const store = useMcpStore.getState();
      store.addServer({ id: serverId, name, url: `http://${serverId}/mcp`, grantedByDeviceId: deviceId });
      store.setConnectionState(serverId, 'connected');
      store.setServerTools(serverId, [computerTask]);
    }
    useMcpStore.getState().setEnabledTools(['computer_use']);

    const { McpToolExtension } = require('../../../pro/mcp/McpToolExtension');
    const schema = McpToolExtension.getOpenAISchemas() as Array<any>;
    expect(schema).toHaveLength(1);
    expect(schema[0].function.name).toBe('computer_use');
    expect(schema[0].function.parameters.properties).toHaveProperty('execution_device');
    expect(schema[0].function.parameters.properties).not.toHaveProperty('notes');

    let result: any;
    await rtl.act(async () => {
      result = await McpToolExtension.execute({
        id: 'task-call-1',
        name: 'computer_use',
        arguments: { goal: 'Open the project plan.', execution_device: 'studio alias' },
        context: { conversationId: 'chat-mobile-1' },
      });
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe(
      `The project plan is open.\n\nTask reference: ${STUDIO.id}-task-1.`,
    );
    const phone = useSyncStore.getState().thisDevice;
    expect(officeCalls).toEqual([]);
    expect(studioCalls).toEqual([
      {
        version: 1,
        requestId: expect.any(String),
        name: 'computer_use',
        args: { goal: 'Open the project plan.', execution_device: 'studio alias' },
        origin: {
          conversationId: 'chat-mobile-1',
          launchId: 'task-call-1',
          deviceId: phone.id,
          deviceName: phone.name,
          executionDeviceId: STUDIO.id,
        },
      },
    ]);
  }, 60_000);
});
