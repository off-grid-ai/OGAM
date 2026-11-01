/**
 * A Pro user loses the licence while the app is open: every paid runtime shuts down in the same
 * process, and the restricted Sync surface stays so the device can claim a seat again.
 *
 * SPEC (OGAM user's view): my seat is freed from another device while I use the phone. Without a
 * restart, the reply in progress stops, my MCP server disconnects, clipboard sync stops watching my
 * clipboard, email and calendar tools refuse, and no Pro tool, screen or audio surface is offered.
 * Sync is still there, so I can take a seat back from a paired device or a key.
 *
 * The real App boots with Pro decided by a real licence (launchLicensedApp): the real pro package,
 * activated by the app's own loadProFeatures, with the licence provider connected. Faked only at the
 * device boundary: Keygen over HTTP (the licensed mesh), the Keychain, the TCP socket and LAN
 * discovery, op-sqlite, llama.rn, the disk, the native clipboard module, an MCP server over
 * XMLHttpRequest, and the clock (to reach the next foreground revalidation).
 */
import type { LicensedMesh } from '../harness/licensedMesh';
import type { McpHttpFake } from '../harness/mcpHttpFake';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: require('../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: require('../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));
jest.mock('@op-engineering/op-sqlite', () =>
  require('../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

type App = Awaited<ReturnType<typeof import('../harness/proHarness').launchLicensedApp>>;

const NOTION_URL = 'https://notion.example.test/mcp';
const NOTION_TOOL = {
  name: 'notion_search',
  description: 'Search Notion pages.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
};

/** The OS clipboard. It only knows whether the app asked it to report clipboard changes. */
function installNativeClipboard() {
  const clipboard = { observing: false };
  const { NativeModules } = require('react-native');
  NativeModules.SyncClipboardModule = {
    setEnabled: (enabled: boolean) => {
      clipboard.observing = enabled;
    },
    writeText: () => undefined,
    readPendingProcessText: async () => [],
    acknowledgePendingProcessText: async () => undefined,
    addListener: () => undefined,
    removeListeners: () => undefined,
  };
  return clipboard;
}

describe('the Pro runtime when the licence is lost while the app is open', () => {
  let mesh: LicensedMesh;
  let mcp: McpHttpFake | undefined;
  let app: App | undefined;
  let clock: jest.SpyInstance | undefined;
  const keychain = new Map<string, string>();

  beforeEach(() => {
    const { createLicensedMesh } = require('../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    clock?.mockRestore();
    clock = undefined;
    await app?.close();
    app = undefined;
    mcp?.restore();
    mcp = undefined;
    mesh.restore();
  });

  it('stops paid work and removes paid surfaces in the same process, and keeps Sync for recovery', async () => {
    const { launchLicensedApp } = require('../harness/proHarness');
    let clipboard = { observing: false };
    app = await launchLicensedApp({
      mesh,
      secrets: keychain,
      configure: () => {
        clipboard = installNativeClipboard();
      },
    });
    const { view, rtl, boundary } = app!;
    const { installMcpHttpFake } = require('../harness/mcpHttpFake');
    mcp = installMcpHttpFake({ [NOTION_URL]: { label: 'Notion', tools: [NOTION_TOOL] } });

    const { getRegisteredScreens } = require('../../src/navigation/screenRegistry');
    const { getToolExtensions } = require('../../src/services/tools/extensions');
    const { getSlot, SLOTS } = require('../../src/bootstrap/slotRegistry');
    const { hasHook } = require('../../src/bootstrap/hookRegistry');
    const { useMcpStore } = require('../../pro/mcp/mcpStore');
    const { connectServer } = require('../../pro/mcp/mcpService');
    const { McpToolExtension } = require('../../pro/mcp/McpToolExtension');
    const { EmailCalendarExtension } = require('../../pro/tools/EmailCalendarExtension');
    const { clipboardSyncService } = require('../../pro/sync/clipboardSyncService');
    const { syncService } = require('../../pro/sync/syncService');
    const { getDiscoveryBoundaries } = require('../utils/nativeSyncBoundaries');
    const tcp = require('react-native-tcp-socket').default;
    const screenNames = () => getRegisteredScreens().map((s: { name: string }) => s.name);
    const toolIds = () => getToolExtensions().map((e: { id: string }) => e.id);
    const sendEmail = (id: string) =>
      EmailCalendarExtension.execute({ id, name: 'send_email', arguments: { to: 'ana@example.test' } });

    // BEFORE: what a Pro user has running.
    // The user adds their Notion MCP server; it connects and lists its tool.
    await rtl.act(async () => {
      useMcpStore.getState().addServer({ id: 'notion', name: 'Notion', url: NOTION_URL });
      await connectServer('notion');
    });
    expect(useMcpStore.getState().connectionStates.notion).toBe('connected');
    expect(useMcpStore.getState().serverTools.notion).toEqual([NOTION_TOOL]);
    // The user turns clipboard sync on, so the phone watches the clipboard.
    await rtl.act(async () => {
      await clipboardSyncService.setEnabled(true);
    });
    await rtl.waitFor(() => expect(clipboard.observing).toBe(true));
    expect(clipboardSyncService.enabled()).toBe(true);
    // Email tools work.
    expect((await sendEmail('e1')).error).toBeUndefined();
    // Pro tools, screens and surfaces are offered.
    expect(toolIds()).toEqual(expect.arrayContaining(['mcp', 'email-calendar']));
    expect(screenNames()).toEqual(
      expect.arrayContaining(['Sync', 'McpServers', 'McpTools', 'McpGuide']),
    );
    expect(getSlot(SLOTS.appRoot)).toBeDefined();
    expect(getSlot(SLOTS.autoSetupVoiceIndicator)).toBeDefined();
    expect(getSlot(SLOTS.taskToolDetail)).toBeDefined();
    expect(hasHook('audio.canSpeak')).toBe(true);
    expect(getSlot('message.speakButton')).toBeDefined();
    // Sync is up: its listener takes a dial on the port it advertises.
    await rtl.waitFor(() => expect(syncService.isRunning()).toBe(true), { timeout: 8000 });
    const syncPort = getDiscoveryBoundaries().at(-1)?.publishedPort;
    expect(syncPort).toBeDefined();

    // A reply is streaming when the licence goes.
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
    await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await view.findByTestId('chat-input');
    boundary.llama!.scriptCompletion({
      text: 'Here is the first part and then the rest of the answer.',
      pauseAfter: 'Here is the first part',
    });
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'Tell me something long');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await view.findByText(/Here is the first part/);
    expect(view.getByTestId('stop-button')).toBeTruthy();

    // The seat is freed from another device. On the next foreground revalidation the provider no
    // longer knows this phone, and Pro is lost. The clock moves past the
    // five-minute revalidation interval, as it would while the user was in another app.
    const phone = mesh.installations().find(machine => machine.name === 'This phone');
    mesh.keygen.forget(phone!.fingerprint);
    const realNow = Date.now.bind(Date);
    clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 6 * 60 * 1000);
    await rtl.act(async () => {
      boundary.emitAppStateChange('active');
    });

    // AFTER: the reply stops where it was.
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull(), { timeout: 8000 });
    expect(view.queryByText(/the rest of the answer/)).toBeNull();
    // The MCP server is disconnected, its tools are gone, and a call reaches no server.
    await rtl.waitFor(() =>
      expect(useMcpStore.getState().connectionStates.notion).not.toBe('connected'),
    );
    expect(useMcpStore.getState().serverTools.notion).toBeUndefined();
    const mcpCall = await McpToolExtension.execute({ id: 'm1', name: 'notion_search', arguments: {} });
    expect(mcpCall.error).toContain('not connected');
    expect(mcp!.calls).toEqual([]);
    // Clipboard sync is off and the phone no longer watches the clipboard.
    expect(clipboardSyncService.enabled()).toBe(false);
    expect(clipboard.observing).toBe(false);
    // Email and calendar tools refuse.
    expect((await sendEmail('e2')).error).toContain('Pro access is no longer active.');
    // No Pro tool is offered, and the paid screens, slots and audio surface are gone.
    expect(toolIds()).not.toContain('mcp');
    expect(toolIds()).not.toContain('email-calendar');
    expect(screenNames()).not.toContain('McpServers');
    expect(screenNames()).not.toContain('McpTools');
    expect(screenNames()).not.toContain('McpGuide');
    expect(getSlot(SLOTS.appRoot)).toBeUndefined();
    expect(getSlot(SLOTS.autoSetupVoiceIndicator)).toBeUndefined();
    expect(hasHook('audio.canSpeak')).toBe(false);
    expect(getSlot('message.speakButton')).toBeUndefined();

    // Sync stays, so the device can claim a seat again: its screen, its task card and its listener.
    expect(screenNames()).toContain('Sync');
    expect(getSlot(SLOTS.taskToolDetail)).toBeDefined();
    expect(syncService.isRunning()).toBe(true);
    expect(() => tcp.createConnection({ port: syncPort, host: '127.0.0.1' }).destroy()).not.toThrow();
  });
});
