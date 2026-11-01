/**
 * Integration (RNTL): McpAddServerSheet.
 *
 * Drives the quick-add surface against the REAL mcp store to verify the wiring:
 *   - "Add your own from URL" stays the top action and calls onAddCustom
 *   - tapping a preset's + adds a correctly-shaped server to the store and reports
 *     the new id so the screen can connect
 *   - search filters the preset list
 *   - an already-added preset is shown as added and cannot be re-added
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite
 * skips in open-core CI where pro/ is absent.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

jest.mock('react-native-svg', () => ({
  __esModule: true,
  SvgXml: () => null,
}));


type SheetModule = typeof import('../../../pro/ui/McpAddServerSheet');
type StoreModule = typeof import('../../../pro/mcp/mcpStore');

function load(): { sheet: SheetModule; store: StoreModule } | null {
  try {
    return {
      sheet: require(['..', '..', '..', 'pro', 'ui', 'McpAddServerSheet'].join('/')),
      store: require(['..', '..', '..', 'pro', 'mcp', 'mcpStore'].join('/')),
    };
  } catch {
    return null;
  }
}

const mods = load();
const maybe = mods ? describe : describe.skip;

maybe('McpAddServerSheet', () => {
  const { McpAddServerSheet } = mods!.sheet;
  const { useMcpStore } = mods!.store;

  const resetStore = () =>
    useMcpStore.setState({
      servers: [], connectionStates: {}, serverTools: {}, toolOwners: {}, enabledTools: [],
    });

  beforeEach(() => {
    jest.clearAllMocks();
    resetStore();
  });

  const baseProps = () => ({
    onClose: jest.fn(),
    onAddCustom: jest.fn(),
    onAddedPreset: jest.fn(),
  });

  it('calls onAddCustom when the top "Add your own from URL" button is pressed', () => {
    const props = baseProps();
    const { getByTestId } = render(<McpAddServerSheet {...props} />);
    fireEvent.press(getByTestId('add-custom-server'));
    expect(props.onAddCustom).toHaveBeenCalledTimes(1);
  });

  it('has no "Scan a desktop QR" button - a paired desktop grants tools over the mesh', () => {
    // The QR-scan pairing was removed: a paired desktop now hands its tools over
    // the sync mesh, so there is nothing to scan from the add sheet.
    const { queryByTestId } = render(<McpAddServerSheet {...baseProps()} />);
    expect(queryByTestId('scan-desktop-qr')).toBeNull();
  });

  it('lists the preset rows', () => {
    const props = baseProps();
    const { getByTestId } = render(<McpAddServerSheet {...props} />);
    expect(getByTestId('mcp-preset-notion')).toBeTruthy();
    expect(getByTestId('mcp-preset-deepwiki')).toBeTruthy();
  });

  it('adds a correctly-shaped server to the store and reports its id', () => {
    const props = baseProps();
    const { getByTestId } = render(<McpAddServerSheet {...props} />);

    fireEvent.press(getByTestId('mcp-preset-add-notion'));

    const servers = useMcpStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({
      name: 'Notion',
      url: 'https://mcp.notion.com/mcp',
      authMode: 'oauth',
    });
    expect(props.onAddedPreset).toHaveBeenCalledWith(servers[0].id);
  });

  it('filters the list via the search box', () => {
    const props = baseProps();
    const { getByPlaceholderText, queryByTestId } = render(<McpAddServerSheet {...props} />);

    fireEvent.changeText(getByPlaceholderText('Search servers'), 'notion');

    expect(queryByTestId('mcp-preset-notion')).toBeTruthy();
    expect(queryByTestId('mcp-preset-linear')).toBeNull();
  });

  it('shows an already-added preset as added and does not re-add it', () => {
    useMcpStore.setState({
      servers: [{ id: 'existing', name: 'Notion', url: 'https://mcp.notion.com/mcp', authMode: 'oauth' }],
    });
    const props = baseProps();
    const { getByTestId } = render(<McpAddServerSheet {...props} />);

    fireEvent.press(getByTestId('mcp-preset-add-notion'));

    // Still just the one pre-existing server; no duplicate, no callback.
    expect(useMcpStore.getState().servers).toHaveLength(1);
    expect(props.onAddedPreset).not.toHaveBeenCalled();
  });
});
