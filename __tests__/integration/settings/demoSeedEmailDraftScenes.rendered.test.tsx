/**
 * "Load demo data" adds the email-draft handoff in both capture scenes, and the demo documents open.
 *
 * SPEC (developer's view, capturing store screenshots): on a developer build I tap Load demo data in
 * Settings. In the "Acme Corp pilot" project I can open two chats for the send_email handoff:
 *  - "Pilot email draft handoff": my request to open the reply to Sam in my mail app, and the mail
 *    tool still in progress - no finished answer yet.
 *  - "Pilot email draft ready": the same request, the mail tool finished (its result says the mail app
 *    opened with a draft to Sam), and the answer that the draft is ready and no email has been sent.
 * The project's demo text documents open from the project and show their text.
 *
 * The real App over the native boundary (llama, filesystem, RAM), the real document engine over its
 * device leaves, Pro decided by a real licence through the Keygen fake. The OS alert is the dialog
 * boundary: it records what it was asked to show.
 */
import { requireRTL } from '../../harness/nativeBoundary';

// The real navigation library (jest.setup stubs useNavigation globally).
jest.unmock('@react-navigation/native');

jest.mock(
  'react-native-bootsplash',
  () => ({ hide: jest.fn(async () => {}) }),
  { virtual: true },
);

type DevGlobal = { __DEV__?: boolean };
const originalDev = (global as DevGlobal).__DEV__;

const REQUEST = 'Open the pilot reply to Sam in my mail app. I will review it before sending.';

describe('demo email-draft handoff scenes (rendered, real App)', () => {
  let mesh: import('../../harness/licensedMesh').LicensedMesh;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    mesh = require('../../harness/licensedMesh').createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await close?.();
    close = undefined;
    mesh.restore();
    (global as DevGlobal).__DEV__ = originalDev;
  });

  /** A returning developer: onboarding done, one text model on disk, a Pro licence in the Keychain. */
  async function bootDeveloperBuild() {
    const { installNativeBoundary, GB } = require('../../harness/nativeBoundary');
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    (global as DevGlobal).__DEV__ = true;
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

  it('opens the in-progress and the done email-draft chats, and a demo text document shows its text', async () => {
    const { view, rtl, dialogs } = await bootDeveloperBuild();
    const back = () => rtl.fireEvent.press(view.getAllByLabelText('Back').at(-1)!);
    const openProject = async () => {
      rtl.fireEvent.press(view.getByTestId('projects-tab'));
      rtl.fireEvent.press(await view.findByText('Acme Corp pilot'));
      await view.findByTestId('project-detail-screen');
    };

    // BEFORE: no demo project, so no email-draft chats anywhere.
    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    await view.findByTestId('projects-screen');
    expect(view.queryByText('Acme Corp pilot')).toBeNull();
    expect(view.queryByText('Pilot email draft handoff')).toBeNull();
    expect(view.queryByText('Pilot email draft ready')).toBeNull();

    // The developer taps Load demo data in Settings.
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('seed-demo-data'));
    await rtl.waitFor(() => expect(dialogs.length).toBe(1), { timeout: 15_000 });
    expect(dialogs[0].title).toBe('Demo ready');

    // Scene 1: the handoff in progress.
    await openProject();
    rtl.fireEvent.press(await view.findByText('Pilot email draft handoff'));
    await view.findByTestId('chat-screen');
    expect(await view.findByText(REQUEST)).toBeTruthy();
    // The mail tool is still running, and there is no finished answer yet.
    // It reads as the call being made, addressed to Sam with the pilot subject.
    await rtl.waitFor(() => expect(view.getByTestId('tool-call-label-send_email'))
      .toHaveTextContent(/^Using send_email: sam@acme\.example, Acme Corp pilot — 14 November/));
    expect(view.queryByTestId('tool-result-label-send_email')).toBeNull();
    expect(view.queryByText(/No email has been sent/)).toBeNull();
    expect(view.queryByText(/Mail app opened with a draft/)).toBeNull();
    back();

    // Scene 2: the handoff done.
    await view.findByTestId('project-detail-screen');
    rtl.fireEvent.press(await view.findByText('Pilot email draft ready'));
    await view.findByTestId('chat-screen');
    expect(await view.findByText(REQUEST)).toBeTruthy();
    expect(await view.findByText(/No email has been sent/)).toBeTruthy();
    expect(view.getByText(/is ready in your mail app/)).toBeTruthy();
    // The finished work folds under "Work done"; opening it shows the mail tool's finished row, and
    // its result opens to show the mail app opened with the draft.
    expect(view.queryByTestId('tool-result-label-send_email')).toBeNull();
    rtl.fireEvent.press(view.getByTestId('assistant-work-toggle'));
    await view.findByTestId('tool-result-label-send_email');
    const toolLabel = view.getByTestId('tool-result-label-send_email');
    expect(toolLabel).not.toHaveTextContent(/Using/);
    expect(view.queryByTestId('tool-call-label-send_email')).toBeNull();
    expect(view.queryByText(/Mail app opened with a draft to sam@acme\.example/)).toBeNull();
    rtl.fireEvent.press(view.getByTestId('tool-result-accordion-send_email'));
    expect(await view.findByText(/Mail app opened with a draft to sam@acme\.example/)).toBeTruthy();
    back();

    // A demo text document opens from the project and shows its text.
    await view.findByTestId('project-detail-screen');
    await rtl.waitFor(() => expect(view.getByTestId('project-knowledge-base-count')).toHaveTextContent('3'));
    expect(view.queryByText(/Sam Okafor is the customer contact at Acme Corp/)).toBeNull();
    rtl.fireEvent.press(view.getByLabelText('Knowledge document Acme pilot brief.txt'));
    expect(await view.findByText(/Sam Okafor is the customer contact at Acme Corp/)).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('document-preview-back'));
    await view.findByTestId('project-detail-screen');
    expect(view.queryByText(/Sam Okafor is the customer contact at Acme Corp/)).toBeNull();
    // The demo PDF (Acme_rollout_v3.pdf) is a real PDF; the harness's PDF reader only reads its own
    // test format, so opening it here cannot show its pages. Its content is a device check.
  }, 60_000);
});
