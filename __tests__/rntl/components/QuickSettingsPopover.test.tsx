/**
 * QuickSettingsPopover Tests
 *
 * Atlas uses one unified Tools row.
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
jest.mock('../../../src/theme', () => ({
  useTheme: () => ({ colors: COLORS }),
}));
jest.mock('../../../src/services/haptics', () => ({ triggerHaptic: jest.fn() }));
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

  it('renders the unified Tools row', () => {
    const { getByText, getByTestId } = render(<QuickSettingsPopover {...baseProps} />);
    expect(getByText('Tools')).toBeTruthy();
    expect(getByTestId('quick-tools')).toBeTruthy();
  });

  it('keeps the Tools icon neutral when below the warning threshold', () => {
    const { getByTestId } = render(<QuickSettingsPopover {...baseProps} enabledToolCount={2} />);
    expect(getByTestId('feather-tool').props.style.color).toBe(COLORS.text);
  });

  it('shows the enabled tool count badge', () => {
    const { getByText } = render(<QuickSettingsPopover {...baseProps} enabledToolCount={2} />);
    expect(getByText('2')).toBeTruthy();
  });

  it('invokes onToolsPress from the Tools row', () => {
    const onToolsPress = jest.fn();
    const { getByTestId } = render(
      <QuickSettingsPopover {...baseProps} onToolsPress={onToolsPress} />,
    );
    fireEvent.press(getByTestId('quick-tools'));
    expect(onToolsPress).toHaveBeenCalledTimes(1);
  });
});
