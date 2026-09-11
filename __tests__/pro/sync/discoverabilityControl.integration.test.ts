import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createOffGridApplication,
  type OffGridApplication,
  type SyncPlatformPorts,
} from '@offgrid/application';
import {discoverabilityCommands} from '../../../pro/sync/discoverabilityCommands';
import {discoverabilityPreference} from '../../../pro/sync/discoverabilityPreference';
import {registerApplicationFacade} from '../../../src/services/applicationFacade';

class DiscoveryBoundary {
  readonly calls: boolean[] = [];
  current = true;
  failure: Error | undefined;

  async advertise(): Promise<void> {
    this.calls.push(true);
    if (this.failure) throw this.failure;
    this.current = true;
  }

  async stopAdvertising(): Promise<void> {
    this.calls.push(false);
    if (this.failure) throw this.failure;
    this.current = false;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async rescan(): Promise<void> {}
  onDeviceFound(): void {}
  onDeviceLost(): void {}
}

const modelBoundary = () => ({
  selection: {
    read: () => null,
    write: () => undefined,
  },
  memory: {
    current: () => ({
      totalMB: 8_000,
      availableMB: 4_000,
      platform: 'mobile' as const,
    }),
  },
  remote: {
    configuration: {
      read: () => ({version: 1 as const, activeServerId: null, servers: []}),
      write: () => undefined,
    },
    credentials: {
      read: async () => null,
      write: async () => undefined,
      remove: async () => undefined,
    },
    providers: {
      register: async () => undefined,
      unregister: async () => undefined,
    },
    activateManaged: async () => ({}),
  },
});

async function createJourney(): Promise<{
  application: OffGridApplication;
  discovery: DiscoveryBoundary;
}> {
  const discovery = new DiscoveryBoundary();
  let browsing = true;
  const sync: SyncPlatformPorts = {
    localDevice: {
      id: 'this-phone',
      name: 'This phone',
      platform: 'ios',
      version: '1',
      host: '0.0.0.0',
      port: 41234,
    },
    transport: {
      listen: async () => undefined,
      connect: async () => {
        throw new Error('This journey does not connect to a peer.');
      },
      stop: async () => undefined,
    },
    discovery,
    persistence: {
      async load() {
        return {
          pairedDevices: [],
          discoverable: (await discoverabilityPreference.load()) ?? true,
          browsing,
        };
      },
      async savePreferences(preferences) {
        await discoverabilityPreference.set(preferences.discoverable);
        browsing = preferences.browsing;
      },
      removePaired: async () => undefined,
      pairing: {
        begin: async () => undefined,
        commit: async () => undefined,
        rollback: async () => undefined,
      },
    },
  };
  const application = createOffGridApplication({
    models: modelBoundary(),
    sync,
    newId: () => 'journey-id',
  });
  registerApplicationFacade(() => application);
  await application.start();
  discovery.calls.length = 0;
  return {application, discovery};
}

describe('discoverability follows the native and durable result', () => {
  let application: OffGridApplication | undefined;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await discoverabilityPreference.load();
    await discoverabilityPreference.set(true);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await application?.stop();
    application = undefined;
  });

  it('keeps Shared state and storage on true when native stop fails, then retries', async () => {
    const journey = await createJourney();
    application = journey.application;
    journey.discovery.failure = new Error('iOS is still advertising.');

    await expect(discoverabilityCommands.setExplicit(false)).rejects.toThrow(
      'iOS is still advertising.',
    );

    expect(journey.discovery.current).toBe(true);
    expect(application.sync.snapshot().discoverable).toBe(true);
    await expect(discoverabilityPreference.load()).resolves.toBe(true);

    journey.discovery.failure = undefined;
    await expect(discoverabilityCommands.setExplicit(false)).resolves.toBeUndefined();
    expect(journey.discovery.current).toBe(false);
    expect(application.sync.snapshot().discoverable).toBe(false);
    await expect(discoverabilityPreference.load()).resolves.toBe(false);
    expect(journey.discovery.calls).toEqual([false, false]);
  });

  it('rolls native back when persistence fails, then applies the next retry', async () => {
    const journey = await createJourney();
    application = journey.application;
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('Storage is unavailable.'));

    await expect(discoverabilityCommands.setExplicit(false)).rejects.toThrow(
      'Storage is unavailable.',
    );

    expect(journey.discovery.current).toBe(true);
    expect(journey.discovery.calls).toEqual([false, true]);
    expect(application.sync.snapshot().discoverable).toBe(true);
    await expect(discoverabilityPreference.load()).resolves.toBe(true);

    await expect(discoverabilityCommands.setExplicit(false)).resolves.toBeUndefined();
    expect(journey.discovery.current).toBe(false);
    expect(application.sync.snapshot().discoverable).toBe(false);
    expect(journey.discovery.calls).toEqual([false, true, false]);
  });
});
