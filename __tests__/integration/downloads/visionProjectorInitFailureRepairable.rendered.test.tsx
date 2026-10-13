/**
 * A vision model whose projector (mmproj) fails to start stays a vision model the person can repair.
 *
 * Product-correct outcome (the person's view): Gemma 4 E2B is on the phone. Its projector file is in
 * the models folder but was never linked to it, so Downloads lists it as a plain text model. The
 * person chats with it; loading it finds the projector beside the weights, but the projector does not
 * start on this device. Afterwards the phone must not pretend the model can see, and must not forget
 * that it is a vision model: Downloads now shows it as a vision model with the repair wrench, the chat's
 * Photo action says the vision file is missing and leads to Downloads, and the wrench repairs it.
 *
 * Entry point: the REAL App (boot, NavigationContainer, AppNavigator). Every step is a gesture: open
 * Models → Downloads, go back, New Chat, type and send, Photo, "Go to Download Manager", the wrench.
 *
 * Fakes (device boundary only): the in-memory filesystem (the weights and, after launch, the projector
 * file), AsyncStorage (what an earlier run saved), the RAM sensor, and llama.rn. The llama.rn fake's
 * context answers initMultimodal with false and getMultimodalSupport with { vision: false }: the native
 * projector init failing. Everything we own runs, including modelManager.clearMmProjLink.
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const MODEL_FILE = 'gemma-4-E2B-it-Q4_K_M.gguf';
const PROJECTOR_FILE = 'gemma-4-E2B-it-mmproj-F16.gguf';
const MODEL_ID = `unsloth/gemma-4-E2B-it-GGUF/${MODEL_FILE}`;
const RENDER_WAIT = { timeout: 8000 };

/**
 * Where the projector comes from before the failing load:
 *  - 'folder scan': the file lands beside the weights after the app opened, so the load itself finds
 *    and links it (the case 365036dce fixed: a link the load just made was never cleared).
 *  - 'saved link': the file was already there at launch, so the app linked it on opening and the load
 *    uses that saved link.
 */
type ProjectorArrival = 'folder scan' | 'saved link';

