import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ModelsSummaryRow } from '../../../src/components/models/ModelsSummaryRow';

const labels = { text: 'Qwen', image: '—', voice: 'Kokoro', speech: 'Base' };

describe('ModelsSummaryRow', () => {
  it('opens the sheet for the type you tapped, and the manager from the header', () => {
    const onPress = jest.fn();
    const onPressType = jest.fn();
    const { getByTestId, getByText } = render(
      <ModelsSummaryRow labels={labels} isLoading={false} onPress={onPress} onPressType={onPressType} />,
    );
    fireEvent.press(getByTestId('model-summary-image-open'));
    fireEvent.press(getByTestId('model-summary-voice-open'));
    expect(onPressType.mock.calls.map(([type]) => type)).toEqual(['image', 'voice']);
    fireEvent.press(getByText('Models'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('falls back to the manager when no per-type handler is given', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<ModelsSummaryRow labels={labels} isLoading={false} onPress={onPress} />);
    fireEvent.press(getByTestId('model-summary-text-open'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(getByTestId('model-summary-text').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('model-summary-image').props.accessibilityState).toEqual({ selected: false });
  });
});
