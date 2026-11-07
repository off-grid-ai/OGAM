/**
 * SegmentedRow: each segment's label stays on one centered line. A long label ("Aggressive") broke
 * mid-word on Android's wider metrics; now it shrinks a little to fit instead of wrapping.
 *
 * The component and the real theme run as they ship; nothing of ours is mocked.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { SegmentedRow } from '../../../src/components/settings/segmentedRow';

const OPTIONS = [
  { id: 'off', label: 'Off' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'aggressive', label: 'Aggressive' },
] as const;

function Row({ onSelect = () => undefined }: { onSelect?: (id: string) => void }) {
  return (
    <SegmentedRow
      label="Memory"
      description="How hard the app frees memory."
      options={[...OPTIONS]}
      current="balanced"
      onSelect={onSelect}
      testIdFor={id => `memory-${id}`}
    />
  );
}

describe('SegmentedRow', () => {
  it('draws every label on one centered line, shrinking a long one to fit', () => {
    const { getByText } = render(<Row />);
    for (const { label } of OPTIONS) {
      const text = getByText(label);
      expect(text.props.numberOfLines).toBe(1);
      expect(text.props.adjustsFontSizeToFit).toBe(true);
      expect(text.props.minimumFontScale).toBe(0.8);
      expect(StyleSheet.flatten(text.props.style).textAlign).toBe('center');
    }
  });

  it('a pressed segment selects its option', () => {
    let picked = '';
    const { getByTestId } = render(<Row onSelect={id => { picked = id; }} />);
    fireEvent.press(getByTestId('memory-aggressive'));
    expect(picked).toBe('aggressive');
  });
});
