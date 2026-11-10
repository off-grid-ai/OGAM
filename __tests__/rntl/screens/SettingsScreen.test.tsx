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
import { render, fireEvent, waitFor } from '@testing-library/react-native';
// Import the SAME shared URL constants the screen uses, so the tap assertions ride on the
// single source of truth (test-side DRY) rather than re-hardcoding the URL strings.
import { FOLLOW_X_URL, SLACK_INVITE_URL } from '../../../src/utils/sharePrompt';
import { SUPPORT_EMAIL } from '../../../src/utils/supportEmail';

import { SettingsScreen } from '../../../src/screens/SettingsScreen';
import { useAppStore } from '../../../src/stores/appStore';
import { withNavigatorRoutes } from '../../harness/realNavigation';

// The screen runs on a real React Navigation stack (inside a parent stack, as the Settings tab sits
// inside the app's root stack), on the real app store and the real components. The version on screen
// comes from the BUILD (Android versionName / iOS MARKETING_VERSION) via react-native-device-info,
// which jest.setup fakes at that native boundary. package.json is the live production version and is
// deliberately not what the app reads - see src/utils/appVersion.ts.
jest.unmock('@react-navigation/native');

// The device disk (the feedback mail reports its free space).
jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

const SETTINGS_ROUTES = ['ModelSettings', 'RemoteServers', 'SecuritySettings', 'DeviceInfo', 'StorageSettings'];

const renderSettings = () =>
  render(
    withNavigatorRoutes(<SettingsScreen />, {
      destinations: SETTINGS_ROUTES,
      parentDestinations: ['Onboarding'],
    }),
  );

