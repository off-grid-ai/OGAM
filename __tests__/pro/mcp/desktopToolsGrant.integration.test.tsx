/**
 * Desktop tools: run a paired desktop's tools from this phone.
 *
 * SPEC (OGAM user's view): Pro tools lists each paired desktop — only desktops; a paired phone or
 * tablet serves no tools and is not listed. Its switch is off until the desktop has granted its
 * tools here. Turning it on asks that desktop; when the desktop grants, the switch stays on and its
 * tools connect. Turning it off asks the desktop to take them back; when it revokes, the switch is off.
 *
 * The real app on the real navigation stack, the real sync service, MCP grant service and MCP
 * client. Fakes only at the device boundaries: the TCP socket and discovery natives, the licence
 * provider (licensedMesh), the desktop itself (a real sync engine on the other end of the socket,
 * whose app messages are what it received) and the desktop's MCP server over HTTP (mcpHttpFake).
 * Replaces the mockist rntl companionToolsSection test, which mocked our stores and grant service.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';
import TcpSocket from 'react-native-tcp-socket';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import type { DeviceInfo } from '@offgrid/sync';
import type { RnTcpModule } from '@offgrid/sync/rn';
import { buildSyncEngine } from '../../../src/services/sync/engine';
import { AppNavigator } from '../../../src/navigation/AppNavigator';
import { registerScreen, _clearScreensForTesting } from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { syncService } from '../../../pro/sync/syncService';
import { useSyncStore } from '../../../pro/sync/syncStore';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import { McpServersScreen } from '../../../pro/ui/McpServersScreen';
import { McpToolsScreen } from '../../../pro/ui/McpToolsScreen';
import { useMcpStore } from '../../../pro/mcp/mcpStore';
import { disconnectServer } from '../../../pro/mcp/mcpService';
import { initMcpToolGrants } from '../../../pro/mcp/mcpToolGrantService';
import {
  MCP_TOOL_GRANT_CHANNEL,
  MCP_TOOL_REQUEST_CHANNEL,
  MCP_TOOL_REVOKE_CHANNEL,
} from '../../../pro/mcp/toolGrant';
import { getDiscoveryBoundaries, resetDiscoveryBoundaries } from '../../utils/nativeSyncBoundaries';
import { pairingCodeOnScreen } from '../../utils/pairFromPeer';
import { createDownloadedModel } from '../../utils/factories';
import { createLicensedMesh, installLicensedPhone, registerThisPhone } from '../../harness/licensedMesh';
import { installMcpHttpFake, type McpHttpFake } from '../../harness/mcpHttpFake';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const PHONE_FINGERPRINT = 'fp-this-phone';
/** The desktop's companion MCP server, as its grant names it (Desktop's tools gateway). */
const DESKTOP_MCP_URL = 'http://192.168.1.70:7878/mcp'; // NOSONAR - private LAN test fixture
const GRANT = { t: 'offgrid-mcp-pair', v: 1, url: DESKTOP_MCP_URL, token: 'desktop-tools-token-0123456789', name: 'Studio Mac' };

const mesh = createLicensedMesh();

