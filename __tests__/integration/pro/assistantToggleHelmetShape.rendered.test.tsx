/**
 * The chat's Assistant control shows the Ares helmet, and its off and on states differ by SHAPE
 * (outlined helmet vs filled helmet), not only by colour. A colour-blind user must still see
 * the switch, and a screen reader must hear the same state.
 *
 * Arrival is by real gestures: pair a Desktop on the Sync screen, select a model, open a chat,
 * tap the control. Only device boundaries are faked (native llama/fs/RAM, TCP, zeroconf, SQLite).
 * The rendered SVG (the helmet's paths and their fill/stroke) is the visible artifact asserted.
 */
import { GB, installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { LicensedMesh } from '../../harness/licensedMesh';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true, default: require('../../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true, default: require('../../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));
jest.mock('@op-engineering/op-sqlite', () =>
  require('../../harness/sqliteFake').realSqliteModule({ only: ['offgrid-sync.sqlite'] }),
);

afterEach(async () => {
  await require('../../../src/services/generationService').generationService.stopGeneration();
  await require('../../../pro').deactivate();
  await require('../../../pro/sync/stateSyncService').stateSyncService.stop();
  await require('../../../pro/sync/syncService').syncService.stop();
});

// The helmet artwork's first outline path. Present in BOTH states proves the same icon is used.
const HELMET_PATH_START = 'M9.8 3.4C13.6 1.3';

async function launch() {
  const boundary = installNativeBoundary({
    llama: true, fs: true,
    ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });
  const docs = boundary.fs!.DocumentDirectoryPath;
  const model = createDownloadedModel({
    id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: `${docs}/models/small.gguf`,
    engine: 'llama', fileSize: 500 * 1024 * 1024,
  });
  boundary.fs!.seedFile(model.filePath!, model.fileSize);
  const storage = require('@react-native-async-storage/async-storage');
  await storage.clear();
  await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
  await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
    hasCompletedOnboarding: true, checklistDismissed: true, downloadedModels: [model], devProDisabled: false,
    settings: { autoDiscoverRemoteModels: false },
  }, version: 0 }));
  const { createLicensedMesh, installLicensedPhone, registerThisPhone } = require('../../harness/licensedMesh');
  const mesh: LicensedMesh = createLicensedMesh();
  mesh.reset();
  installLicensedPhone(mesh);
  await registerThisPhone(mesh, { name: 'This phone', platform: 'android' });
  const React = require('react');
  const rtl = requireRTL();
  const { useAppStore, useChatStore, useProjectStore, useRemoteServerStore } = require('../../../src/stores');
  await Promise.all([useAppStore.persist.rehydrate(), useChatStore.persist.rehydrate(), useProjectStore.persist.rehydrate(), useRemoteServerStore.persist.rehydrate()]);
  await require('../../harness/proHarness').installPro();
  const AppRoot = require('../../../App').default;
  const view = rtl.render(React.createElement(AppRoot));
  await view.findByTestId('home-screen');
  return { view, rtl, mesh };
}

type Paint = 'none' | number;
const paintOf = (value: { payload: number } | null | undefined): Paint => (value == null ? 'none' : value.payload);

/**
 * The helmet the native SVG renderer paints inside the Assistant control: the drawn paths and the
 * fill/stroke each one is painted with. A native RNSVGPath only uses its own fill/stroke when the
 * prop is in its propList; otherwise it inherits the paint of the enclosing RNSVGGroup.
 */
function helmetOnScreen(view: any) {
  const toggle = view.getByTestId('assistant-toggle');
  const group = toggle.find((node: any) => node.type === 'RNSVGGroup');
  const paths = toggle.findAll((node: any) => node.type === 'RNSVGPath');
  const painted: Array<{ d: string; fill: Paint; stroke: Paint }> = paths.map((path: any) => {
    const own: string[] = path.props.propList ?? [];
    return {
      d: path.props.d as string,
      fill: paintOf(own.includes('fill') ? path.props.fill : group.props.fill),
      stroke: paintOf(own.includes('stroke') ? path.props.stroke : group.props.stroke),
    };
  });
  return {
    drawsHelmet: painted.some(p => p.d.startsWith(HELMET_PATH_START)),
    fills: [...new Set(painted.map(p => p.fill))],
    strokes: [...new Set(painted.map(p => p.stroke))],
  };
}

