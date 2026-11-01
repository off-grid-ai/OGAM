/**
 * Settings > Appearance & AI style: picking an accent recolors the screen, and the AI style
 * the user picks ends up in every chat's system prompt.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AppearanceScreen } from '../../../src/screens/AppearanceScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { resolveAgentPrompt } from '../../../src/stores/agentStore';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
}));

describe('AppearanceScreen', () => {
  beforeEach(() => {
    useAppStore.setState({ themeMode: 'light', settings: { ...useAppStore.getState().settings, appearance: undefined, aiStyle: undefined } });
  });

  it('recolors with the picked accent', () => {
    const view = render(<AppearanceScreen />);
    const before = StyleSheet.flatten(view.getByText('Preview').props.style).color;
    fireEvent.press(view.getByTestId('accent-blue'));
    const after = StyleSheet.flatten(view.getByText('Preview').props.style).color;
    expect(before).not.toBe(after);
    expect(after).toBe('#1D4ED8');
  });

  it('"Surprise me" picks a new look and "Reset the look" brings the default back', () => {
    const view = render(<AppearanceScreen />);
    fireEvent.press(view.getByTestId('accent-blue'));
    fireEvent.press(view.getByTestId('look-surprise'));
    const { appearance } = useAppStore.getState().settings;
    expect(appearance?.palette).toBeTruthy();
    expect(appearance?.accent).toBeTruthy();
    fireEvent.press(view.getByTestId('look-reset'));
    expect(useAppStore.getState().settings.appearance?.accent).toBeUndefined();
    expect(useAppStore.getState().settings.appearance?.palette).toBeUndefined();
  });

  it('puts the chosen AI style into the system prompt', () => {
    const view = render(<AppearanceScreen />);
    fireEvent.press(view.getByText('Brief'));
    fireEvent.press(view.getByText('Playful'));
    fireEvent.changeText(view.getByTestId('ai-custom'), 'Use metric units.');
    const prompt = resolveAgentPrompt(undefined, 'You are helpful.');
    expect(prompt).toMatch(/Keep answers short/);
    expect(prompt).toMatch(/playful/i);
    expect(prompt).toMatch(/Use metric units\./);
  });
});