describe('Desktop tools in Pro tools', () => {
  let desktop: ReturnType<typeof buildSyncEngine> | undefined;
  let ui: ReturnType<typeof render> | undefined;
  let mcp: McpHttpFake | undefined;
  let stopGrants: (() => void) | undefined;

  beforeEach(async () => {
    mesh.reset();
    await syncService.stop();
    await AsyncStorage.clear();
    resetDiscoveryBoundaries();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    // Registered the way pro/index.ts registers them.
    registerScreen({ name: 'Sync', component: SyncScreen });
    registerScreen({ name: 'McpServers', component: McpServersScreen });
    registerScreen({ name: 'McpTools', component: McpToolsScreen });
    useAppStore.getState().setOnboardingComplete(true);
    // Pro is an entitlement the app is told about, so it is seeded like any other outside fact.
    useAppStore.getState().setProActive(true);
    useAppStore.getState().setDownloadedModels([createDownloadedModel({ engine: 'litert' })]);
    useSyncStore.getState().reset();
    installLicensedPhone(mesh, { fingerprint: PHONE_FINGERPRINT });
    await registerThisPhone(mesh);
    // A tablet already on the licence: a paired device that serves no tools.
    mesh.register({ id: 'fp-kitchen-tablet', name: 'Kitchen Tablet', platform: 'android' });
    (Keychain.setGenericPassword as jest.Mock).mockResolvedValue(true);
    mcp = installMcpHttpFake({
      [DESKTOP_MCP_URL]: {
        label: 'Studio Mac',
        tools: [
          { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } },
          { name: 'list_files', description: 'List files', inputSchema: { type: 'object', properties: {} } },
        ],
      },
    });
    // What pro/index.ts starts on activation: the listener for grants and revokes.
    stopGrants = initMcpToolGrants();
  });

  afterEach(async () => {
    ui?.unmount();
    ui = undefined;
    stopGrants?.();
    for (const server of useMcpStore.getState().servers) {
      disconnectServer(server.id);
      useMcpStore.getState().removeServer(server.id);
    }
    mcp?.restore();
    mesh.restore();
    await desktop?.engine.stop();
    desktop = undefined;
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  it('lists only desktops; the switch asks the desktop, and follows its grant and its revoke', async () => {
    const received: Array<{ channel: string; data: unknown }> = [];
    const desktopDevice: DeviceInfo = {
      id: 'studio-mac', name: 'Studio Mac', platform: 'macos', version: '1', host: '127.0.0.1', port: 0,
    };
    desktop = buildSyncEngine({
      pairingEntitlement: mesh.joiner({ name: desktopDevice.name, platform: desktopDevice.platform }),
      localDevice: desktopDevice,
      tcpModule: TcpSocket as unknown as RnTcpModule,
      onAppMessage: (_deviceId, channel, data) => {
        received.push({ channel, data });
      },
    });
    await desktop.engine.start(0);
    desktopDevice.port = desktop.transport.boundPort ?? 0;
    await syncService.start();

    ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );
    // Settings › Sync, and the desktop pairs with the code on screen.
    fireEvent.press(ui.getByTestId('settings-tab'));
    await waitFor(() => expect(ui!.getByText('Model Settings')).toBeTruthy());
    fireEvent.press(ui.getByTestId('open-sync-settings'));
    await waitFor(() => expect(ui!.getByTestId('sync-pairing-code-value')).toBeTruthy());
    const phone = useSyncStore.getState().thisDevice;
    const discovery = getDiscoveryBoundaries().at(-1);
    if (!phone || !discovery?.publishedPort) throw new Error('Sync did not publish this phone');
    await desktop.engine.pair({ ...phone, host: '127.0.0.1', port: discovery.publishedPort }, await pairingCodeOnScreen(ui));

    // Back to Settings › Off Grid AI PRO › Your own tools, in your chats.
    fireEvent.press(ui.getAllByLabelText('Back').pop()!);
    fireEvent.press(await waitFor(() => ui!.getByText('Off Grid AI PRO')));
    fireEvent.press(await waitFor(() => ui!.getByText('Your own tools, in your chats')));
    const row = await waitFor(() => ui!.getByTestId(`companion-tools-${desktopDevice.id}`), { timeout: 10_000 });
    expect(row).toBeTruthy();
    expect(ui.queryByTestId('companion-tools-fp-kitchen-tablet')).toBeNull();
    expect(ui.queryByText('Kitchen Tablet')).toBeNull();
    const toggle = () => ui!.getByTestId(`companion-tools-switch-${desktopDevice.id}`);
    expect(toggle().props.value).toBe(false);

    // On: the desktop is asked.
    fireEvent(toggle(), 'valueChange', true);
    await waitFor(() =>
      expect(received).toContainEqual({ channel: MCP_TOOL_REQUEST_CHANNEL, data: { allow: true } }),
    );
    // The desktop grants: the switch reflects the grant, and its tools connect here.
    desktop.engine.sendApp(phone.id, MCP_TOOL_GRANT_CHANNEL, GRANT);
    await waitFor(() => expect(toggle().props.value).toBe(true), { timeout: 10_000 });
    await waitFor(() => expect(ui!.getByText(/^\d\/2 tools enabled$/)).toBeTruthy(), { timeout: 15_000 });

    // Off: the desktop is asked to take them back; when it revokes, the switch is off.
    fireEvent(toggle(), 'valueChange', false);
    await waitFor(() =>
      expect(received).toContainEqual({ channel: MCP_TOOL_REQUEST_CHANNEL, data: { allow: false } }),
    );
    desktop.engine.sendApp(phone.id, MCP_TOOL_REVOKE_CHANNEL, { url: DESKTOP_MCP_URL });
    await waitFor(() => expect(toggle().props.value).toBe(false), { timeout: 10_000 });
    expect(ui.queryByText(/^\d\/2 tools enabled$/)).toBeNull();
  }, 60_000);
});
