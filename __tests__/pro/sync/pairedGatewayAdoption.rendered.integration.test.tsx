import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { pairingSecretStore } from '../../../pro/sync/pairingSecretStore';
import { createSyncRuntimeCallbacks } from '../../../pro/sync/syncRuntimeCallbacks';
import { SyncEventRegistry } from '../../../pro/sync/syncEventRegistry';
import { startPairedGatewayAdoption } from '../../../pro/sync/pairedGatewayAdoption';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { withNavigator } from '../../harness/realNavigation';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
  setGenericPassword: async (_user: string, password: string) => {
    (globalThis as { __pairedGatewayVault?: string | null }).__pairedGatewayVault = password;
    return true;
  },
  getGenericPassword: async () => {
    const saved = (globalThis as { __pairedGatewayVault?: string | null }).__pairedGatewayVault;
    return saved ? { username: 'sync-pairings', password: saved } : false;
  },
  resetGenericPassword: async () => {
    (globalThis as { __pairedGatewayVault?: string | null }).__pairedGatewayVault = null;
    return true;
  },
}));
// Real navigation: the screen renders inside a real React Navigation stack (harness/realNavigation).
jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const desktop = {
  id: 'paired-desktop-1',
  name: 'Paired Mac',
  platform: 'macos' as const,
  version: '1.0.0',
  host: '192.168.7.20',
  port: 43210,
  gatewayPort: 7881,
  privateHost: '100.80.1.20',
  sharedSecret: 'synthetic-pairing-secret',
  pairedAt: 1,
};

describe('paired Desktop gateway adoption', () => {
  const originalFetch = global.fetch;
  afterEach(async () => {
    global.fetch = originalFetch;
    await remoteServerManager.clearAllServers();
    useSyncStore.getState().reset();
  });

  it('shows one trusted gateway, keeps it across discovery and offline changes, then removes it on unpair', async () => {
    await remoteServerManager.clearAllServers();
    useSyncStore.getState().reset();
    useSyncStore.getState().setKnownDevices([]);
    await pairingSecretStore.load();
    await pairingSecretStore.beginPairing(desktop);
    await pairingSecretStore.commitPairing(desktop);

    let reachable = '192.168.7.20';
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(reachable) && url.includes('/v1/models')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'remote-text', kind: 'chat' }] }) } as Response;
      }
      throw new Error('Server is offline.');
    }) as typeof fetch;

    const callbacks = createSyncRuntimeCallbacks({
      runtime: () => { throw new Error('Native transport is not used in this journey.'); },
      meshGossip: () => null,
      connectedDevices: new Set<string>(),
      events: new SyncEventRegistry(),
      publishConnectedDevices: () => {},
      announceLocalRoutes: async () => {},
      clearCredentialAfterRemoteRevocation: async () => {},
    });
    const view = render(withNavigator(<RemoteServersScreen />));
    const stop = startPairedGatewayAdoption();
    try {
      callbacks.onPaired?.(desktop);
      await waitFor(() => { expect(view.queryByText('Paired Mac')).not.toBeNull(); });
      expect(view.queryByText(/192\.168\.7\.20:7881/)).not.toBeNull();

      // Unauthenticated discovery can show a peer nearby, but cannot move this server.
      callbacks.onDiscovered?.({ ...desktop, host: '192.168.7.99', lastSeen: Date.now() });
      expect(view.queryByText(/192\.168\.7\.20:7881/)).not.toBeNull();

      // The authenticated reconnection can move it. An offline check retains the row.
      reachable = '192.168.7.21';
      callbacks.onPaired?.({ ...desktop, host: reachable });
      await waitFor(() => { expect(view.queryByText(/192\.168\.7\.21:7881/)).not.toBeNull(); });
      reachable = 'no-host';
      callbacks.onPaired?.({ ...desktop, host: '192.168.7.21' });
      expect(view.queryByText('Paired Mac')).not.toBeNull();

      callbacks.onMembershipRevoked?.(desktop.id, 'membership-1', 'local');
      await waitFor(() => { expect(view.queryByText('Paired Mac')).toBeNull(); });
    } finally {
      stop();
      view.unmount();
    }
  });
});
