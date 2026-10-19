/**
 * Developer tooling never reaches a release build.
 *
 * SPEC (OGAM user's view): someone running the shipped app (a release build, __DEV__ = false)
 * never sees the developer sync strip pinned to the bottom of the screen, and the Settings
 * screen offers no "Load demo data" button and no "Show sync status bar" switch. A developer
 * build (__DEV__ = true) shows all three.
 *
 * The sync strip's visibility preference DEFAULTS TO ON, so the release gate is the only thing
 * keeping it off a user's screen. Both sides run the REAL App over the native boundary, as a
 * returning user whose persisted state (onboarding done) is already on disk, then tap the real
 * Settings tab.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

// The real navigation library (jest.setup stubs useNavigation globally).
jest.unmock('@react-navigation/native');

jest.mock(
  'react-native-bootsplash',
  () => ({ hide: jest.fn(async () => {}) }),
  { virtual: true },
);

type DevGlobal = { __DEV__?: boolean };
const originalDev = (global as DevGlobal).__DEV__;

afterEach(() => {
  (global as DevGlobal).__DEV__ = originalDev;
});

async function bootReturningUser(isDev: boolean) {
  installNativeBoundary();
  (global as DevGlobal).__DEV__ = isDev;

  const React = require('react');
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  // Device disk: a returning user who finished onboarding on an earlier launch.
  await AsyncStorage.setItem(
    'local-llm-app-storage',
    JSON.stringify({ state: { hasCompletedOnboarding: true }, version: 0 }),
  );

  const App = require('../../../App').default;
  const view = rtl.render(React.createElement(App));
  await rtl.waitFor(() => expect(view.queryByTestId('app-loading')).toBeNull(), {
    timeout: process.env.CI === 'true' ? 45_000 : 10_000,
  });
  // With no model on disk the app offers setup first; the user skips it to reach the main tabs.
  await rtl.waitFor(() => expect(view.getByTestId('auto-setup-skip')).toBeTruthy());
  rtl.fireEvent.press(view.getByTestId('auto-setup-skip'));
  await rtl.waitFor(() => expect(view.getByTestId('settings-tab')).toBeTruthy());
  return { view, rtl };
}

describe('developer tooling release gate (rendered, real App)', () => {
  it('a release build shows no sync strip and no demo-data or sync-strip controls in Settings', async () => {
    const { view, rtl } = await bootReturningUser(false);

    // BEFORE the Settings tap: the user is on Home, the Settings screen is not yet shown.
    expect(view.queryByText('Privacy First')).toBeNull();
    expect(view.queryByTestId('dev-sync-strip')).toBeNull();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() => expect(view.getByText('Privacy First')).toBeTruthy());

    expect(view.queryByTestId('seed-demo-data')).toBeNull();
    expect(view.queryByText('Load demo data')).toBeNull();
    expect(view.queryByLabelText('Show sync status bar')).toBeNull();
    expect(view.queryByText('Show sync status bar')).toBeNull();
    expect(view.queryByText('Reset Onboarding')).toBeNull();
    expect(view.queryByTestId('dev-sync-strip')).toBeNull();

    view.unmount();
  });

  it('a developer build shows the sync strip and both developer controls in Settings', async () => {
    const { view, rtl } = await bootReturningUser(true);

    expect(view.queryByText('Privacy First')).toBeNull();
    expect(view.getByTestId('dev-sync-strip')).toBeTruthy();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() => expect(view.getByText('Privacy First')).toBeTruthy());

    expect(view.getByTestId('seed-demo-data')).toBeTruthy();
    expect(view.getByText('Load demo data')).toBeTruthy();
    expect(view.getByLabelText('Show sync status bar')).toBeTruthy();

    // The switch really drives the strip: turning it off removes the strip from the screen.
    await rtl.act(async () => {
      rtl.fireEvent(view.getByLabelText('Show sync status bar'), 'valueChange', false);
    });
    await rtl.waitFor(() => expect(view.queryByTestId('dev-sync-strip')).toBeNull());

    view.unmount();
  });
});

/**
 * "Load demo data" in a developer build fills the app with the Acme pilot fixture.
 *
 * SPEC (developer's view): on a developer build with a text model and a paired Mac, I tap Load demo
 * data in Settings. The app says the demo is ready and how many chats and documents it added. The
 * Projects tab now has the "Acme Corp pilot" project with those chats and documents, and the Sync
 * activity for my paired Mac shows two Desktop transfers: one still receiving, one received. The
 * project's chat titles use the theme's text colour, in dark mode too.
 *
 * The real App with Pro decided by a real licence (the Keygen fake at the HTTP boundary). The Mac is a
 * real shared sync engine over the in-memory LAN that pairs by the code this phone shows. The
 * knowledge base runs the real document engine over its device leaves (SQLite, PDF reader, embedding
 * model). The OS alert is the dialog boundary: it records what it was asked to show.
 */
