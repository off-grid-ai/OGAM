/**
 * ModelFailureCard — the single dismissible surface for every model failure.
 * These lock in the "Load Anyway" affordance: it must appear for an OVERRIDABLE
 * memory-gate failure (any model type) and must NOT appear otherwise. This is the
 * UI half of the fix that gave image models the same override the text path had.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

jest.mock('../../../src/components/AnimatedPressable', () => {
  const { TouchableOpacity } = require('react-native');
  return {
    AnimatedPressable: ({ children, onPress, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress}>{children}</TouchableOpacity>
    ),
  };
});

import { ModelFailureCard } from '../../../src/components/ModelFailureCard';
import { useModelFailureStore, type ModelFailure } from '../../../src/stores/modelFailureStore';

const push = (f: Partial<ModelFailure> & Pick<ModelFailure, 'modelType'>) =>
  useModelFailureStore.getState().report({
    id: f.modelType,
    severity: 'error',
    title: 'Image model: Not enough memory',
    message: 'Not enough memory to load this model.',
    ...f,
  } as ModelFailure);

describe('ModelFailureCard — Load Anyway affordance', () => {
  beforeEach(() => useModelFailureStore.getState().clear());

  it('shows "Load Anyway" for an overridable memory-gate failure and runs the handler', () => {
    const onLoadAnyway = jest.fn();
    push({ modelType: 'image', overridable: true, onLoadAnyway, memoryPressure: true });

    const { getByTestId } = render(<ModelFailureCard />);
    const btn = getByTestId('model-failure-load-anyway-image');
    fireEvent.press(btn);

    expect(onLoadAnyway).toHaveBeenCalledTimes(1);
  });

  it('does NOT show "Load Anyway" when the failure is not overridable (false branch)', () => {
    const onLoadAnyway = jest.fn();
    // overridable:false — even with a handler present, no button (a plain crash, say).
    push({ modelType: 'image', overridable: false, onLoadAnyway, onRetry: jest.fn() });

    const { queryByTestId } = render(<ModelFailureCard />);
    expect(queryByTestId('model-failure-load-anyway-image')).toBeNull();
    // Retry is still there — this failure is retryable, just not overridable.
    expect(queryByTestId('model-failure-retry-image')).not.toBeNull();
  });

  it('does NOT show "Load Anyway" when overridable but no handler was supplied', () => {
    push({ modelType: 'image', overridable: true, onRetry: jest.fn() });
    const { queryByTestId } = render(<ModelFailureCard />);
    expect(queryByTestId('model-failure-load-anyway-image')).toBeNull();
  });

  it('offers Load Anyway for a NON-image model type too (uniform across surfaces)', () => {
    const onLoadAnyway = jest.fn();
    push({ modelType: 'tts', overridable: true, onLoadAnyway });
    const { getByTestId } = render(<ModelFailureCard />);
    fireEvent.press(getByTestId('model-failure-load-anyway-tts'));
    expect(onLoadAnyway).toHaveBeenCalledTimes(1);
  });
});
