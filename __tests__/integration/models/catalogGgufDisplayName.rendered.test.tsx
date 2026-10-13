/**
 * A catalog GGUF model is named by its catalog name everywhere the person sees it, never by the
 * Hugging Face repo id it was downloaded from.
 *
 * Product-correct outcome (the person's view): they open Models, tap the recommended "MiniCPM5 2B"
 * card, download its Q4_K_M file, and from then on the phone calls it "MiniCPM5 2B": in the text-model
 * picker on Home, in the chat they start with it, and in Home's Models sheet. The repo id
 * ("openbmb/MiniCPM5-2B-GGUF") and its basename ("MiniCPM5-2B-GGUF") are plumbing and never show,
 * including in Downloads (which lists the file by its file name). A row an older version saved under
 * the repo basename is renamed when the app opens.
 *
 * Entry point: the REAL AppNavigator inside a REAL NavigationContainer (the full App for the relaunch
 * case). Every step is a gesture: skip Auto Setup, open the Models tab, tap the card, tap Download,
 * open Downloads, go Home, open the picker, close it, tap New Chat, go Back, open the Models sheet.
 *
 * Fakes (device boundary only): the Hugging Face HTTP API (fetch), the native background-download
 * module (it reports completion; the file lands on the in-memory disk), the filesystem, the RAM
 * sensor and llama.rn. Everything we own — the screens, the download owner, buildDownloadedModel,
 * the stores, the picker, the chat screen — runs for real.
 */
import {
  installNativeBoundary,
  requireRTL,
  GB,
  MB,
  type NativeBoundary,
} from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });

const REPO_ID = 'openbmb/MiniCPM5-2B-GGUF';
const REPO_BASENAME = 'MiniCPM5-2B-GGUF';
const CATALOG_NAME = 'MiniCPM5 2B';
const FILE_NAME = 'MiniCPM5-2B-Q4_K_M.gguf';
const FILE_SIZE = 1200 * MB;
const RENDER_WAIT = { timeout: 8000 };

/** The Hugging Face API as the phone sees it: one catalog repo with a Q4_K_M file, every other repo
 *  without GGUF files. The fake answers by path only; it decides nothing about names. */