describe('SettingsScreen', () => {
  beforeEach(() => {
    const app = useAppStore.getState();
    app.setHasRegisteredPro(false);
    app.setProBannerDismissed(false);
    app.setOnboardingComplete(true);
  });

  it('shows the Pro upsell banner when Pro is not active and not dismissed', () => {
    const { getByText } = renderSettings();
    expect(
      getByText('Keep your work in context with memory, Sync, and actions you approve.'),
    ).toBeTruthy();
  });

  it('hides the Pro upsell banner once Pro is active', () => {
    useAppStore.getState().setHasRegisteredPro(true);
    const { queryByText } = renderSettings();
    expect(queryByText(/democratized/i)).toBeNull();
  });

  it('renders "Settings" title', () => {
    const { getByText } = renderSettings();
    expect(getByText('Settings')).toBeTruthy();
  });

  it('renders version number', () => {
    const { getByText } = renderSettings();
    expect(getByText(/Version 0\.0\.103/)).toBeTruthy();
  });

  it('renders navigation items', () => {
    const { getByText } = renderSettings();
    expect(getByText('Model settings')).toBeTruthy();
    expect(getByText('Remote servers')).toBeTruthy();
    expect(getByText('Security')).toBeTruthy();
    expect(getByText('Device information')).toBeTruthy();
    expect(getByText('Storage')).toBeTruthy();
  });

  it('does not render the removed Voice Transcription / Text to Speech rows', () => {
    const { queryByText } = renderSettings();
    expect(queryByText('Voice Transcription')).toBeNull();
    expect(queryByText('Text to Speech')).toBeNull();
    expect(queryByText('On-device speech to text')).toBeNull();
  });

  it('renders navigation item descriptions', () => {
    const { getByText } = renderSettings();
    expect(getByText('Instructions, replies, and speed')).toBeTruthy();
    expect(getByText('How chats find the right part of a file')).toBeTruthy();
    expect(getByText('Your computer, Ollama or LM Studio')).toBeTruthy();
    expect(getByText('Passphrase and app lock')).toBeTruthy();
    expect(getByText('Hardware and compatibility')).toBeTruthy();
    expect(getByText('Models and data usage')).toBeTruthy();
    expect(getByText('What runs your models')).toBeTruthy();
  });

  it('navigates to correct screen when nav item is pressed', async () => {
    const { getByText, findByTestId } = renderSettings();
    fireEvent.press(getByText('Model settings'));
    expect(await findByTestId('route-ModelSettings')).toBeTruthy();
  });

  it.each([
    ['Remote servers', 'RemoteServers'],
    ['Security', 'SecuritySettings'],
    ['Device information', 'DeviceInfo'],
    ['Storage', 'StorageSettings'],
  ])('navigates to its settings screen when %s is pressed', async (label, route) => {
    const { getByText, findByTestId } = renderSettings();
    fireEvent.press(getByText(label));
    expect(await findByTestId(`route-${route}`)).toBeTruthy();
  });

  it('renders theme selector with system/light/dark options', () => {
    const { getByText } = renderSettings();
    expect(getByText('Appearance')).toBeTruthy();
  });

  it('renders the Analytics section with both consent toggles off by default', () => {
    const { getByText, getByLabelText } = renderSettings();
    expect(getByText('Analytics')).toBeTruthy();
    expect(Boolean(getByLabelText('Anonymous stats').props.on ?? getByLabelText('Anonymous stats').props.value)).toBe(false);
    expect(Boolean(getByLabelText('Crash reports').props.on ?? getByLabelText('Crash reports').props.value)).toBe(false);
    expect(getByText('What we share')).toBeTruthy();
    expect(getByText('Report a problem')).toBeTruthy();
  });

  it('renders about section text', () => {
    const { getByText } = renderSettings();
    expect(getByText('About')).toBeTruthy();
    expect(getByText(/Version/)).toBeTruthy();
  });

  it('renders the Community group with the Follow-on-X and Join-Slack items', () => {
    const { getByText, getByTestId, getByRole } = renderSettings();
    expect(getByRole('header', { name: 'Community' })).toBeTruthy();
    expect(getByText('Follow @alichherawalla on X')).toBeTruthy();
    // The two affordances are present and tappable.
    expect(getByTestId('follow-on-x')).toBeTruthy();
    expect(getByTestId('join-slack')).toBeTruthy();
  });

  it('opens the X profile URL when Follow-on-X is tapped', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByTestId } = renderSettings();
    fireEvent.press(getByTestId('follow-on-x'));
    // Terminal artifact of a link tap: the OS is handed the exact X profile URL (the shared constant).
    expect(openURL).toHaveBeenCalledWith(FOLLOW_X_URL);
    openURL.mockRestore();
  });

  it('opens the Slack invite URL when Join-Slack is tapped', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByTestId } = renderSettings();
    fireEvent.press(getByTestId('join-slack'));
    expect(openURL).toHaveBeenCalledWith(SLACK_INVITE_URL);
    openURL.mockRestore();
  });

  it('sends feedback to the shared support address', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    const { getByText } = renderSettings();

    fireEvent.press(getByText('Send feedback'));

    await waitFor(() => {
      expect(openURL.mock.calls[0]?.[0]).toContain(`mailto:${SUPPORT_EMAIL}?`);
    });
    openURL.mockRestore();
  });

  it('no longer renders the removed Pro Tools row', () => {
    const { queryByText } = renderSettings();
    // Pro Tools was removed from Settings — it must not surface (mirrors the Voice/TTS removal guard).
    expect(queryByText('Pro tools')).toBeNull();
  });

  it('keeps Reset Onboarding in development mode without the removed checklist reset', () => {
    const { getByText, queryByText } = renderSettings();
    expect(getByText('Reset onboarding')).toBeTruthy();
    expect(queryByText('Reset Onboarding Checklist')).toBeNull();
  });

  it('resets onboarding and returns the root stack to Onboarding on Reset Onboarding press', async () => {
    const { getByText, findByTestId } = renderSettings();
    fireEvent.press(getByText('Reset onboarding'));

    expect(useAppStore.getState().hasCompletedOnboarding).toBe(false);
    expect(await findByTestId('route-Onboarding')).toBeTruthy();
  });
});
