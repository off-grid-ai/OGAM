/**
 * NoModelScreen — the empty state shown before a model is active.
 *
 * Regression: selecting a model kicks off a background load, but activeModelId
 * stays null until the native load finishes, so this screen stayed visible with
 * NO feedback and the user thought nothing happened. It must show a loading
 * indicator while isModelLoading is true instead of the "Select Model" prompt.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../../../src/components', () => ({
  ModelSelectorModal: () => null,
}));
jest.mock('../../../src/services', () => ({
  llmService: { getLoadedModelPath: () => null },
}));

import { NoModelScreen } from '../../../src/screens/ChatScreen/ChatScreenComponents';
import { createStyles } from '../../../src/screens/ChatScreen/styles';
import { getTheme } from '../../../src/theme';

const theme = getTheme('light');
const colors = theme.colors;
const styles = createStyles(colors, theme.shadows);

function renderScreen(overrides: Partial<React.ComponentProps<typeof NoModelScreen>> = {}) {
  return render(
    <NoModelScreen
      styles={styles}
      colors={colors}
      navigation={{ goBack: jest.fn() }}
      hasAvailableModels
      showModelSelector={false}
      setShowModelSelector={jest.fn()}
      onSelectModel={jest.fn()}
      onUnloadModel={jest.fn()}
      isModelLoading={false}
      {...overrides}
    />,
  );
}

describe('NoModelScreen', () => {
  it('shows the "Select Model" prompt when idle (not loading)', () => {
    const { getByText, queryByTestId } = renderScreen({ isModelLoading: false });
    expect(getByText('No Model Selected')).toBeTruthy();
    expect(getByText('Select Model')).toBeTruthy();
    expect(queryByTestId('no-model-loading-indicator')).toBeNull();
  });

  it('shows a loading indicator (not the prompt) while a model loads in the background', () => {
    const { getByText, getByTestId, queryByText } = renderScreen({ isModelLoading: true });
    expect(getByTestId('no-model-loading-indicator')).toBeTruthy();
    expect(getByText('Loading Model')).toBeTruthy();
    // The idle prompt + Select button must be hidden so the user isn't told to
    // re-select a model that is already loading.
    expect(queryByText('No Model Selected')).toBeNull();
    expect(queryByText('Select Model')).toBeNull();
  });
});