describe('Load demo data in a developer build (rendered, real App)', () => {
  const ALEX_MAC = { id: 'alex-mac', name: "Alex's Mac", platform: 'macos' };
  let mesh: import('../../harness/licensedMesh').LicensedMesh;
  let peer: { stop: () => Promise<void>; pairWithPhone: (view: unknown) => Promise<string> } | undefined;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    mesh = require('../../harness/licensedMesh').createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await peer?.stop();
    peer = undefined;
    await close?.();
    close = undefined;
    mesh.restore();
  });

  /** A returning developer: onboarding done, one text model on disk, a Pro licence in the Keychain. */
  async function bootDeveloperBuild() {
    // Required fresh: this journey's app graph is loaded after its own module reset.
    const { installNativeBoundary: installFreshBoundary, GB } = require('../../harness/nativeBoundary');
    const boundary = installFreshBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    (global as DevGlobal).__DEV__ = true;
    // The LAN: the sockets and discovery a paired Mac reaches this phone over.
    const lan = require('../../utils/nativeSyncBoundaries');
    jest.doMock('react-native-tcp-socket', () => ({ __esModule: true, default: lan.createNativeTcpBoundary() }));
    jest.doMock('react-native-zeroconf', () => ({ __esModule: true, default: lan.createNativeDiscoveryBoundary() }));
    require('../../harness/documentEngine').installDocumentEngine(boundary.fs!, { llama: boundary.llama!.module });

    const docs = boundary.fs!.DocumentDirectoryPath;
    const model = require('../../utils/factories').createDownloadedModel({
      id: 'm', name: 'Test Model', fileName: 'small.gguf', filePath: `${docs}/models/small.gguf`,
      engine: 'llama', fileSize: 500 * 1024 * 1024,
    });
    boundary.fs!.seedFile(model.filePath, model.fileSize);
    const storageModule = require('@react-native-async-storage/async-storage');
    const storage = storageModule.default ?? storageModule;
    await storage.clear();
    await storage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
    await storage.setItem('local-llm-app-storage', JSON.stringify({ state: {
      hasCompletedOnboarding: true, checklistDismissed: true, downloadedModels: [model],
      devProDisabled: true, settings: { autoDiscoverRemoteModels: false },
    }, version: 0 }));
    const { installLicensedPhone, registerThisPhone } = require('../../harness/licensedMesh');
    installLicensedPhone(mesh, { secrets: new Map<string, string>() });
    await registerThisPhone(mesh, { name: 'This phone', platform: 'android' });

    // The OS alert: keep what it was asked to show, as the person reads it.
    const dialogs: Array<{ title: string; message?: string }> = [];
    require('react-native').Alert.alert = (title: string, message?: string) => {
      dialogs.push({ title, message });
    };

    const React = require('react');
    const rtl = requireRTL();
    const App = require('../../../App').default;
    const view = rtl.render(React.createElement(App));
    await view.findByTestId('home-screen', {}, { timeout: 10_000 });
    close = async () => {
      view.unmount();
      await require('../../../pro').deactivate();
      await require('../../../pro/sync/stateSyncService').stateSyncService.stop();
      await require('../../../pro/sync/syncService').syncService.stop();
    };
    return { view, rtl, dialogs };
  }

  it('adds the demo project with its chats and documents, and two Desktop transfers under the paired Mac', async () => {
    const { view, rtl, dialogs } = await bootDeveloperBuild();
    const back = () => rtl.fireEvent.press(view.getAllByLabelText('Back').at(-1)!);

    // BEFORE: no demo project.
    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    await view.findByTestId('projects-screen');
    expect(view.queryByText('Acme Corp pilot')).toBeNull();

    // Pair Alex's Mac by the code the Sync screen shows.
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    await view.findByTestId('sync-pairing-code-value');
    const { startPairedPeer } = require('../../harness/proHarness');
    // A Desktop accepts the knowledge documents the phone shares with it.
    peer = await startPairedPeer({ mesh, device: ALEX_MAC, acceptFiles: true });
    await peer!.pairWithPhone(view);

    // BEFORE: the Mac has sent nothing yet.
    rtl.fireEvent.press(view.getByTestId('sync-open-activity'));
    expect(await view.findByText('No sync activity yet.')).toBeTruthy();
    expect(view.queryByText('Acme_rollout_v3.pdf')).toBeNull();
    back();
    await view.findByTestId('sync-open-activity');
    back();

    // The developer taps Load demo data.
    rtl.fireEvent.press(await view.findByTestId('seed-demo-data'));
    await rtl.waitFor(() => expect(dialogs.length).toBe(1), { timeout: 15_000 });
    expect(dialogs[0].title).toBe('Demo ready');
    const added = /^(\d+) chats and (\d+) documents added\./.exec(dialogs[0].message ?? '');
    expect(added).not.toBeNull();
    const [chats, documents] = [Number(added![1]), Number(added![2])];
    expect(chats).toBeGreaterThan(0);
    expect(documents).toBe(3);

    // The project is on the Projects tab, with the chats and documents the app said it added.
    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    rtl.fireEvent.press(await view.findByText('Acme Corp pilot'));
    await view.findByTestId('project-detail-screen');
    expect(await view.findByText(String(chats))).toBeTruthy();
    await rtl.waitFor(() => expect(view.getByTestId('project-knowledge-base-count')).toHaveTextContent(String(documents)));
    expect(view.getByLabelText('Knowledge document Promises to Sam.txt')).toBeTruthy();
    expect(view.getByLabelText('Knowledge document Acme pilot brief.txt')).toBeTruthy();
    expect(view.getByLabelText('Knowledge document Acme_rollout_v3.pdf')).toBeTruthy();
    // The chats are the demo's own conversations, newest first.
    expect(view.getByText('Pilot email draft ready')).toBeTruthy();
    expect(view.getByText('Pilot seat-days result')).toBeTruthy();
    // Every document reached the paired Mac: none says it could not sync.
    expect(view.queryByText(/Couldn't sync to/)).toBeNull();

    // The chat titles use the theme's text colour, in light and, after switching, in dark.
    const { getTheme } = require('../../../src/theme');
    const { StyleSheet } = require('react-native');
    const titleColour = (title: string) => StyleSheet.flatten(view.getByText(title).props.style).color;
    expect(titleColour('Pilot email draft ready')).toBe(getTheme('light').colors.text);
    back();
    rtl.fireEvent.press(await view.findByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('theme-option-dark'));
    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    rtl.fireEvent.press(await view.findByText('Acme Corp pilot'));
    await view.findByTestId('project-detail-screen');
    await rtl.waitFor(() => expect(titleColour('Pilot email draft ready')).toBe(getTheme('dark').colors.text));
    expect(titleColour('Pilot seat-days result')).toBe(getTheme('dark').colors.text);
    expect(getTheme('dark').colors.text).not.toBe(getTheme('light').colors.text);
    // So does the New Project header.
    back();
    rtl.fireEvent.press(await view.findByTestId('new-project-button'));
    await rtl.waitFor(() => expect(titleColour('New Project')).toBe(getTheme('dark').colors.text));
    rtl.fireEvent.press(view.getByTestId('project-edit-cancel'));

    // Two Desktop transfers, listed under the paired Mac.
    rtl.fireEvent.press(await view.findByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    rtl.fireEvent.press(await view.findByTestId('sync-open-activity'));
    rtl.fireEvent.press(await view.findByTestId('sync-activity-open-filters'));
    rtl.fireEvent.press(await view.findByTestId(`sync-activity-origin-${ALEX_MAC.id}`));
    expect(view.getByTestId(`sync-activity-origin-${ALEX_MAC.id}`)).toHaveTextContent("Alex's Mac 2");
    await rtl.waitFor(() => expect(view.getByText('Acme_rollout_v3.pdf')).toBeTruthy());
    expect(view.getByText('Pilot_scope.docx')).toBeTruthy();
    expect(view.getByText(/^Receiving/)).toBeTruthy();
    expect(view.getByText(/^Received/)).toBeTruthy();
    expect(view.getAllByText("From Alex's Mac")).toHaveLength(2);
  }, 60_000);
});

