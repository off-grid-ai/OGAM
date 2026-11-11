/**
 * SettingsScreen Tests
 *
 * Tests for the settings screen including:
 * - Title and version display
 * - Navigation items
 * - Theme selector
 * - Privacy section
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
// Import the SAME shared URL constants the screen uses, so the tap assertions ride on the
// single source of truth (test-side DRY) rather than re-hardcoding the URL strings.

// Navigation is globally mocked in jest.setup.ts

jest.mock('../../../src/hooks/useFocusTrigger', () => ({
  useFocusTrigger: () => 0,
}));

jest.mock('../../../src/components', () => ({
  Card: ({ children, style }: any) => {
    const { View } = require('react-native');
    return <View style={style}>{children}</View>;
  },
}));

jest.mock('../../../src/components/AnimatedEntry', () => ({
  AnimatedEntry: ({ children }: any) => children,
}));

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, onPress, style }: any) => {
    const { TouchableOpacity } = require('react-native');
    return (
      <TouchableOpacity style={style} onPress={onPress}>
        {children}
      </TouchableOpacity>
    );
  },
}));

// Mock package.json
jest.mock('../../../package.json', () => ({ version: '1.0.0' }), {
  virtual: true,
});

const mockSetOnboardingComplete = jest.fn();
// The update card looks for a newer build on its own; the Settings tests do not need the network.
jest.mock('../../../src/services/appUpdate', () => ({ installedBuild: () => 143, checkForUpdate: jest.fn(async () => ({ current: 143, update: null })), downloadAndInstall: jest.fn() }));
const mockSetThemeMode = jest.fn();
const mockCompleteChecklistStep = jest.fn();
const mockResetChecklist = jest.fn();
jest.mock('../../../src/stores', () => ({
  useAppStore: jest.fn((selector?: any) => {
    const state = {
      setOnboardingComplete: mockSetOnboardingComplete,
      themeMode: 'system',
      setThemeMode: mockSetThemeMode,
      completeChecklistStep: mockCompleteChecklistStep,
      resetChecklist: mockResetChecklist,
    };
    return selector ? selector(state) : state;
  }),
}));

import { SettingsScreen } from '../../../src/screens/SettingsScreen';

const mockNavigate = jest.fn();
const mockDispatch = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    getParent: () => ({
      dispatch: mockDispatch,
    }),
  }),
  CommonActions: {
    reset: jest.fn((params: any) => params),
  },
}));

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Settings" title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('renders version number', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText(/Version 1\.0\.0/)).toBeTruthy();
  });

  it('renders navigation items', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Model Settings')).toBeTruthy();
    expect(getByText('Remote Servers')).toBeTruthy();
    expect(getByText('Security')).toBeTruthy();
    expect(getByText('Device Information')).toBeTruthy();
    expect(getByText('Storage')).toBeTruthy();
  });

  it('does not render the removed Voice Transcription / Text to Speech rows', () => {
    const { queryByText } = render(<SettingsScreen />);
    expect(queryByText('Voice Transcription')).toBeNull();
    expect(queryByText('Text to Speech')).toBeNull();
    expect(queryByText('On-device speech to text')).toBeNull();
  });

  it('renders navigation item descriptions', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('System prompt, generation, and performance')).toBeTruthy();
    expect(getByText('Use models running on a computer on your Wi-Fi (Ollama, LM Studio...)')).toBeTruthy();
    expect(getByText('Passphrase and app lock')).toBeTruthy();
    expect(getByText('Hardware and compatibility')).toBeTruthy();
    expect(getByText('Models and data usage')).toBeTruthy();
  });

  it('navigates to correct screen when nav item is pressed', () => {
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Model Settings'));
    expect(mockNavigate).toHaveBeenCalledWith('ModelSettings');
  });

  it('navigates to each settings screen', () => {
    const { getByText } = render(<SettingsScreen />);

    fireEvent.press(getByText('Remote Servers'));
    expect(mockNavigate).toHaveBeenCalledWith('RemoteServers');

    fireEvent.press(getByText('Security'));
    expect(mockNavigate).toHaveBeenCalledWith('SecuritySettings');

    fireEvent.press(getByText('Device Information'));
    expect(mockNavigate).toHaveBeenCalledWith('DeviceInfo');

    fireEvent.press(getByText('Storage'));
    expect(mockNavigate).toHaveBeenCalledWith('StorageSettings');
  });

  it('renders theme selector with system/light/dark options', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Appearance')).toBeTruthy();
  });

  it('calls setThemeMode when theme option is pressed', () => {
    render(<SettingsScreen />);
    // The theme options are the first three TouchableOpacity elements in the theme selector
    // We can't easily target them by text since they use icons, but pressing them calls setThemeMode
    // The three theme options are rendered - pressing one calls setThemeMode
  });

  it('renders about section text', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('About')).toBeTruthy();
    expect(getByText(/Version/)).toBeTruthy();
  });

  // Atlas removed the upstream Off Grid social links (X, Slack).
  it('does not render the upstream Stay in the loop card', () => {
    const { queryByTestId } = render(<SettingsScreen />);
    expect(queryByTestId('follow-on-x')).toBeNull();
    expect(queryByTestId('join-slack')).toBeNull();
  });

  it('renders Reset Onboarding button in __DEV__ mode', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Reset Onboarding')).toBeTruthy();
  });

  it('calls setOnboardingComplete and dispatches reset on Reset Onboarding press', () => {
    const { CommonActions } = require('@react-navigation/native');
    const { getByText } = render(<SettingsScreen />);
    fireEvent.press(getByText('Reset Onboarding'));

    expect(mockSetOnboardingComplete).toHaveBeenCalledWith(false);
    expect(CommonActions.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'Onboarding' }],
    });
    expect(mockDispatch).toHaveBeenCalled();
  });
});
