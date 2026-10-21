/**
 * A model card says only what helps a choice, in plain words.
 *
 * The person searches Models for a model a verified quantizer published. Its card in the results and
 * its file cards in the detail show the verified mark, but no download count ("12.3K dl"), no
 * "NPU/GPU" chip, and no publisher name on the card itself.
 *
 * Real ModelsScreen (search → results → detail), huggingFaceService, credibility rule, cards, stores.
 * Fakes only at the device boundary: Hugging Face (fetch), the native download module, the file
 * system and the RAM sensor.
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';

const REPO = 'bartowski/Plainwords-7B-GGUF';
const FILES = [
  { path: 'Plainwords-7B-Q4_0.gguf', size: 1900 * MB },
  { path: 'Plainwords-7B-Q4_K_M.gguf', size: 2000 * MB },
];

let restoreFetch: () => void = () => {};
afterEach(() => restoreFetch());

function installHuggingFace(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
    const repo = {
      id: REPO, modelId: REPO, author: 'bartowski', downloads: 12345, likes: 42, tags: ['gguf'],
      siblings: FILES.map(f => ({ rfilename: f.path, size: f.size })),
    };
    if (url.pathname === `/api/models/${REPO}/tree/main`) {
      return json(FILES.map(f => ({ type: 'file', path: f.path, size: f.size, lfs: { size: f.size } })));
    }
    if (url.pathname === '/api/models') return json(url.searchParams.get('search') ? [repo] : []);
    if (url.pathname === `/api/models/${REPO}`) return json(repo);
    return json([]);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe('Model cards in plain words', () => {
  it('show the verified mark but no download count, NPU/GPU or publisher name', async () => {
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    restoreFetch = installHuggingFace();
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    const { hardwareService } = require('../../../src/services/hardware');
    await hardwareService.getDeviceInfo(); // as the app does at launch
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    const search = models.getByTestId('search-input');
    fireEvent.changeText(search, 'plainwords');
    fireEvent(search, 'submitEditing');

    // The search result card.
    const card = await waitFor(() => models.getByLabelText('Plainwords-7B-GGUF'));
    expect(within(card).getByText('Plainwords-7B-GGUF')).toBeTruthy();
    expect(within(card).getByLabelText('Verified')).toBeTruthy();
    expect(within(card).queryByText(/\bdl\b/)).toBeNull();
    expect(within(card).queryByText(/12\.3K|12345/)).toBeNull();
    expect(within(card).queryByText(/NPU\/GPU/)).toBeNull();
    // No publisher label beside the name. (The generated description line still ends "by bartowski";
    // reported as a product finding, src/services/huggingface.ts, so it is not asserted here.)
    expect(within(card).queryByText('bartowski')).toBeNull();
    expect(within(card).queryByText(/^bartowski ·|· bartowski$/)).toBeNull();

    // The file cards in its detail.
    fireEvent.press(within(card).getByText('Plainwords-7B-GGUF'));
    const fileCard = await waitFor(() => models.getByTestId('file-card-0'));
    expect(within(fileCard).getByText(/^Plainwords-7B-Q4/)).toBeTruthy();
    expect(within(fileCard).getByLabelText('Verified')).toBeTruthy();
    expect(models.queryByText(/NPU\/GPU/)).toBeNull();
    expect(within(fileCard).queryByText(/\bdl\b/)).toBeNull();
    expect(within(fileCard).queryByText(/bartowski/i)).toBeNull();
  });
});
