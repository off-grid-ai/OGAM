import React from 'react';
import { act, render } from '@testing-library/react-native';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncHomeCard } from '../../../pro/ui/SyncHomeCard';

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const device = (id: string) => ({
  id,
  name: `Device ${id}`,
  platform: 'android',
  version: '1',
  host: `10.0.0.${id.length}`,
  port: 7878,
  capabilities: [],
  pairedAt: 1,
  lastSeenAt: 1,
  hasCredential: true,
});
const installation = (id: string) => ({
  installationId: `inst-${id}`,
  syncDeviceId: id,
  deviceName: `Device ${id}`,
  platform: 'android',
  lastActiveAt: 1,
  createdAt: 1,
});

const seed = (known: string[], licensed: string[] | null) =>
  act(() => {
    useSyncStore.setState({
      rosterHydrated: true,
      thisDevice: { id: 'me', name: 'This phone', platform: 'android', version: '1' },
      knownDevices: known.map(device),
      entitlementReconciliation: licensed
        ? {
            registry: {
              freshness: 'fresh',
              maxDevices: 6,
              installations: ['me', ...licensed].map(installation),
            },
          }
        : undefined,
    } as never);
  });

const card = () => render(<SyncHomeCard isUnlocked onOpen={jest.fn()} onOpenClipboard={jest.fn()} />);

describe('Home Sync count (hand test 31: Home said 5 saved, Sync listed four)', () => {
  it('counts the devices Sync lists, even when this phone holds a pairing for one more', () => {
    seed(['a', 'b', 'c', 'd', 'gone'], ['a', 'b', 'c', 'd']);
    const view = card();
    expect(view.getByText(/0 connected · 4 saved/)).toBeTruthy();
    expect(view.queryByText(/5 saved/)).toBeNull();
  });

  it('falls back to the pairings this phone holds while Sync lists nobody', () => {
    seed(['a', 'b'], []);
    const view = card();
    expect(view.getByText(/0 connected · 2 saved/)).toBeTruthy();
  });
});