it('the Assistant control shows the helmet outlined when off and filled when on, with a matching a11y state', async () => {
  const { view, rtl, mesh } = await launch();
  const { syncService } = require('../../../pro/sync/syncService');
  const { buildSyncEngine } = require('../../../src/services/sync/engine');
  const tcp = require('react-native-tcp-socket').default;
  const { getDiscoveryBoundaries } = require('../../utils/nativeSyncBoundaries');
  const { pairingCodeOnScreen } = require('../../utils/pairFromPeer');
  const device = { id: 'ares-desktop', name: 'Studio Desktop', platform: 'macos', version: '1', host: '127.0.0.1', port: 0 };
  const peer = buildSyncEngine({
    localDevice: device, tcpModule: tcp,
    pairingEntitlement: mesh.joiner({ name: device.name, platform: device.platform }),
  });
  try {
    await peer.engine.start(0);
    device.port = peer.transport.boundPort;
    await rtl.act(async () => { await syncService.start(); });
    // Pair the Desktop from the phone's Sync screen.
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    const code = await pairingCodeOnScreen(view);
    const { useSyncStore } = require('../../../pro/sync/syncStore');
    const phone = useSyncStore.getState().thisDevice;
    await rtl.act(async () => {
      await peer.engine.pair({ ...phone, host: '127.0.0.1', port: getDiscoveryBoundaries().at(-1).publishedPort }, code);
    });
    expect(await view.findByTestId(`sync-paired-${device.id}`)).toBeTruthy();
    // The Desktop advertises it can run Assistant tasks (device-to-device wire message).
    await rtl.act(async () => {
      peer.engine.sendApp(phone.id, 'mcp-task-capability', {
        version: 1, executionDevice: { id: device.id, name: device.name }, remoteTasksAllowed: true,
        tools: [{ name: 'web_use', description: 'Use the browser', inputSchema: { type: 'object', properties: {} } }],
      });
    });
    // Pick a model and open a chat.
    rtl.fireEvent.press(view.getByLabelText('Back'));
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
    await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());
    rtl.fireEvent.press(view.getByTestId('new-chat-button'));
    await view.findByTestId('chat-input');

    // BEFORE: off. Helmet drawn as an outline (no fill, a stroke), and announced not selected.
    expect(view.getByRole('button', { name: 'Assistant', selected: false })).toBeTruthy();
    const off = helmetOnScreen(view);
    expect(off.drawsHelmet).toBe(true);
    expect(off.fills).toEqual(['none']);
    expect(off.strokes).toHaveLength(1);
    expect(off.strokes[0]).not.toBe('none');

    // Tap ON. Same helmet, now a solid shape (filled, no outline), announced selected.
    rtl.fireEvent.press(view.getByTestId('assistant-toggle'));
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Assistant', selected: true, busy: false })).toBeTruthy());
    const on = helmetOnScreen(view);
    expect(on.drawsHelmet).toBe(true);
    expect(on.strokes).toEqual(['none']);
    expect(on.fills).toHaveLength(1);
    expect(on.fills[0]).not.toBe('none');

    // Tap OFF again. Back to the same outlined helmet, announced not selected.
    rtl.fireEvent.press(view.getByTestId('assistant-toggle'));
    await rtl.waitFor(() => expect(view.getByRole('button', { name: 'Assistant', selected: false, busy: false })).toBeTruthy());
    expect(helmetOnScreen(view)).toEqual(off);
  } finally {
    view.unmount();
    await peer.engine.stop();
    await syncService.stop();
    await require('../../../pro').deactivate();
    mesh.restore();
  }
});
