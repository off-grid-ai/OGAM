/**
 * McpGuideScreen (Pro MCP Setup Guide) — RNTL tests.
 *
 * Renders the REAL component. Drives the REAL app store (themeMode) so the REAL
 * useTheme hook resolves colors, and asserts what the user SEES (section copy,
 * icon names, both branches of the checklist done/not-done ternary) plus what the
 * back control DOES (invokes navigation.goBack).
 *
 * Minimal mocks: Feather icon (text shim so names are queryable), SafeAreaView
 * (pass-through), and useNavigation (native/nav boundary). The theme store, the
 * component, and its rendering logic all run for real.
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite
 * skips cleanly in open-core CI where pro/ is absent.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  const { View } = require('react-native');
  return {
    ...actual,
    SafeAreaView: ({ children, ...rest }: any) => <View {...rest}>{children}</View>,
  };
});

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  };
});

type ScreenModule = typeof import('@offgrid/pro/ui/McpGuideScreen');

function load(): ScreenModule | null {
  try {
    return require(['@offgrid', 'pro', 'ui', 'McpGuideScreen'].join('/'));
  } catch {
    return null;
  }
}

const mod = load();
const describeIfPro = mod ? describe : describe.skip;

describeIfPro('McpGuideScreen', () => {
  const { useAppStore } = require('@offgrid/core/stores');
  const McpGuideScreen = mod!.McpGuideScreen;
  const initialThemeMode = useAppStore.getState().themeMode;

  afterEach(() => {
    mockGoBack.mockClear();
    useAppStore.setState({ themeMode: initialThemeMode });
  });

  it('renders the header title and every section heading', () => {
    render(<McpGuideScreen />);
    expect(screen.getByText('MCP Setup Guide')).toBeTruthy();
    expect(screen.getByText('What MCP enables')).toBeTruthy();
    expect(screen.getByText('Local models: what to expect')).toBeTruthy();
    expect(screen.getByText('Remote models: best results')).toBeTruthy();
    expect(screen.getByText('Context window tip')).toBeTruthy();
    expect(screen.getByText('Quick checklist')).toBeTruthy();
  });

  it('renders the recommended-model copy in each card', () => {
    render(<McpGuideScreen />);
    expect(
      screen.getByText('Gemma 3 2B or 4B with thinking enabled - keep enabled tools under 5'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Qwen3 14B or Qwen3-30B-A3B (strong tool calling), or GLM-4.5-Air, via Ollama or LM Studio',
      ),
    ).toBeTruthy();
  });

  it('renders the card header icons (alert-triangle for local, wifi for remote)', () => {
    render(<McpGuideScreen />);
    expect(screen.getByText('alert-triangle')).toBeTruthy();
    expect(screen.getByText('wifi')).toBeTruthy();
  });

  it('renders both branches of the checklist ternary: 3 done (check-circle) and 1 not-done (circle)', () => {
    render(<McpGuideScreen />);
    // CHECKLIST_ITEMS: 3 done → check-circle, 1 not done → circle.
    expect(screen.getAllByText('check-circle')).toHaveLength(3);
    expect(screen.getAllByText('circle')).toHaveLength(1);

    expect(screen.getByText('Using a remote or thinking-capable model')).toBeTruthy();
    expect(
      screen.getByText('Start a new chat after changing tools (context resets)'),
    ).toBeTruthy();
  });

  it('renders the back arrow and calls navigation.goBack when the back control is pressed', () => {
    render(<McpGuideScreen />);
    const backIcon = screen.getByText('arrow-left');
    expect(mockGoBack).not.toHaveBeenCalled();
    fireEvent.press(backIcon);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('resolves colors via the REAL useTheme for both light and dark theme modes', () => {
    useAppStore.setState({ themeMode: 'light' });
    const light = render(<McpGuideScreen />);
    expect(light.getByText('MCP Setup Guide')).toBeTruthy();
    light.unmount();

    useAppStore.setState({ themeMode: 'dark' });
    render(<McpGuideScreen />);
    // Same content renders regardless of resolved palette — proves the real
    // useTheme branch runs without throwing for either mode.
    expect(screen.getByText('MCP Setup Guide')).toBeTruthy();
  });
});
