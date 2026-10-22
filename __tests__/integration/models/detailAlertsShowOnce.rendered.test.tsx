/**
 * Alerts raised from a model's detail view show once.
 *
 * The person opens a Hugging Face model's detail on the Models screen and does something that asks
 * them a question or tells them something: delete a downloaded size, or download a size the phone has
 * no room for. They see ONE alert. One tap on its button answers it and no alert is left on screen
 * (the detail view used to mount a second copy of the screen's alert, so every alert showed twice and
 * a second one was still there after the first was answered).
 *
 * Real ModelsScreen (its one CustomAlert), TextModelsTab detail view, useTextModels, modelManager,
 * background download service, stores. Fakes only at the device boundary: the RAM sensor, the native
 * download module, the file system (and its free-space reading), and Hugging Face (fetch).
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const modelId = 'ibm-granite/granite-4.0-micro-GGUF';
const smallFile = 'granite-4.0-micro-Q4_K_M.gguf';
const bigFile = 'granite-4.0-micro-Q8_0.gguf';
const smallBytes = 1 * GB;
const bigBytes = 1.5 * GB;

type Boundary = ReturnType<typeof installNativeBoundary>;

/** Hugging Face as the app reads it for one searched model with two sizes. */
function installHuggingFace(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes(`/api/models/${modelId}?blobs=true`)
      ? { id: modelId, siblings: [{ rfilename: smallFile, size: smallBytes }, { rfilename: bigFile, size: bigBytes }] }
      : url.includes('search=granite')
        ? [{ id: modelId, author: 'ibm-granite', downloads: 1000, likes: 20, tags: ['gguf'] }]
        : [];
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

/** Search for the model and open its detail, the way the person does. */
async function openDetail(boundary: Boundary) {
  const React = require('react');
  const rtl = requireRTL();
  const { registerCoreDownloadProviders } = require('../../../src/services/modelDownloadService/registerProviders');
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  registerCoreDownloadProviders();

  const screen = rtl.render(React.createElement(ModelsScreen, {}));
  rtl.fireEvent.changeText(screen.getByTestId('search-input'), 'granite');
  rtl.fireEvent(screen.getByTestId('search-input'), 'submitEditing');
  await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-GGUF')).toBeTruthy());
  rtl.fireEvent.press(screen.getByText('granite-4.0-micro-GGUF'));
  await rtl.waitFor(() => expect(screen.getByText('granite-4.0-micro-Q8_0')).toBeTruthy());
  expect(boundary.download!.active()).toHaveLength(0);
  return { rtl, screen };
}

describe("alerts from a model's detail view", () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it('the delete question shows once, and one answer removes the size and leaves no alert', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    restoreFetch = installHuggingFace();
    // BOUNDARY: a size downloaded earlier = its file on disk + the saved record a download leaves.
    const docs = boundary.fs!.DocumentDirectoryPath;
    const smallPath = `${docs}/models/${smallFile}`;
    boundary.fs!.seedFile(smallPath, smallBytes);
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify([createDownloadedModel({
      id: `${modelId}/${smallFile}`, name: 'granite-4.0-micro-Q4_K_M', author: 'ibm-granite',
      filePath: smallPath, fileName: smallFile, fileSize: smallBytes,
    })]));
    const { rtl, screen } = await openDetail(boundary);

    // BEFORE: the downloaded size offers Delete; no alert is on screen.
    const deleteButton = await rtl.waitFor(() => screen.getByLabelText('Delete model'));
    expect(screen.queryByText('Delete Model')).toBeNull();

    rtl.fireEvent.press(deleteButton);

    // One question, with one Delete and one Cancel.
    await rtl.waitFor(() => expect(screen.getAllByText('Delete Model')).toHaveLength(1));
    expect(screen.getAllByText(/^Delete "granite-4\.0-micro-Q4_K_M"\?/)).toHaveLength(1);
    expect(screen.getAllByLabelText('Cancel')).toHaveLength(1);
    expect(screen.getAllByLabelText('Delete')).toHaveLength(1);

    // One answer: the alert is gone, and the size is deleted (it offers a download again).
    rtl.fireEvent.press(screen.getByLabelText('Delete'));
    await rtl.waitFor(() => expect(screen.queryByText('Delete Model')).toBeNull());
    await rtl.waitFor(() => expect(screen.queryByLabelText('Delete model')).toBeNull());
    expect(await boundary.fs!.exists(smallPath)).toBe(false);
    expect(screen.getByLabelText('Download granite-4.0-micro-Q4_K_M')).toBeTruthy();
    screen.unmount();
  });

  it('a refused download shows one alert, and one OK leaves no alert', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    restoreFetch = installHuggingFace();
    // The phone has 1 GB free: the 1.5 GB size cannot fit.
    boundary.fs!.setFreeBytes(1 * GB);
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { formatFileSize } = require('@offgrid/models');
    const { rtl, screen } = await openDetail(boundary);

    // BEFORE: no alert.
    expect(screen.queryByText('Download Failed')).toBeNull();

    rtl.fireEvent.press(screen.getByLabelText('Download granite-4.0-micro-Q8_0'));

    await rtl.waitFor(() => expect(screen.getAllByText('Download Failed')).toHaveLength(1));
    const message = `Not enough space. This needs ${formatFileSize(bigBytes + 500 * MB)} and your phone has ${formatFileSize(1 * GB)} free. Free up space in Settings → Storage, then try again.`;
    // The alert's one OK button.
    expect(screen.getAllByLabelText('OK')).toHaveLength(1);
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);

    rtl.fireEvent.press(screen.getByLabelText('OK'));

    // No alert left behind; the refusal stays on the size's own card, and nothing downloads.
    await rtl.waitFor(() => expect(screen.queryByText('Download Failed')).toBeNull());
    expect(screen.queryByLabelText('OK')).toBeNull();
    expect(boundary.download!.active()).toHaveLength(0);
    screen.unmount();
  });
});
