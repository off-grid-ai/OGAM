import React from 'react';
import {
  FlatList,
  NativeEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import {
  CLIPBOARD_CHANNEL,
  isClipboardAckMessage,
  MAX_CLIPBOARD_TEXT_BYTES,
  type DeviceInfo,
} from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import type {
  NativeClipboardBoundary,
  NativeClipboardChange,
  PendingNativeClipboardText,
} from '../../../src/services/sync/nativeClipboard';
import {
  MobileClipboardSyncService,
  clipboardSyncService,
} from '../../../pro/sync/clipboardSyncService';
import { ClipboardPreferences } from '../../../pro/sync/clipboardPreferences';
import { ClipboardHistoryStore } from '../../../pro/sync/clipboardHistoryStore';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { ClipboardScreen } from '../../../pro/ui/ClipboardScreen';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { SyncSharingSettingsScreen } from '../../../pro/ui/SyncScreen/SyncSharingSettingsScreen';
import { SyncActivityScreen } from '../../../pro/ui/SyncScreen/SyncActivityScreen';
import { SyncFilesScreen } from '../../../pro/ui/SyncScreen/SyncFilesScreen';
import { ProRoot } from '../../../pro/ui/ProRoot';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import {
  createNativeTcpBoundary,
  getDiscoveryBoundaries,
  resetDiscoveryBoundaries,
} from '../../utils/nativeSyncBoundaries';
import { sheetAction } from '../../utils/sheets';
import {
  pairingCodeOnScreen,
  TYPED_PAIRING_CODE,
} from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import {
  createLicensedMesh,
  installLicensedPhone,
  registerThisPhone,
} from '../../harness/licensedMesh';

/** This phone's fingerprint, which is also the sync device id its installation registers under. */
const PHONE_FINGERPRINT = 'fp-this-phone';

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary: createBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

class ClipboardBoundary implements NativeClipboardBoundary {
  enabled = false;
  readonly writes: string[] = [];
  readonly acknowledged: string[] = [];
  ambientCapture = true;
  pending: PendingNativeClipboardText[] = [];
  private listener: ((change: NativeClipboardChange) => void) | null = null;
  private pendingListener: (() => void) | null = null;

  ambientExternalCaptureAvailable(): boolean {
    return this.ambientCapture;
  }

  async pendingLocalText(): Promise<PendingNativeClipboardText[]> {
    return [...this.pending];
  }

  async acknowledgePendingLocalText(ids: string[]): Promise<void> {
    this.acknowledged.push(...ids);
    this.pending = this.pending.filter(item => !ids.includes(item.id));
  }

  onPendingLocalTextAvailable(listener: () => void): () => void {
    this.pendingListener = listener;
    return () => {
      this.pendingListener = null;
    };
  }

  processText(item: PendingNativeClipboardText): void {
    this.pending.push(item);
    this.pendingListener?.();
  }

  observe(listener: (change: NativeClipboardChange) => void): () => void {
    this.enabled = true;
    this.listener = listener;
    return () => {
      this.enabled = false;
      this.listener = null;
    };
  }

  copy(text: string, ts: number): void {
    if (this.enabled) this.listener?.({ text, ts });
  }

  writeText(text: string): void {
    this.writes.push(text);
    this.copy(text, Date.now());
  }
}

const device = (id: string, platform: DeviceInfo['platform']): DeviceInfo => ({
  id,
  name: id,
  platform,
  version: '1',
  host: '127.0.0.1',
  port: 0,
});

const BASE_TIME = Date.UTC(2026, 6, 28, 12, 0, 0);
const CLIPBOARD_HISTORY_STORAGE_KEY = 'offgrid-sync-clipboard-history-v1';

/** Two devices that can pair: an in-memory licence provider, and a licensed peer to pair with. */
const mesh = createLicensedMesh();

describe('mobile clipboard Sync journey', () => {
  let remote: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;

  beforeEach(async () => {
    mesh.reset();
    NativeModules.SyncClipboardModule = {
      setEnabled: jest.fn(),
      writeText: jest.fn(),
      readPendingProcessText: jest.fn().mockResolvedValue([]),
      acknowledgePendingProcessText: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    await clipboardSyncService.stop();
    await AsyncStorage.clear();
    await clipboardSyncService.clearHistory();
    await clipboardSyncService.stop();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerScreen({
      name: 'SyncSharingSettings',
      component: SyncSharingSettingsScreen,
    });
    registerScreen({ name: 'Clipboard', component: ClipboardScreen });
    // Sync links on to these, so they are registered the way pro/index.ts registers them.
    registerScreen({ name: 'SyncActivity', component: SyncActivityScreen });
    registerScreen({ name: 'SyncFiles', component: SyncFilesScreen });
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore
      .getState()
      .setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    // The second journey pairs the app's own service with a joining desktop, so this phone has to be the
    // licensed side: two unlicensed devices cannot pair at all.
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    await registerThisPhone(mesh);
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
  });

  afterEach(async () => {
    mesh.restore();
    ui?.unmount();
    await remote?.engine.stop();
    await syncService.stop();
    await clipboardSyncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    jest.restoreAllMocks();
  });

  it('rejects remote clipboard text as soon as the entitlement closes', async () => {
    const nativeClipboard = new ClipboardBoundary();
    let receiveRemote:
      | ((deviceId: string, channel: string, data: unknown) => void)
      | undefined;
    const service = new MobileClipboardSyncService({
      nativeClipboard,
      preferences: new ClipboardPreferences(),
      localDevice: async () => device('this-phone', 'ios'),
      transport: {
        sendApp: () => true,
        connectedDeviceIds: () => ['paired-mac'],
        thisDeviceName: () => 'This phone',
        deviceName: () => 'Paired Mac',
        onAppMessage: listener => {
          receiveRemote = listener;
          return () => {
            receiveRemote = undefined;
          };
        },
      },
      now: () => BASE_TIME,
    });
    service.setEntitlementActive(true);
    await service.setEnabled(true);
    receiveRemote?.('paired-mac', CLIPBOARD_CHANNEL, {
      t: 'text',
      text: 'arrived before expiry',
      ts: BASE_TIME,
    });
    await waitFor(() =>
      expect(nativeClipboard.writes).toEqual(['arrived before expiry']),
    );

    service.setEntitlementActive(false);
    receiveRemote?.('paired-mac', CLIPBOARD_CHANNEL, {
      t: 'text',
      text: 'arrived after expiry',
      ts: BASE_TIME + 1,
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(nativeClipboard.writes).toEqual(['arrived before expiry']);
    expect(service.enabled()).toBe(false);
    await service.stop();
  });

  it('syncs opted-in native clipboard text once over the encrypted app channel', async () => {
    const tcpModule = createNativeTcpBoundary() as RnTcpModule;
    const mobileDevice = device('mobile-clipboard', 'ios');
    const desktopDevice = device('desktop-clipboard', 'macos');
    const connected = new Set<string>();
    const mobileAppListeners = new Set<
      (deviceId: string, channel: string, data: unknown) => void
    >();
    const receivedByDesktop: unknown[] = [];
    /** What the desktop was sent as CONTENT. An acknowledgement is a receipt, not a clip. */
    const contentReceivedByDesktop = (): unknown[] =>
      receivedByDesktop.filter(message => !isClipboardAckMessage(message));

    const mobile = buildSyncEngine({
      // One side sponsors, the other joins - two licensed devices that were never registered is the one
      // arrangement that cannot happen, and two unlicensed ones cannot pair at all.
      pairingEntitlement: mesh.peer(),
      localDevice: mobileDevice,
      tcpModule,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      onPaired: peer => connected.add(peer.id),
      onAppMessage: (deviceId, channel, data) => {
        for (const listener of mobileAppListeners) {
          listener(deviceId, channel, data);
        }
      },
    });
    const desktop = buildSyncEngine({
      pairingEntitlement: mesh.joiner({
        name: desktopDevice.name,
        platform: desktopDevice.platform,
      }),
      localDevice: desktopDevice,
      tcpModule,
      getPassphrase: async () => TYPED_PAIRING_CODE,
      onAppMessage: (_deviceId, channel, data) => {
        if (channel === CLIPBOARD_CHANNEL) receivedByDesktop.push(data);
      },
    });
    const nativeClipboard = new ClipboardBoundary();
    await AsyncStorage.setItem(
      CLIPBOARD_HISTORY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'legacy-desktop-clip',
            text: 'saved before the update',
            copiedAt: BASE_TIME - 1_000,
            source: 'remote',
            sourceDeviceId: desktopDevice.id,
            sourceDeviceName: 'Off Grid AI Desktop',
          },
        ],
      }),
    );
    const history = new ClipboardHistoryStore();
    let clock = BASE_TIME;
    const service = new MobileClipboardSyncService({
      nativeClipboard,
      preferences: new ClipboardPreferences(),
      history,
      localDevice: async () => mobileDevice,
      transport: {
        sendApp: (deviceId, channel, data) =>
          mobile.engine.sendApp(deviceId, channel, data),
        connectedDeviceIds: () => [...connected],
        thisDeviceName: () => mobileDevice.name,
        deviceName: deviceId =>
          deviceId === desktopDevice.id ? 'Off Grid AI Desktop' : undefined,
        onAppMessage: listener => {
          mobileAppListeners.add(listener);
          return () => mobileAppListeners.delete(listener);
        },
      },
      now: () => clock,
    });

    await Promise.all([mobile.engine.start(0), desktop.engine.start(0)]);
    desktopDevice.port = desktop.transport.boundPort ?? 0;
    await mobile.engine.pair(desktopDevice, TYPED_PAIRING_CODE);
    await waitFor(() => expect(connected.has(desktopDevice.id)).toBe(true));
    await service.start();
    // Pro is an entitlement the service is TOLD about, exactly as pro/index.ts tells it on activation.
    // Without it `enabled()` stays false however the preference is set, so native observation never
    // starts and nothing is ever copied - a silence that reads like a broken clipboard.
    service.setEntitlementActive(true);

    nativeClipboard.copy('disabled stays on phone', clock);
    expect(contentReceivedByDesktop()).toEqual([]);

    await service.setEnabled(true);
    expect(nativeClipboard.enabled).toBe(true);
    nativeClipboard.copy('copied on iPhone', clock);
    await waitFor(() =>
      expect(contentReceivedByDesktop()).toEqual([
        expect.objectContaining({
          t: 'text',
          v: 2,
          text: 'copied on iPhone',
          ts: BASE_TIME,
          provenance: {
            originDeviceId: mobileDevice.id,
            originDeviceName: mobileDevice.name,
          },
        }),
      ]),
    );

    clock += 500;
    nativeClipboard.processText({
      id: 'android-process-text-1',
      text: 'selected in another Android app',
      ts: clock,
    });
    await waitFor(() =>
      expect(nativeClipboard.acknowledged).toContain('android-process-text-1'),
    );
    expect(contentReceivedByDesktop()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'selected in another Android app',
          provenance: {
            originDeviceId: mobileDevice.id,
            originDeviceName: mobileDevice.name,
          },
        }),
      ]),
    );
    expect(service.historySnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'selected in another Android app',
          isLocal: true,
        }),
      ]),
    );

    clock += 500;
    const inbound = { t: 'text', text: 'copied on Mac', ts: clock };
    expect(
      desktop.engine.sendApp(mobileDevice.id, CLIPBOARD_CHANNEL, inbound),
    ).toBe(true);
    await waitFor(() =>
      expect(nativeClipboard.writes).toEqual(['copied on Mac']),
    );
    await waitFor(() =>
      expect(service.historySnapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: 'saved before the update',
            isLocal: false,
            provenance: {
              originDeviceId: desktopDevice.id,
              originDeviceName: 'Off Grid AI Desktop',
            },
          }),
          expect.objectContaining({
            text: 'copied on Mac',
            isLocal: false,
            provenance: {
              originDeviceId: desktopDevice.id,
              originDeviceName: 'Off Grid AI Desktop',
            },
          }),
          expect.objectContaining({
            text: 'copied on iPhone',
            isLocal: true,
            provenance: {
              originDeviceId: mobileDevice.id,
              originDeviceName: mobileDevice.name,
            },
          }),
        ]),
      ),
    );
    expect(service.historySnapshot()).toHaveLength(4);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(contentReceivedByDesktop()).toHaveLength(2);

    desktop.engine.sendApp(mobileDevice.id, CLIPBOARD_CHANNEL, inbound);
    desktop.engine.sendApp(mobileDevice.id, CLIPBOARD_CHANNEL, {
      t: 'text',
      text: 'missing timestamp',
    });
    desktop.engine.sendApp(mobileDevice.id, CLIPBOARD_CHANNEL, {
      t: 'text',
      text: 'x'.repeat(MAX_CLIPBOARD_TEXT_BYTES + 1),
      ts: 4,
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(nativeClipboard.writes).toEqual(['copied on Mac']);

    await service.stop();
    const restoredBoundary = new ClipboardBoundary();
    const restored = new MobileClipboardSyncService({
      nativeClipboard: restoredBoundary,
      preferences: new ClipboardPreferences(),
      localDevice: async () => mobileDevice,
      history: new ClipboardHistoryStore(),
      transport: {
        sendApp: (deviceId, channel, data) =>
          mobile.engine.sendApp(deviceId, channel, data),
        connectedDeviceIds: () => [...connected],
        thisDeviceName: () => mobileDevice.name,
        deviceName: deviceId =>
          deviceId === desktopDevice.id ? 'Off Grid AI Desktop' : undefined,
        onAppMessage: listener => {
          mobileAppListeners.add(listener);
          return () => mobileAppListeners.delete(listener);
        },
      },
    });
    await restored.start();
    // A relaunch is told about the entitlement again, the way activation tells it every time.
    restored.setEntitlementActive(true);
    expect(restored.enabled()).toBe(true);
    expect(restoredBoundary.enabled).toBe(true);
    expect(restored.historySnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'saved before the update',
          provenance: {
            originDeviceId: desktopDevice.id,
            originDeviceName: 'Off Grid AI Desktop',
          },
        }),
        expect.objectContaining({
          text: 'copied on Mac',
          provenance: {
            originDeviceId: desktopDevice.id,
            originDeviceName: 'Off Grid AI Desktop',
          },
        }),
      ]),
    );

    await restored.setEnabled(false);
    expect(restoredBoundary.enabled).toBe(false);
    desktop.engine.sendApp(mobileDevice.id, CLIPBOARD_CHANNEL, {
      t: 'text',
      text: 'disabled receiver',
      ts: clock + 1_000,
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(restoredBoundary.writes).toEqual([]);

    await restored.stop();
    await Promise.all([mobile.engine.stop(), desktop.engine.stop()]);
  });

  it('shows attributed clipboard history through Settings and manages it', async () => {
    let nativeChange: ((change: NativeClipboardChange) => void) | undefined;
    let nativeClipboardEnabled = false;
    let nativeClipboardText = '';
    const nativeModule = {
      setEnabled: (enabled: boolean) => {
        nativeClipboardEnabled = enabled;
      },
      writeText: (text: string) => {
        nativeClipboardText = text;
      },
      addListener: (_eventName: string) => undefined,
      removeListeners: (_count: number) => undefined,
    };
    NativeModules.SyncClipboardModule = nativeModule;
    jest
      .spyOn(NativeEventEmitter.prototype, 'addListener')
      .mockImplementation((eventName, listener) => {
        if (eventName === 'SyncClipboardChanged') {
          nativeChange = listener as (change: NativeClipboardChange) => void;
        }
        return { remove: () => undefined } as unknown as EmitterSubscription;
      });

    const remoteDevice: DeviceInfo = {
      id: 'clipboard-desktop',
      name: 'Off Grid AI Desktop',
      platform: 'macos',
      version: '1',
      host: '127.0.0.1',
      port: 0,
    };
    remote = buildSyncEngine({
      pairingEntitlement: mesh.joiner(),
      localDevice: remoteDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
    });
    await remote.engine.start(0);
    remoteDevice.port = remote.transport.boundPort ?? 0;
    await syncService.start();
    // Pro is an entitlement the clipboard service is TOLD about, as pro/index.ts tells it on activation.
    // Without it the toggle flips, the preference is saved, and native observation never starts.
    clipboardSyncService.setEntitlementActive(true);

    ui = render(
      <>
        <ProRoot />
        <NavigationContainer>
          <AppNavigator />
        </NavigationContainer>
      </>,
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    // Settings has to be the visible screen before its rows can be pressed: a press delivered while the
    // tab is still transitioning is dropped, and the journey then reads as a screen that never arrived.
    await waitFor(() => expect(ui!.getByText('Model settings')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-settings'));
    // Wait for the Sync screen itself before reading anything off it: asking for its contents while
    // still on Settings reports missing elements rather than a screen that has not arrived.
    //
    // Gated on the pairing code, which is on the screen whatever the mesh is doing. It used to also
    // wait for the word "Discoverable", which was never about discoverability - the card no longer
    // prints that word when the device is simply discoverable, because the switch beneath it says so.
    await waitFor(() =>
      expect(ui!.getByTestId('sync-pairing-code-value')).toBeTruthy(),
    );

    const mobile = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!mobile || !discovery?.publishedPort) {
      throw new Error('Sync did not publish the mobile device');
    }
    const pairing = remote.engine.pair(
      {
        ...mobile,
        host: '127.0.0.1',
        port: discovery.publishedPort,
      },
      await pairingCodeOnScreen(ui),
    );
    // Waited on the outcome, not the progress sheet: pairing over an in-memory transport is done in a
    // couple of milliseconds and the sheet has been and gone.
    await pairing;

    fireEvent.press(ui.getByTestId('sync-open-sharing'));
    const toggle = ui.getByTestId('sync-clipboard-toggle');
    expect(toggle.props.value).toBe(false);
    fireEvent(toggle, 'valueChange', true);
    await waitFor(() => expect(toggle.props.value).toBe(true));
    expect(nativeClipboardEnabled).toBe(true);
    await waitFor(() => expect(ui!.getByText('Clipboard access')).toBeTruthy());
    expect(
      ui.getByText(
        'Settings > Apps > Off Grid AI > Paste from Other Apps > Allow',
      ),
    ).toBeTruthy();
    expect(ui.getByTestId('open-clipboard-permission-settings')).toBeTruthy();
    fireEvent.press(ui.getByText('Done'));
    await waitFor(() => expect(ui!.queryByText('Clipboard access')).toBeNull());

    fireEvent(toggle, 'valueChange', false);
    await waitFor(() => expect(toggle.props.value).toBe(false));
    expect(nativeClipboardEnabled).toBe(false);
    fireEvent(toggle, 'valueChange', true);
    await waitFor(() => expect(toggle.props.value).toBe(true));
    expect(nativeClipboardEnabled).toBe(true);
    expect(ui.queryByText('Clipboard access')).toBeNull();
    expect(nativeChange).toBeDefined();

    nativeChange?.({ text: 'copied on iPhone', ts: BASE_TIME });
    await waitFor(() =>
      expect(
        remote!.engine.sendApp(mobile.id, 'clipboard-test-ready', {}),
      ).toBe(true),
    );
    expect(
      remote.engine.sendApp(mobile.id, CLIPBOARD_CHANNEL, {
        t: 'text',
        text: 'copied on Mac',
        ts: BASE_TIME + 1_000,
      }),
    ).toBe(true);
    await waitFor(() => expect(nativeClipboardText).toBe('copied on Mac'));
    nativeChange?.({ text: 'copied on Mac', ts: BASE_TIME + 2_000 });
    nativeChange?.({ text: 'copied on Mac', ts: BASE_TIME + 3_000 });

    fireEvent.press(ui.getByTestId('open-clipboard-history'));
    await waitFor(() => expect(ui!.getByText('copied on iPhone')).toBeTruthy());
    const clipboardPageToggle = ui.getByTestId('clipboard-page-sync-toggle');
    expect(clipboardPageToggle.props.value).toBe(true);
    fireEvent(clipboardPageToggle, 'valueChange', false);
    await waitFor(() =>
      expect(ui!.getByTestId('clipboard-page-sync-toggle').props.value).toBe(
        false,
      ),
    );
    expect(nativeClipboardEnabled).toBe(false);
    fireEvent(clipboardPageToggle, 'valueChange', true);
    await waitFor(() =>
      expect(ui!.getByTestId('clipboard-page-sync-toggle').props.value).toBe(
        true,
      ),
    );
    expect(nativeClipboardEnabled).toBe(true);
    const clipboardList = ui.UNSAFE_getByType(FlatList);
    expect(clipboardList.props.initialNumToRender).toBe(8);
    expect(clipboardList.props.windowSize).toBe(7);
    expect(ui.getAllByText('This phone')).toHaveLength(1);
    expect(ui.getByText('copied on Mac')).toBeTruthy();
    expect(ui.getByText('From Off Grid AI Desktop')).toBeTruthy();

    nativeClipboardText = '';
    fireEvent.press(
      ui.getAllByLabelText('Copy text from Off Grid AI Desktop')[0],
    );
    await waitFor(() => expect(nativeClipboardText).toBe('copied on Mac'));

    fireEvent.press(ui.getByLabelText('Delete text from Off Grid AI Desktop'));
    await waitFor(() => expect(ui!.queryByText('copied on Mac')).toBeNull(), {
      timeout: 10_000,
    });

    // Confirmed in an in-app sheet, like every other confirmation here - never a system modal. The
    // question says what will be lost and where from, so it is read on screen and answered by pressing.
    fireEvent.press(ui.getByTestId('clipboard-clear'));
    await waitFor(() =>
      expect(ui!.getByText('Clear clipboard history?')).toBeTruthy(),
    );
    expect(
      ui.getByText('This removes every saved text clip from this phone.'),
    ).toBeTruthy();
    // "Clear" is also the button that opened this sheet, so the one INSIDE it is found by the question.
    fireEvent.press(sheetAction(ui, 'Clear clipboard history?', 'Clear'));
    await waitFor(() =>
      expect(ui!.getByTestId('clipboard-empty')).toBeTruthy(),
    );
  }, 30000);

  it('shows the supported Android selection action without a permission remedy', async () => {
    NativeModules.SyncClipboardModule = {
      setEnabled: jest.fn(),
      writeText: jest.fn(),
      readPendingProcessText: jest.fn().mockResolvedValue([]),
      acknowledgePendingProcessText: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
    jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockReturnValue({
      remove: () => undefined,
    } as unknown as EmitterSubscription);
    jest
      .spyOn(clipboardSyncService, 'ambientExternalCaptureAvailable')
      .mockReturnValue(false);
    clipboardSyncService.setEntitlementActive(true);

    ui = render(
      <NavigationContainer>
        <>
          <SyncSharingSettingsScreen />
          <ClipboardScreen />
        </>
      </NavigationContainer>,
    );

    expect(
      ui.getAllByText('Select text, then choose Copy to Off Grid AI.'),
    ).toBeTruthy();
    fireEvent(ui.getByTestId('sync-clipboard-toggle'), 'valueChange', true);
    await waitFor(() =>
      expect(ui!.getByTestId('sync-clipboard-toggle').props.value).toBe(true),
    );
    expect(ui.queryByText('Clipboard access')).toBeNull();
    expect(ui.queryByText(/Accessibility/i)).toBeNull();
    expect(ui.getByTestId('clipboard-android-copy-hint')).toHaveTextContent(
      'Select text, then choose Copy to Off Grid AI.',
    );
  });
});
