import React from 'react';
import { NativeModules, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {MobileApplicationFixture} from '../../harness/mobileApplicationFixture';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

/**
 * The Android Downloads boundary, behaving as the device does: a media permission shows the media in
 * Download and nothing else, all-files access is granted on a system screen we cannot dismiss from
 * inside the app, and the app only learns about it the next time it asks.
 */
function installDownloadsBoundary(initial: { media: boolean; allFiles: boolean }): {
  set: (next: { media: boolean; allFiles: boolean }) => void;
  grantAllFiles: () => void;
  requests: number;
} {
  const state = { ...initial };
  const record = {
    set: (next: { media: boolean; allFiles: boolean }) => Object.assign(state, next, { requests: 0 }),
    grantAllFiles: () => (state.allFiles = true),
    requests: 0,
  };
  (NativeModules as Record<string, unknown>).SyncDownloadsModule = {
    hasPermission: async () => state.media || state.allFiles,
    accessState: async () => ({
      media: state.media,
      allFiles: state.allFiles,
      canRequestAllFiles: true,
    }),
    requestAllFilesAccess: async () => {
      record.requests += 1;
      return true;
    },
    // The honest limit of a media permission: a downloaded PDF is simply not in what we are handed.
    enumerate: async () =>
      state.allFiles
        ? [
            {
              sourceId: '/sdcard/Download/statement.pdf',
              name: 'statement.pdf',
              mimeType: 'application/pdf',
              fileSize: 4096,
              createdAt: new Date(0).toISOString(),
              modifiedAt: 0,
            },
          ]
        : [],
    stage: async () => ({ filePath: '/staged/statement.pdf', name: 'statement.pdf' }),
  };
  return record;
}

// Installed before the screen is required, because the sharing service reads the boundary once when
// it is constructed - exactly as it does on a device at launch.
const boundary = installDownloadsBoundary({ media: false, allFiles: false });
let applicationFixture: MobileApplicationFixture;
let SyncSharingSettingsScreen: typeof import('../../../pro/ui/SyncScreen/SyncSharingSettingsScreen')['SyncSharingSettingsScreen'];
let sharedFileSyncService: typeof import('../../../pro/sync/sharedFileSyncService')['sharedFileSyncService'];

function mountSharingScreen(): ReturnType<typeof render> {
  return render(
    <NavigationContainer>
      <SyncSharingSettingsScreen />
    </NavigationContainer>,
  );
}

describe('Android downloads sharing', () => {
  beforeAll(async () => {
    const {startMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    applicationFixture = await startMobileApplicationFixture({pro: true});
    ({SyncSharingSettingsScreen} = require('../../../pro/ui/SyncScreen/SyncSharingSettingsScreen') as typeof import('../../../pro/ui/SyncScreen/SyncSharingSettingsScreen'));
    ({sharedFileSyncService} = require('../../../pro/sync/sharedFileSyncService') as typeof import('../../../pro/sync/sharedFileSyncService'));
  });

  afterAll(async () => {
    await applicationFixture.dispose();
  });

  beforeEach(async () => {
    await AsyncStorage.clear();
    Object.defineProperty(Platform, 'OS', {
      value: 'android',
      configurable: true,
    });
    boundary.requests = 0;
    // Back to a device that is not watching anything yet, then the launch read of the boundary.
    await sharedFileSyncService.downloads.remove();
    await sharedFileSyncService.downloads.start();
  });

  it('asks for media access rather than a folder, and says what it cannot see', async () => {
    boundary.set({ media: false, allFiles: false });
    await sharedFileSyncService.downloads.foreground();
    const ui = mountSharingScreen();

    fireEvent.press(ui.getByTestId('ambient-open-settings'));
    await waitFor(() => expect(ui.getByText('Downloads')).toBeTruthy());

    // No picker exists for this folder on Android, so the button must not promise one.
    expect(ui.getByTestId('ambient-download-configure')).toBeTruthy();
    expect(ui.getByText('Allow media access')).toBeTruthy();
    expect(ui.queryByText('Choose folder')).toBeNull();
  });

  it('offers all-files access, and stops saying half the folder is invisible once it is granted', async () => {
    boundary.set({ media: true, allFiles: false });
    await sharedFileSyncService.downloads.foreground();
    const ui = mountSharingScreen();

    fireEvent.press(ui.getByTestId('ambient-open-settings'));
    await waitFor(() => expect(ui.getByText('Downloads')).toBeTruthy());

    // Media access is already held, so watching starts without another permission prompt.
    fireEvent.press(ui.getByTestId('ambient-download-configure'));
    await waitFor(() =>
      expect(ui.getByTestId('ambient-download-remove')).toBeTruthy(),
    );
    expect(
      ui.getByText(/Android only shows apps the pictures and video in Downloads/),
    ).toBeTruthy();

    // The escalation exists because a PDF is not media. Granting it is a trip to Settings.
    fireEvent.press(ui.getByTestId('ambient-download-upgrade'));
    await waitFor(() => expect(boundary.requests).toBe(1));
    boundary.grantAllFiles();

    // Coming back is when the app learns: the limitation goes away rather than lingering as a lie.
    fireEvent.press(ui.getByTestId('ambient-download-rescan'));
    await waitFor(() =>
      expect(
        ui.queryByText(
          /Android only shows apps the pictures and video in Downloads/,
        ),
      ).toBeNull(),
    );
  });

  it('does not ask an iPhone for media access, because there the folder can be picked', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    boundary.set({ media: false, allFiles: false });
    await sharedFileSyncService.downloads.foreground();
    const ui = mountSharingScreen();

    fireEvent.press(ui.getByTestId('ambient-open-settings'));
    await waitFor(() => expect(ui.getByText('Downloads')).toBeTruthy());
    expect(ui.getByText('Choose folder')).toBeTruthy();
    expect(ui.queryByText('Allow media access')).toBeNull();
  });
});
