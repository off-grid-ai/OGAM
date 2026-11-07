/**
 * ModelsSummaryRow — Home's models as desktop's composer chips: the text model named, a chip per
 * kind that opens its picker, and a Models chip that opens the manager sheet.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';


import { ModelsSummaryRow } from '../../../src/components/models/ModelsSummaryRow';

const labels = { text: 'Qwen3.5', image: '—', video: '—', voice: 'Kokoro · Warm', speech: 'Base' };

describe('ModelsSummaryRow', () => {
  it('names the text model in use, and offers each other kind as a chip', () => {
    const { getByText, getByTestId } = render(<ModelsSummaryRow labels={labels} isLoading={false} onPress={jest.fn()} />);
    expect(getByText('Qwen3.5')).toBeTruthy();
    ['Image', 'Video', 'Voice', 'Speech', 'Models'].forEach((t) => expect(getByText(t)).toBeTruthy());
    expect(getByTestId('model-summary-text').props.accessibilityState).toEqual({ selected: true });
    expect(getByTestId('model-summary-image').props.accessibilityState).toEqual({ selected: false });
  });

  it('asks you to pick a text model when none is in use', () => {
    const { getByText } = render(
      <ModelsSummaryRow labels={{ ...labels, text: '—' }} isLoading={false} onPress={jest.fn()} />,
    );
    expect(getByText('Pick a text model')).toBeTruthy();
  });

  it('a kind\'s chip opens that kind\'s picker', () => {
    const onPressType = jest.fn();
    const { getByTestId } = render(
      <ModelsSummaryRow labels={labels} isLoading={false} onPress={jest.fn()} onPressType={onPressType} />,
    );
    fireEvent.press(getByTestId('model-summary-image-open'));
    expect(onPressType).toHaveBeenCalledWith('image');
  });

  it('opens on press', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<ModelsSummaryRow labels={labels} isLoading={false} onPress={onPress} />);
    fireEvent.press(getByTestId('models-summary'));
    expect(onPress).toHaveBeenCalled();
  });
});
