/**
 * Integration (RNTL): CompanionToolsSection - the single home for desktop tools.
 *
 * Proves the moved grant: paired desktops (only desktops) appear in Pro tools with a
 * switch that reflects whether their tools are connected here (grantedByDeviceId), and
 * flipping one calls requestTools(deviceId, next) - the same mesh request the old
 * Devices-row toggle sent. Loaded via a computed path so it skips where pro/ is absent.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({
    colors: {
      text: '#000', textMuted: '#999', primary: '#1DB954', surface: '#F5F5F5', border: '#E0E0E0',
    },
  }),
}));

const mockState: { knownDevices: unknown[]; servers: unknown[] } = { knownDevices: [], servers: [] };
const mockRequestTools = jest.fn();

jest.mock('../../../pro/sync/syncStore', () => ({
  useSyncStore: (selector: (s: unknown) => unknown) =>
    selector({ knownDevices: mockState.knownDevices }),
  // The section reads the shared roster now, not knownDevices. This stands in for the projection
  // so these cases keep testing what they are about: the switch and the grant it sends.
  selectSyncControlCenter: (state: { knownDevices: unknown[] }) => ({
    allDevices: state.knownDevices,
  }),
}));
jest.mock('../../../pro/mcp/mcpStore', () => ({
  useMcpStore: (selector: (s: unknown) => unknown) => selector({ servers: mockState.servers }),
}));
jest.mock('../../../pro/mcp/mcpToolGrantService', () => ({
  requestTools: (...args: unknown[]) => mockRequestTools(...args),
}));

type Mod = typeof import('../../../pro/ui/CompanionToolsSection');
function load(): Mod | null {
  try {
    return require(['..', '..', '..', 'pro', 'ui', 'CompanionToolsSection'].join('/'));
  } catch {
    return null;
  }
}

const mod = load();
const maybe = mod ? describe : describe.skip;

maybe('CompanionToolsSection', () => {
  const { CompanionToolsSection } = mod!;

  beforeEach(() => {
    mockState.knownDevices = [];
    mockState.servers = [];
    mockRequestTools.mockClear();
  });

  it('lists only desktop peers, reflects the grant, and toggles via requestTools', () => {
    mockState.knownDevices = [
      { id: 'mac1', name: 'My Mac', platform: 'macos' },
      { id: 'phone1', name: 'My Phone', platform: 'ios' },
    ];
    mockState.servers = [{ id: 's1', grantedByDeviceId: 'mac1' }];

    const { getByTestId, queryByTestId } = render(<CompanionToolsSection />);
    // Desktop shows; a phone peer (serves no tools) is filtered out.
    expect(getByTestId('companion-tools-mac1')).toBeTruthy();
    expect(queryByTestId('companion-tools-phone1')).toBeNull();

    const sw = getByTestId('companion-tools-switch-mac1');
    expect(sw.props.value).toBe(true); // granted -> on
    fireEvent(sw, 'valueChange', false);
    expect(mockRequestTools).toHaveBeenCalledWith('mac1', false);
  });

  it('renders nothing when there are no paired desktops', () => {
    mockState.knownDevices = [{ id: 'phone1', name: 'Phone', platform: 'android' }];
    const { toJSON } = render(<CompanionToolsSection />);
    expect(toJSON()).toBeNull();
  });
});