describe('vision projector that fails to start', () => {
  it.each<ProjectorArrival>(['folder scan', 'saved link'])('%s: keeps the model a vision model with the repair wrench, and the wrench repairs it', async arrival => {
    const boundary = installNativeBoundary({
      llama: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const React = require('react');
    const { render, fireEvent, waitFor, within, act } = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    // What an earlier run left: the weights on disk and their saved row, with no projector linked.
    const modelsDir = `${boundary.fs!.DocumentDirectoryPath}/models`;
    const modelPath = `${modelsDir}/${MODEL_FILE}`;
    boundary.fs!.seedFile(modelPath, 3100 * MB);
    const projectorPath = `${modelsDir}/${PROJECTOR_FILE}`;
    if (arrival === 'saved link') boundary.fs!.seedFile(projectorPath, 940 * MB);
    await AsyncStorage.setItem(
      '@local_llm/downloaded_models',
      JSON.stringify([
        {
          id: MODEL_ID,
          name: 'Gemma 4 E2B',
          author: 'unsloth',
          filePath: modelPath,
          fileName: MODEL_FILE,
          fileSize: 3100 * MB,
          quantization: 'Q4_K_M',
          downloadedAt: '2026-09-20T09:00:00.000Z',
          credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
          engine: 'llama',
          isVisionModel: false,
        },
      ]),
    );
    await AsyncStorage.setItem(
      'local-llm-app-storage',
      JSON.stringify({
        state: { hasCompletedOnboarding: true, checklistDismissed: true, activeModelId: MODEL_ID },
        version: 0,
      }),
    );

    const App = require('../../../App').default;
    const ui = render(React.createElement(App));
    await waitFor(() => expect(ui.queryByTestId('app-loading')).toBeNull(), RENDER_WAIT);

    const openDownloads = async () => {
      fireEvent.press(await waitFor(() => ui.getByTestId('models-tab'), RENDER_WAIT));
      fireEvent.press(await waitFor(() => ui.getByTestId('downloads-icon'), RENDER_WAIT));
      return waitFor(() => ui.getByTestId('downloaded-models-screen'), RENDER_WAIT);
    };
    // The repair wrench is the card's pressable "tool" icon. The completed-download card passes no
    // testID to ModelCard, so its action buttons have none (items.tsx); the same glyph also marks the
    // "Tool calling" capability badge, so a wrench is a "tool" icon that is not inside that badge.
    type Node = { props: Record<string, unknown>; parent: Node | null };
    const wrenches = (scope: { UNSAFE_queryAllByProps: (p: { [x: string]: unknown }) => unknown[] }) =>
      (scope.UNSAFE_queryAllByProps({ name: 'tool' }) as Node[]).filter(icon => {
        for (let n: Node | null = icon.parent; n; n = n.parent) {
          if (/Tool calling/.test(String(n.props.accessibilityLabel ?? ''))) return false;
        }
        return true;
      });

    // BEFORE: no repair wrench. Unlinked, it is listed as a text model; linked at launch, it is
    // listed as a vision model that looks ready.
    let downloads = await openDownloads();
    await waitFor(() => expect(within(downloads).getByText(MODEL_FILE)).toBeTruthy(), RENDER_WAIT);
    if (arrival === 'folder scan') {
      expect(within(downloads).getByText(/Q4_K_M · Text$/)).toBeTruthy();
      expect(within(downloads).queryByLabelText('Vision')).toBeNull();
    } else {
      await waitFor(() => expect(within(downloads).getByLabelText('Vision')).toBeTruthy(), RENDER_WAIT);
    }
    expect(wrenches(within(downloads))).toHaveLength(0);
    fireEvent.press(within(downloads).getByTestId('back-button'));

    // Folder scan: the projector file lands beside the weights after the app opened.
    if (arrival === 'folder scan') boundary.fs!.seedFile(projectorPath, 940 * MB);

    // Chat with it: the first message loads the model. The native projector init fails.
    fireEvent.press(await waitFor(() => ui.getByTestId('home-tab'), RENDER_WAIT));
    fireEvent.press(await waitFor(() => ui.getByTestId('new-chat-button'), RENDER_WAIT));
    boundary.llama!.scriptCompletion({ text: 'Hello there.' });
    fireEvent.changeText(await waitFor(() => ui.getByTestId('chat-input'), RENDER_WAIT), 'hi');
    fireEvent.press(await waitFor(() => ui.getByTestId('send-button'), RENDER_WAIT));
    await waitFor(() => expect(ui.getByText(/Hello there\./)).toBeTruthy(), RENDER_WAIT);

    // The chat's Photo action says the vision file is missing and leads to Downloads.
    fireEvent.press(ui.getByTestId('attach-button'));
    fireEvent.press(await waitFor(() => ui.getByTestId('attach-photo'), RENDER_WAIT));
    await waitFor(() => expect(ui.getByText('Vision File Missing')).toBeTruthy(), RENDER_WAIT);
    expect(ui.queryByText('Vision Not Supported')).toBeNull();
    fireEvent.press(ui.getByText('Go to Download Manager'));

    // AFTER: Downloads shows it as a vision model, with the repair wrench.
    downloads = await waitFor(() => ui.getByTestId('downloaded-models-screen'), RENDER_WAIT);
    await waitFor(() => expect(within(downloads).getByLabelText('Vision')).toBeTruthy(), RENDER_WAIT);
    expect(within(downloads).queryByText(/Q4_K_M · Text$/)).toBeNull();
    expect(wrenches(within(downloads))).toHaveLength(1);

    // The wrench repairs it from the projector already on the phone.
    await act(async () => {
      fireEvent.press(wrenches(within(downloads))[0] as never);
    });
    await waitFor(() => expect(ui.getByText('Vision Repaired')).toBeTruthy(), RENDER_WAIT);
    expect(ui.getByText(/already had its vision file on this device/)).toBeTruthy();
    ui.unmount();
  });
});
