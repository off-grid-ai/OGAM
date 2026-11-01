// The real syncService loads; only its device edges (the TCP socket and LAN discovery) are faked.
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

import {
  CompanionTaskMesh,
  type CompanionTaskTransport,
} from '../../../pro/mcp/companionTaskMesh';
import { parseTaskCapability } from '../../../pro/mcp/companionTaskMeshLogic';

const webUse = {
  name: 'web_use',
  description: 'Use the Desktop browser.',
  inputSchema: {
    type: 'object',
    properties: { goal: { type: 'string' } },
    required: ['goal'],
  },
};

/** The other device on the wire: it records what the phone sends and can stop answering. */
class MeshBoundary implements CompanionTaskTransport {
  handler:
    | ((deviceId: string, channel: string, data: unknown) => void)
    | undefined;
  sent: { deviceId: string; channel: string; data: unknown }[] = [];
  connected = true;

  onAppMessage(
    handler: (deviceId: string, channel: string, data: unknown) => void,
  ): () => void {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  sendApp(deviceId: string, channel: string, data: unknown): boolean {
    this.sent.push({ deviceId, channel, data });
    return this.connected;
  }
}

const origin = {
  conversationId: 'chat-1',
  launchId: 'launch-1',
  deviceId: 'phone-1',
  deviceName: 'Phone',
  executionDeviceId: 'mac-1',
};

describe('companion task mesh', () => {
  afterEach(() => jest.useRealTimers());

  it('accepts the two mesh task tools from the execution device', () => {
    const capability = parseTaskCapability({
      version: 1,
      executionDevice: { id: 'mac-1', name: 'My Mac' },
      remoteTasksAllowed: true,
      tools: [webUse, { ...webUse, name: 'computer_use' }],
    });
    expect(capability?.tools.map(tool => tool.name)).toEqual([
      'web_use',
      'computer_use',
    ]);
  });

  it('drops foreign tools and rejects malformed capability messages', () => {
    expect(
      parseTaskCapability({
        version: 1,
        executionDevice: { id: 'mac-1', name: 'My Mac' },
        remoteTasksAllowed: true,
        tools: [{ ...webUse, name: 'messages_send' }],
      })?.tools,
    ).toEqual([]);
    expect(parseTaskCapability({ version: 1 })).toBeNull();
  });

  it('clears and rejects pending work when the runtime deactivates', async () => {
    jest.useFakeTimers();
    const boundary = new MeshBoundary();
    const mesh = new CompanionTaskMesh(boundary, () => 'request-1', 30_000);
    const deactivate = mesh.start();
    const result = mesh.execute({
      deviceId: 'mac-1',
      name: 'web_use',
      args: { task: 'Find a flight' },
      origin,
    });

    deactivate();

    await expect(result).rejects.toThrow('stopped before the Desktop replied');
    expect(boundary.handler).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
