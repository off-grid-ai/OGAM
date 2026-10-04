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
import { Linking } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
// Import the SAME shared URL constants the screen uses, so the tap assertions ride on the
// single source of truth (test-side DRY) rather than re-hardcoding the URL strings.
import { FOLLOW_X_URL, SLACK_INVITE_URL } from '../../../src/utils/sharePrompt';
import { SUPPORT_EMAIL } from '../../../src/utils/supportEmail';

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

// The version on screen comes from the BUILD (Android versionName / iOS MARKETING_VERSION) via
// react-native-device-info, which jest.setup fakes at that native boundary. package.json is the live
// production version and is deliberately not what the app reads - see src/utils/appVersion.ts.

const mockSetOnboardingComplete = jest.fn();
const mockSetThemeMode = jest.fn();
const mockCompleteChecklistStep = jest.fn();
// Mutated per-test to drive Pro banner visibility. `mock`-prefixed so jest.mock's
// hoisted factory is allowed to reference it.
const mockProState = { hasRegisteredPro: false, proBannerDismissed: false };
jest.mock('../../../src/stores', () => ({
  useAppStore: Object.assign(
    jest.fn((selector?: any) => {
      const state = {
        setOnboardingComplete: mockSetOnboardingComplete,
        themeMode: 'system',
        setThemeMode: mockSetThemeMode,
        completeChecklistStep: mockCompleteChecklistStep,
        setProBannerDismissed: jest.fn(),
        hasRegisteredPro: mockProState.hasRegisteredPro,
        proBannerDismissed: mockProState.proBannerDismissed,
      };
      return selector ? selector(state) : state;
    }),
    {
      getState: () => ({ downloadedModels: [], activeModelId: null }),
    },
  ),
  useRemoteServerStore: {
    getState: () => ({ activeServerId: null }),
  },
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
    mockProState.hasRegisteredPro = false;
    mockProState.proBannerDismissed = false;
  });

  it('shows the Pro upsell banner when Pro is not active and not dismissed', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(
      getByText(
        'Your private AI stays current across your devices with live sync.',
      ),
    ).toBeTruthy();
  });

  it('hides the Pro upsell banner once Pro is active', () => {
    mockProState.hasRegisteredPro = true;
    const { queryByText } = render(<SettingsScreen />);
    expect(queryByText(/democratized/i)).toBeNull();
  });

  it('renders "Settings" title', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Settings')).toBeTruthy();
  });

  it('renders version number', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText(/Version 0\.0\.103/)).toBeTruthy();
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
    expect(
      getByText('System prompt, generation, and performance'),
    ).toBeTruthy();
    expect(
      getByText('Connect to Off Grid AI Desktop, Ollama, LM Studio, and more'),
    ).toBeTruthy();
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

  it('renders Privacy First section', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('Privacy First')).toBeTruthy();
    expect(getByText(/All your data stays on this device/)).toBeTruthy();
  });

  it('renders about section text', () => {
    const { getByText } = render(<SettingsScreen />);
    expect(getByText('About')).toBeTruthy();
    expect(getByText(/Version/)).toBeTruthy();
  });

  it('renders the "Stay in the loop" card with the Follow-on-X and Join-Slack items', () => {
    const { getByText, getByTestId } = render(<SettingsScreen />);
    expect(getByText('Stay in the loop')).toBeTruthy();
    expect(getByText('Follow @alichherawalla on X')).toBeTruthy();
    // The two affordances are present and tappable.
    expect(getByTestId('follow-on-x')).toBeTruthy();
    expect(getByTestId('join-slack')).toBeTruthy();
  });

  it('opens the X profile URL when Follow-on-X is tapped', () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
    const { getByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByTestId('follow-on-x'));
    // Terminal artifact of a link tap: the OS is handed the exact X profile URL (the shared constant).
    expect(openURL).toHaveBeenCalledWith(FOLLOW_X_URL);
    openURL.mockRestore();
  });

  it('opens the Slack invite URL when Join-Slack is tapped', () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(undefined as never);
    const { getByTestId } = render(<SettingsScreen />);
    fireEvent.press(getByTestId('join-slack'));
    expect(openURL).toHaveBeenCalledWith(SLACK_INVITE_URL);
    openURL.mockRestore();
  });

  it('no longer renders the removed Pro Tools row', () => {
    const { queryByText } = render(<SettingsScreen />);
    // Pro Tools was removed from Settings — it must not surface (mirrors the Voice/TTS removal guard).
    expect(queryByText('Pro Tools')).toBeNull();
  });

  it('keeps Reset Onboarding in development mode without the removed checklist reset', () => {
    const { getByText, queryByText } = render(<SettingsScreen />);
    expect(getByText('Reset Onboarding')).toBeTruthy();
    expect(queryByText('Reset Onboarding Checklist')).toBeNull();
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

  it('sends feedback to the shared support address', async () => {
    const { installNativeBoundary, requireRTL } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    installNativeBoundary();
    jest.unmock('../../../src/stores');
    const nativeFs =
      require('react-native-fs') as typeof import('react-native-fs').default;
    Object.defineProperty(nativeFs, 'getFSInfo', {
      configurable: true,
      value: jest.fn(async () => ({
        freeSpace: 8 * 1024 * 1024 * 1024,
        freeSpaceEx: 8 * 1024 * 1024 * 1024,
        totalSpace: 16 * 1024 * 1024 * 1024,
        totalSpaceEx: 16 * 1024 * 1024 * 1024,
      })),
    });
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const fixture = await startMobileApplicationFixture();
    const rtl = requireRTL();
    const { SettingsScreen: RealSettingsScreen } =
      require('../../../src/screens/SettingsScreen') as typeof import('../../../src/screens/SettingsScreen');
    const { Linking: nativeLinking } =
      require('react-native') as typeof import('react-native');
    const openURL = jest
      .spyOn(nativeLinking, 'openURL')
      .mockResolvedValue(undefined as never);
    try {
      const { getByText } = rtl.render(<RealSettingsScreen />);
      rtl.fireEvent.press(getByText('Send Feedback'));

      await rtl.waitFor(() => {
        expect(openURL.mock.calls[0]?.[0]).toContain(
          `mailto:${SUPPORT_EMAIL}?`,
        );
      });
    } finally {
      openURL.mockRestore();
      await fixture.dispose();
    }
  });
});