function installHuggingFace(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url.hostname !== 'huggingface.co') return json({}, 404);
    const treeMatch = url.pathname.match(/^\/api\/models\/(.+)\/tree\/[^/]+$/);
    if (treeMatch) {
      const id = decodeURIComponent(treeMatch[1]);
      return json(
        id === REPO_ID
          ? [{ type: 'file', path: FILE_NAME, size: FILE_SIZE, lfs: { size: FILE_SIZE } }]
          : [],
      );
    }
    if (url.pathname === '/api/models') return json([]);
    if (url.pathname.startsWith('/api/models/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      return json({ id, author: id.split('/')[0], downloads: 1, likes: 0, tags: ['gguf'], siblings: [] });
    }
    return json({}, 404);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/** The native downloader finishing: the bytes are on disk and the module reports completion. */
async function completeNativeDownload(
  boundary: NativeBoundary,
  act: (cb: () => Promise<void>) => Promise<void>,
) {
  const row = boundary.download!.active()[0];
  const localUri = `${boundary.fs!.DocumentDirectoryPath}/models/${FILE_NAME}`;
  await act(async () => {
    boundary.fs!.seedFile(localUri, FILE_SIZE);
    boundary.download!.events.emit('DownloadComplete', {
      downloadId: row.downloadId,
      fileName: row.fileName,
      modelId: row.modelId,
      bytesDownloaded: FILE_SIZE,
      totalBytes: FILE_SIZE,
      status: 'completed',
      localUri,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function expectNoRepoId(view: { queryAllByText: (m: RegExp) => unknown[] }) {
  expect(view.queryAllByText(new RegExp(REPO_BASENAME))).toHaveLength(0);
}

describe('catalog GGUF model names', () => {
  it('shows the catalog name, not the repo id, in the picker, the chat and the Models sheet', async () => {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      llama: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const restoreFetch = installHuggingFace();
    try {
      const React = require('react');
      const { render, fireEvent, waitFor, within, act } = requireRTL();
      const { NavigationContainer } = require('@react-navigation/native');
      const { AppNavigator } = require('../../../src/navigation/AppNavigator');
      const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
      const { useAppStore } = require('../../../src/stores');
      registerCoreDownloadProviders();

      // Boot state of a returning person who finished onboarding and dismissed the tour, with no
      // model on the phone yet. Not the state under test.
      useAppStore.getState().setOnboardingComplete(true);
      useAppStore.getState().dismissChecklist();

      const ui = render(
        React.createElement(NavigationContainer, null, React.createElement(AppNavigator)),
      );

      // No model yet: Auto Setup. Skip it to land in the app. Home has no model to name yet.
      fireEvent.press(await waitFor(() => ui.getByTestId('auto-setup-skip'), RENDER_WAIT));
      await waitFor(() => expect(ui.getByTestId('setup-card')).toBeTruthy(), RENDER_WAIT);
      expect(ui.queryByTestId('new-chat-button')).toBeNull();
      fireEvent.press(await waitFor(() => ui.getByTestId('models-tab'), RENDER_WAIT));

      // The recommended card carries the catalog name.
      const card = await waitFor(() => ui.getByLabelText(CATALOG_NAME), RENDER_WAIT);
      fireEvent.press(within(card).getByText(CATALOG_NAME));
      fireEvent.press(await waitFor(() => ui.getByTestId('file-card-0-download'), RENDER_WAIT));
      await waitFor(() => expect(boundary.download!.active()).toHaveLength(1), RENDER_WAIT);
      await completeNativeDownload(boundary, act);
      await waitFor(() => expect(ui.getByTestId('file-card-0-delete')).toBeTruthy(), RENDER_WAIT);

      // Downloads lists the stored file under its own name, and no repo id leaks in beside it.
      fireEvent.press(ui.getByTestId('downloads-icon'));
      const downloads = await waitFor(() => ui.getByTestId('downloaded-models-screen'), RENDER_WAIT);
      await waitFor(() => expect(within(downloads).getByText(FILE_NAME)).toBeTruthy(), RENDER_WAIT);
      expectNoRepoId(within(downloads));
      fireEvent.press(within(downloads).getByTestId('back-button'));

      // The finished download is the chosen text model. Its row in the Home text-model picker.
      fireEvent.press(await waitFor(() => ui.getByTestId('home-tab'), RENDER_WAIT));
      await waitFor(() => expect(ui.getByTestId('new-chat-button')).toBeTruthy(), RENDER_WAIT);
      fireEvent.press(ui.getByTestId('model-summary-text-open'));
      const row = await waitFor(() => {
        const rows = ui.queryAllByTestId(/^text-model-row-/);
        expect(rows).toHaveLength(1);
        return rows[0];
      }, RENDER_WAIT);
      expect(within(row).getByText(CATALOG_NAME)).toBeTruthy();
      expectNoRepoId(within(row));
      fireEvent.press(ui.getByTestId('app-sheet-close'));
      await waitFor(() => expect(ui.queryAllByTestId(/^text-model-row-/)).toHaveLength(0), RENDER_WAIT);

      // The chat started with it.
      fireEvent.press(await waitFor(() => ui.getByTestId('new-chat-button'), RENDER_WAIT));
      await waitFor(
        () => expect(ui.getByText(new RegExp(`begin chatting with ${CATALOG_NAME}`))).toBeTruthy(),
        RENDER_WAIT,
      );
      expectNoRepoId(ui);

      // Back on Home, the Models sheet names the active text model the same way.
      fireEvent.press(ui.getByLabelText('Back'));
      fireEvent.press(await waitFor(() => ui.getByTestId('models-summary'), RENDER_WAIT));
      const textRow = await waitFor(() => ui.getByTestId('models-row-text'), RENDER_WAIT);
      expect(within(textRow).getByText(CATALOG_NAME)).toBeTruthy();
      expectNoRepoId(within(textRow));
      ui.unmount();
    } finally {
      restoreFetch();
    }
  });

  it('renames a model an older version saved under its repo id when the app opens', async () => {
    const boundary = installNativeBoundary({
      fs: true,
      llama: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    const restoreFetch = installHuggingFace();
    try {
      const React = require('react');
      const { render, fireEvent, waitFor, within } = requireRTL();
      const AsyncStorage =
        require('@react-native-async-storage/async-storage').default ??
        require('@react-native-async-storage/async-storage');
      await AsyncStorage.clear();

      // What an older version left on the phone: the file on disk, and its saved row whose name was
      // derived from the repo basename. The app's own preferences say onboarding is done and this
      // model is the chosen one. All of it is storage the app reads at launch.
      const filePath = `${boundary.fs!.DocumentDirectoryPath}/models/${FILE_NAME}`;
      boundary.fs!.seedFile(filePath, FILE_SIZE);
      const modelId = `${REPO_ID}/${FILE_NAME}`;
      await AsyncStorage.setItem(
        '@local_llm/downloaded_models',
        JSON.stringify([
          {
            id: modelId,
            name: REPO_BASENAME,
            author: 'openbmb',
            filePath,
            fileName: FILE_NAME,
            fileSize: FILE_SIZE,
            quantization: 'Q4_K_M',
            downloadedAt: '2026-09-01T10:00:00.000Z',
            credibility: { source: 'community', isOfficial: false, isVerifiedQuantizer: false },
            isVisionModel: false,
          },
        ]),
      );
      await AsyncStorage.setItem(
        'local-llm-app-storage',
        JSON.stringify({
          state: { hasCompletedOnboarding: true, checklistDismissed: true, activeModelId: modelId },
          version: 0,
        }),
      );

      const App = require('../../../App').default;
      const ui = render(React.createElement(App));
      // The app is still opening: nothing names the model yet.
      expect(ui.getByTestId('app-loading')).toBeTruthy();
      expect(ui.queryByText(CATALOG_NAME)).toBeNull();

      await waitFor(() => expect(ui.queryByTestId('app-loading')).toBeNull(), RENDER_WAIT);
      fireEvent.press(await waitFor(() => ui.getByTestId('model-summary-text-open'), RENDER_WAIT));
      const row = await waitFor(() => {
        const rows = ui.queryAllByTestId(/^text-model-row-/);
        expect(rows).toHaveLength(1);
        return rows[0];
      }, RENDER_WAIT);
      expect(within(row).getByText(CATALOG_NAME)).toBeTruthy();
      expectNoRepoId(ui);
      fireEvent.press(ui.getByTestId('app-sheet-close'));

      fireEvent.press(await waitFor(() => ui.getByTestId('new-chat-button'), RENDER_WAIT));
      await waitFor(
        () => expect(ui.getByText(new RegExp(`begin chatting with ${CATALOG_NAME}`))).toBeTruthy(),
        RENDER_WAIT,
      );
      expectNoRepoId(ui);
      ui.unmount();
    } finally {
      restoreFetch();
    }
  });
});
