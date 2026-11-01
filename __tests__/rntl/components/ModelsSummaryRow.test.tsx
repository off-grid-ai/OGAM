/**
 * ModelsSummaryRow — collapsed home Models control: labelled strip of four type
 * icons (Text/Image/Voice/Speech) with captions; tap opens the manager sheet.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';


import { ModelsSummaryRow } from '../../../src/components/models/ModelsSummaryRow';

const labels = { text: 'Qwen3.5', image: '—', video: '—', voice: 'Kokoro · Warm', speech: 'Base' };

describe('ModelsSummaryRow', () => {
  it('renders the four model-type captions and the label', () => {
    const { getByText } = render(<ModelsSummaryRow labels={labels} isLoading={false} onPress={jest.fn()} />);
    ['Models', 'Text', 'Image', 'Voice', 'Speech'].forEach((t) => expect(getByText(t)).toBeTruthy());
  });

  it('opens on press', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(<ModelsSummaryRow labels={labels} isLoading={false} onPress={onPress} />);
    fireEvent.press(getByTestId('models-summary'));
    expect(onPress).toHaveBeenCalled();
  });
});
