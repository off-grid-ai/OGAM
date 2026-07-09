/**
 * EngineBridge tests — real store + real ttsRegistry, driven end to end.
 *
 * EngineBridge reads the active engineId from the REAL useTTSStore, looks the
 * engine up in the REAL ttsRegistry, and renders whatever that engine's
 * getBridgeComponent() returns — but only when the engine isSupported(). It
 * renders nothing when the engine is missing, unsupported, throws on lookup,
 * or has no bridge. These tests register a throwaway fake engine in the real
 * registry (cleaned up in afterEach) and flip the real store's engineId, then
 * assert what the user actually sees on screen for each branch.
 *
 * The component module runs initExecutorch() at import time; the global
 * executorch jest mock (jest.setup.ts) omits it, so we extend the mock here to
 * add a no-op initExecutorch while keeping the shared useTextToSpeech shim.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

jest.mock('react-native-executorch', () => ({
  initExecutorch: jest.fn(),
  useTextToSpeech: jest.fn(() => ({
    isReady: true,
    downloadProgress: 1,
    error: null,
    stream: jest.fn(() => Promise.resolve()),
    streamStop: jest.fn(),
  })),
}));

// Import via the '@offgrid/pro/...' alias (resolves to <rootDir>/pro/...).
import { EngineBridge } from '@offgrid/pro/audio/ui/EngineBridge';
import { ttsRegistry } from '@offgrid/pro/audio/engine';
import { useTTSStore } from '@offgrid/pro/audio/ttsStore';
import type { TTSEngine } from '@offgrid/pro/audio/engine';

const FAKE_ID = '__engine_bridge_test_fake__';

/** Set the active engineId on the REAL store without triggering engine loads. */
const setEngineId = (id: string) =>
  useTTSStore.setState((s) => ({ settings: { ...s.settings, engineId: id } }));

/**
 * Build a fake TTSEngine that only implements the members EngineBridge touches
 * (isSupported + getBridgeComponent). Cast through unknown: the component reads
 * nothing else off the engine, so stubbing the full interface would be noise.
 */
const makeEngine = (opts: {
  isSupported: () => boolean;
  bridge: React.ComponentType | null;
}): TTSEngine =>
  ({
    isSupported: opts.isSupported,
    getBridgeComponent: () => opts.bridge,
    // Needed so ttsRegistry.unregister() can release a cached instance in cleanup.
    release: async () => {},
  } as unknown as TTSEngine);

const savedEngineId = useTTSStore.getState().settings.engineId;

afterEach(async () => {
  await ttsRegistry.unregister(FAKE_ID);
  setEngineId(savedEngineId);
  jest.clearAllMocks();
});

describe('EngineBridge', () => {
  it('renders nothing when the active engine is not registered', () => {
    setEngineId(FAKE_ID); // not registered → ttsRegistry.has() is false
    const { toJSON } = render(<EngineBridge />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when the registered engine is not supported', () => {
    const bridge = () => <Text testID="bridge-content">bridge</Text>;
    ttsRegistry.register(FAKE_ID, () =>
      makeEngine({ isSupported: () => false, bridge }),
    );
    setEngineId(FAKE_ID);
    const { toJSON } = render(<EngineBridge />);
    // Unsupported → early return null even though a bridge component exists.
    expect(toJSON()).toBeNull();
    expect(screen.queryByTestId('bridge-content')).toBeNull();
  });

  it('renders nothing when a supported engine has no bridge component', () => {
    ttsRegistry.register(FAKE_ID, () =>
      makeEngine({ isSupported: () => true, bridge: null }),
    );
    setEngineId(FAKE_ID);
    const { toJSON } = render(<EngineBridge />);
    expect(toJSON()).toBeNull();
  });

  it('renders the bridge component of a supported engine that provides one', () => {
    const bridge = () => <Text testID="bridge-content">bridge-mounted</Text>;
    ttsRegistry.register(FAKE_ID, () =>
      makeEngine({ isSupported: () => true, bridge }),
    );
    setEngineId(FAKE_ID);
    render(<EngineBridge />);
    // Supported + has bridge → the engine's component is actually mounted.
    expect(screen.getByTestId('bridge-content')).toBeTruthy();
    expect(screen.getByText('bridge-mounted')).toBeTruthy();
  });

  it('renders nothing (swallows the error) when engine lookup throws', () => {
    // Registered so has() is true, but the factory throws when instantiated —
    // getEngine() propagates it and the component's try/catch must return null.
    ttsRegistry.register(FAKE_ID, () => {
      throw new Error('boom');
    });
    setEngineId(FAKE_ID);
    const { toJSON } = render(<EngineBridge />);
    expect(toJSON()).toBeNull();
  });
});
