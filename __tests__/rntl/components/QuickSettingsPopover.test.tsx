/**
 * QuickSettingsPopover Tests
 *
 * Covers the chat quick-settings menu rows that recently changed:
 * - The "Tools" row is a neutral utility count (its icon must NOT turn green/primary
 *   when tools are enabled).
 * - The "Pro Tools" row (formerly "MCP") uses a crown icon and shows a count badge
 *   for whatever is active across pro tools + MCP, hidden when nothing is active.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { QuickSettingsPopover } from '../../../src/components/ChatInput/Popovers';

const COLORS = {
  text: '#000000', textMuted: '#999999', primary: '#00FF00',
  background: '#FFFFFF', surface: '#F5F5F5', border: '#E0E0E0',
};

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, color }: any) => <Text testID={`feather-${name}`} style={{ color }}>{name}</Text>;
});
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => {
  const { Text } = require('react-native');
  return ({ name, color }: any) => <Text testID={`mci-${name}`} style={{ color }}>{name}</Text>;
});

jest.mock('../../../src/theme', () => ({
  useTheme: () => ({ colors: COLORS }),
}));

jest.mock('../../../src/utils/haptics', () => ({ triggerHaptic: jest.fn() }));

jest.mock('../../../src/bootstrap/slotRegistry', () => ({
  getSlot: () => null,
  SLOTS: { quickSettingsAudioRow: 'quickSettingsAudioRow' },
}));

jest.mock('../../../src/stores', () => ({
  useAppStore: () => ({
    settings: { thinkingEnabled: false },
    updateSettings: jest.fn(),
    toolCountHintDismissed: false,
  }),
}));

const baseProps = {
  visible: true,
  onClose: jest.fn(),
  anchorY: 0,
  anchorX: 0,
  imageMode: 'auto' as const,
  onImageModeToggle: jest.fn(),
  imageModelLoaded: false,
  supportsThinking: false,
  supportsToolCalling: true,
  enabledToolCount: 2,
};

describe('QuickSettingsPopover', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps the Tools icon neutral (not green) even when tools are enabled', () => {
    const { getByTestId } = render(<QuickSettingsPopover {...baseProps} enabledToolCount={2} />);
    const toolIcon = getByTestId('feather-tool');
    // Should be the neutral text color, never the primary/green accent.
    expect(toolIcon.props.style.color).toBe(COLORS.text);
    expect(toolIcon.props.style.color).not.toBe(COLORS.primary);
  });

  it('renders a Pro Tools row with a crown icon (and no MCP label)', () => {
    const { getByText, queryByText, getByTestId } = render(
      <QuickSettingsPopover {...baseProps} mcpToolCount={0} />,
    );
    expect(getByText('Pro Tools')).toBeTruthy();
    expect(queryByText('MCP')).toBeNull();
    expect(getByTestId('mci-crown')).toBeTruthy();
  });

  it('shows the active count badge on Pro Tools when something is active', () => {
    const { getByText } = render(<QuickSettingsPopover {...baseProps} mcpToolCount={3} />);
    expect(getByText('3')).toBeTruthy();
  });

  it('hides the Pro Tools badge when nothing is active', () => {
    const { queryByText } = render(<QuickSettingsPopover {...baseProps} mcpToolCount={0} />);
    expect(queryByText('0')).toBeNull();
  });

  it('invokes onMcpPress when the Pro Tools row is pressed', () => {
    const onMcpPress = jest.fn();
    const { getByTestId } = render(
      <QuickSettingsPopover {...baseProps} mcpToolCount={1} onMcpPress={onMcpPress} />,
    );
    fireEvent.press(getByTestId('quick-pro-tools'));
    expect(onMcpPress).toHaveBeenCalledTimes(1);
  });
});
