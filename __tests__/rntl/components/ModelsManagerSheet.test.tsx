/**
 * ModelsManagerSheet — the bottom sheet with four drill-in rows
 * (Text/Image/Voice/Speech) + Eject. Tapping a row opens that type's picker.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../src/components/AppSheet', () => {
  const { View } = require('react-native');
  return { AppSheet: ({ visible, children }: any) => (visible ? <View>{children}</View> : null) };
});

jest.mock('../../../src/components/AnimatedPressable', () => {
  const { TouchableOpacity } = require('react-native');
  return {
    AnimatedPressable: ({ children, onPress, testID, disabled }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={disabled}>{children}</TouchableOpacity>
    ),
  };
});

import { ModelsManagerSheet } from '../../../src/components/models/ModelsManagerSheet';

const labels = { text: 'Qwen3.5', image: '—', voice: 'Kokoro', speech: 'Base' };
const baseProps = {
  visible: true,
  onClose: jest.fn(),
  labels,
  loadingState: { isLoading: false },
  isEjecting: false,
  hasActiveModel: true,
  onOpenRow: jest.fn(),
  onEject: jest.fn(),
};

describe('ModelsManagerSheet', () => {
  it('renders a row per model type', () => {
    const { getByTestId } = render(<ModelsManagerSheet {...baseProps} />);
    ['text', 'image', 'voice', 'speech'].forEach((t) => expect(getByTestId(`models-row-${t}`)).toBeTruthy());
  });

  it('opens the picker for a tapped row', () => {
    const onOpenRow = jest.fn();
    const { getByTestId } = render(<ModelsManagerSheet {...baseProps} onOpenRow={onOpenRow} />);
    fireEvent.press(getByTestId('models-row-voice'));
    expect(onOpenRow).toHaveBeenCalledWith('voice');
  });

  it('shows Eject All only when a model is active', () => {
    const { queryByText, rerender } = render(<ModelsManagerSheet {...baseProps} hasActiveModel />);
    expect(queryByText('Eject All Models')).toBeTruthy();
    rerender(<ModelsManagerSheet {...baseProps} hasActiveModel={false} />);
    expect(queryByText('Eject All Models')).toBeNull();
  });
});
