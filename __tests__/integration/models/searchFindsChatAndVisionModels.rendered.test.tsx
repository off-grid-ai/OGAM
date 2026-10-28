/**
 * Models search finds the models a person can chat with, including the ones that read images, and
 * nothing that cannot chat.
 *
 * The person types into the Text search on the Models screen and submits:
 *  (a) Gemma 4 and Qwen 3.5 are listed, and their cards say they read images: each repo ships a
 *      vision projector (mmproj), though neither name says "VL";
 *  (b) a speech model (Qwen3-TTS) and an embedding model (nomic-embed) are not listed, as on Desktop.
 * Then they open the filters and pick Type → Vision:
 *  (c) Gemma 4 and Qwen 3.5 stay; a chat model with no projector goes.
 *
 * Real ModelsScreen, useTextModels, huggingFace service, shared search rules, memory budget, stores.
 * Fakes only at the device boundary: the RAM sensor, the file system, and Hugging Face (fetch), which
 * answers with each repo's file list as its search does (expand[]=siblings).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

const GEMMA = 'bartowski/google_gemma-4-E4B-it-GGUF';
const QWEN = 'bartowski/Qwen_Qwen3.5-4B-GGUF';
const PLAIN = 'someone/Plain-Chat-3B-GGUF';
const TTS = 'Qwen/Qwen3-TTS-12Hz-1.7B-GGUF';
const EMBED = 'nomic-ai/nomic-embed-text-v2-moe-GGUF';

/** A search listing row as Hugging Face returns it: the repo and its files. */
const repo = (id: string, files: string[], pipeline_tag?: string) => ({
  id,
  downloads: 10,
  likes: 0,
  tags: ['gguf'],
  ...(pipeline_tag ? { pipeline_tag } : {}),
  siblings: files.map(rfilename => ({ rfilename })),
});

const LISTING = [
  repo(GEMMA, ['google_gemma-4-E4B-it-Q4_K_M.gguf', 'mmproj-google_gemma-4-E4B-it-f16.gguf'], 'image-text-to-text'),
  repo(QWEN, ['Qwen_Qwen3.5-4B-Q4_K_M.gguf', 'mmproj-Qwen_Qwen3.5-4B-f16.gguf'], 'image-text-to-text'),
  repo(PLAIN, ['Plain-Chat-3B-Q4_K_M.gguf'], 'text-generation'),
  repo(TTS, ['Qwen3-TTS-12Hz-1.7B-Q4_K_M.gguf'], 'text-to-speech'),
  repo(EMBED, ['nomic-embed-text-v2-moe.Q4_K_M.gguf'], 'sentence-similarity'),
];

function installHuggingFace(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/models') return json(LISTING);
    if (url.pathname.startsWith('/api/models/') && !url.pathname.includes('/tree/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      return json(LISTING.find(row => row.id === id) ?? { id, tags: ['gguf'], siblings: [] });
    }
    return json([]);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function launch() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

const nameOf = (id: string) => id.split('/')[1];

describe('Models search: chat models, with the ones that read images', () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it('lists Gemma 4 and Qwen 3.5, leaves out speech and embedding models, and keeps both under Vision', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    restoreFetch = installHuggingFace();
    await launch();
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const models = render(React.createElement(ModelsScreen));

    const search = models.getByPlaceholderText('Search models');
    fireEvent.changeText(search, 'qwen gemma');
    fireEvent(search, 'submitEditing');

    // (a) Both chat models that read images are listed, and their cards say so.
    await waitFor(() => expect(models.getByText(nameOf(GEMMA))).toBeTruthy());
    expect(models.getByText(nameOf(QWEN))).toBeTruthy();
    expect(models.getByText(nameOf(PLAIN))).toBeTruthy();
    // Both are 4B and read images; the plain chat model says text.
    expect(models.getAllByText('Vision · 4B')).toHaveLength(2);
    expect(models.getByText('Text generation · 3B')).toBeTruthy();
    // (b) Nothing that cannot chat.
    expect(models.queryByText(nameOf(TTS))).toBeNull();
    expect(models.queryByText(nameOf(EMBED))).toBeNull();

    // (c) Type → Vision keeps the two that read images and drops the plain chat model.
    fireEvent.press(models.getByTestId('text-filter-toggle'));
    fireEvent.press(models.getByText(/^Type/));
    fireEvent.press(models.getByText('Vision'));
    await waitFor(() => expect(models.queryByText(nameOf(PLAIN))).toBeNull());
    expect(models.getByText(nameOf(GEMMA))).toBeTruthy();
    expect(models.getByText(nameOf(QWEN))).toBeTruthy();
  });
});
