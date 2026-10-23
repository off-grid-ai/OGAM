/**
 * Models opens with Fast, Balanced and Best for this phone, on every tab.
 *
 * The person opens Models and sees three picks for their phone at the top: on Text from the shared
 * catalog, on Image one card per image model (its variants are one model, named in plain words), on
 * Speech the multilingual Whisper sizes. One tap on a Text pick downloads the catalog's file; when it
 * finishes the pick is the active chat model and offers "Chat now". A smaller phone shows only the
 * picks that run well on it. A search answers from the catalog first, then Hugging Face, and a model
 * in both appears once. A model's detail offers its sizes in words, with every file behind All files.
 *
 * Real ModelsScreen, HomeScreen + model picker, devicePicks / shared picking rule, startModelDownload,
 * background download service, stores. Fakes only at the device boundary: the RAM sensor, the native
 * download module, the file system, and Hugging Face (fetch).
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';

type FetchRoute = (url: URL) => unknown | undefined;

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

/** Hugging Face as the app reads it: the routes a test names, an empty answer for the rest. */
function installHuggingFace(route: FetchRoute = () => undefined): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = route(url);
    if (body !== undefined) return json(body);
    if (url.pathname.startsWith('/api/models/') && !url.pathname.includes('/tree/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      return json({ id, author: id.split('/')[0], downloads: 0, likes: 0, tags: ['gguf'], siblings: [] });
    }
    return json([]);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** The text the screen shows, in reading order. */
function screenText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!node) return '';
  if (Array.isArray(node)) return node.map(screenText).join('\n');
  return screenText((node as { children?: unknown }).children);
}

/** What the app does at launch (App.tsx reads the device once); the RAM it reads is the boundary's. */
async function launchReadsDevice() {
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

async function clearStorage() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  await launchReadsDevice();
}

describe('Fast, Balanced and Best on the Models screen', () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it('a 12 GB phone gets three chat picks; one tap downloads the Fast one and makes it the chat model', async () => {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    restoreFetch = installHuggingFace();
    const React = require('react');
    const { render, fireEvent, waitFor, within, act } = requireRTL();
    await clearStorage();
    const { CATALOG } = require('@offgrid/models');
    const fastEntry = CATALOG.find((e: { name: string }) => e.name === 'Qwen 3.5 0.8B');
    const primary = fastEntry.files.find((f: { role?: string }) => f.role === 'primary');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());
    expect(within(models.getByTestId('device-picks')).getByText('For this phone')).toBeTruthy();
    // Ranked by the catalog's quality score among models that run well here, from makers people
    // know; replaced models (Qwen3-VL, the Qwen 3.8 distills) are never picked.
    expect(within(models.getByTestId('pick-fast')).getByText('Qwen 3.5 0.8B')).toBeTruthy();
    expect(within(models.getByTestId('pick-balanced')).getByText('Qwen 3.5 2B')).toBeTruthy();
    expect(within(models.getByTestId('pick-best')).getByText('Qwen 3.5 4B')).toBeTruthy();
    expect(models.queryByText('Qwen3-VL 2B')).toBeNull();
    // A lesser-known lab's model stays in the list below, not in the picks.
    expect(within(models.getByTestId('device-picks')).queryByText('MiniCPM5 2B')).toBeNull();
    expect(models.getByText('MiniCPM5 2B')).toBeTruthy();
    // The old RAM banner is gone.
    expect(models.queryByText(/RAM — models up to/)).toBeNull();

    // BEFORE: nothing downloading, the Fast pick offers a download and no "Chat now".
    expect(boundary.download!.active()).toHaveLength(0);
    expect(models.queryByTestId('pick-fast-next')).toBeNull();
    expect(models.getByTestId('pick-fast-download').props.accessibilityLabel).toBe('Download Qwen 3.5 0.8B');

    fireEvent.press(models.getByTestId('pick-fast-download'));

    // The native download is the catalog's weights for that model.
    await waitFor(() =>
      expect(boundary.download!.active().map(r => r.fileName)).toContain(primary.name),
    );
    // While it downloads, the pick's card shows its progress instead of the download button.
    await waitFor(() => expect(models.queryByTestId('pick-fast-download')).toBeNull());

    // The device finishes every file it was asked for (weights and the vision projector).
    for (let round = 0; round < 3 && boundary.download!.active().length > 0; round++) {
      const rows = boundary.download!.active();
      await act(async () => {
        for (const row of rows) {
          const size = row.fileName === primary.name ? primary.sizeBytes : 800 * MB;
          boundary.fs!.seedFile(`/docs/models/${row.fileName}`, size);
          boundary.download!.events.emit('DownloadComplete', {
            downloadId: row.downloadId,
            fileName: row.fileName,
            modelId: row.modelId,
            bytesDownloaded: size,
            totalBytes: size,
            status: 'completed',
            localUri: `/docs/models/${row.fileName}`,
          });
        }
        await new Promise(resolve => setTimeout(resolve, 0));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }

    // AFTER: the Fast pick is the active one and offers "Chat now"; no download offer is left.
    await waitFor(() => expect(models.getByTestId('pick-fast-next').props.accessibilityLabel).toBe('Chat now'));
    expect(models.queryByTestId('pick-fast-download')).toBeNull();
    expect(models.queryByTestId('pick-fast-progress')).toBeNull();
    // The other picks are untouched.
    expect(models.getByTestId('pick-balanced-download')).toBeTruthy();
    models.unmount();

    // The chat model picker shows it as the selected chat model.
    const navigation = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
    const { HomeScreen } = require('../../../src/screens/HomeScreen');
    const home = render(React.createElement(HomeScreen, { navigation }));
    await waitFor(() => expect(home.getByTestId('model-summary-text').props.accessibilityState).toEqual({ selected: true }));
    fireEvent.press(home.getByTestId('model-summary-text-open'));
    await waitFor(() => expect(home.getByText('TEXT MODEL')).toBeTruthy());
    // The picker's only local model is the one the pick downloaded, and it is the selected one.
    // (Its row is found by the downloaded file, not its name: the picker names it from the file,
    // "Qwen3-VL-2B-Instruct", not the catalog name the pick showed; reported as a product finding.)
    const row = await waitFor(() => home.getByTestId(`text-model-row-${fastEntry.id}/${primary.name}`));
    expect(row.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it('a 4 GB phone shows only the picks that run well on it', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 2 * GB } });
    restoreFetch = installHuggingFace();
    const React = require('react');
    const { render, waitFor, within } = requireRTL();
    await clearStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());
    expect(within(models.getByTestId('pick-best')).getByText('Qwen 3.5 0.8B')).toBeTruthy();
    expect(models.queryByTestId('pick-fast')).toBeNull();
    expect(models.queryByTestId('pick-balanced')).toBeNull();
    // None of the 12 GB picks is offered to this phone.
    expect(within(models.getByTestId('device-picks')).queryByText('MiniCPM5 2B')).toBeNull();
    expect(within(models.getByTestId('device-picks')).queryByText('Qwen 3.5 4B')).toBeNull();
  });

  it('Image: two variants of one model are one pick, named in plain words', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const repo = 'apple/coreml-stable-diffusion-2-1-base-palettized';
    restoreFetch = installHuggingFace(url =>
      url.pathname === `/api/models/${repo}/tree/main`
        ? [
          { type: 'file', path: 'coreml-stable-diffusion-2-1-base-palettized_split_einsum_v2_compiled.zip', size: 134, lfs: { oid: 'a', size: 1200 * MB, pointerSize: 134 } },
          { type: 'file', path: 'coreml-stable-diffusion-2-1-base-palettized_original_compiled.zip', size: 134, lfs: { oid: 'b', size: 1100 * MB, pointerSize: 134 } },
        ]
        : undefined,
    );
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await clearStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    // BEFORE: the Text tab shows no image picks.
    expect(models.queryByTestId('image-picks')).toBeNull();
    fireEvent.press(models.getByText('Image'));

    const picks = await waitFor(() => models.getByTestId('image-picks'));
    // The picks show the model once, by its family name, with no variant or Core ML suffix ...
    expect(within(picks).getAllByText('SD 2.1 Palettized')).toHaveLength(1);
    expect(within(picks).queryByText(/Low RAM|Core ML/)).toBeNull();
    // ... and the list below does not repeat it in any variant: the pick stands for them all.
    expect(models.getAllByText('SD 2.1 Palettized')).toHaveLength(1);
    expect(models.queryByText('SD 2.1 Palettized (Low RAM)')).toBeNull();
    expect(models.queryByText(/\(Core ML\)/)).toBeNull();
  });

  it('Speech: a 12 GB phone gets Tiny, Small and Large v3', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    restoreFetch = installHuggingFace();
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await clearStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    expect(models.queryByTestId('speech-picks')).toBeNull();
    fireEvent.press(models.getByTestId('transcription-models-tab'));

    await waitFor(() => expect(models.getByTestId('speech-picks')).toBeTruthy());
    expect(within(models.getByTestId('pick-fast')).getByText('Tiny')).toBeTruthy();
    expect(within(models.getByTestId('pick-balanced')).getByText('Small')).toBeTruthy();
    expect(within(models.getByTestId('pick-best')).getByText('Large v3')).toBeTruthy();
    expect(models.getByTestId('pick-fast-download')).toBeTruthy();
    // The list below leaves out exactly the picked models: the multilingual Tiny, Small and Large v3
    // are not repeated, while the English-only Tiny and Small (different models) and the
    // multilingual Medium stay.
    expect(models.getAllByText('Tiny')).toHaveLength(2);
    expect(models.getAllByText('Small')).toHaveLength(2);
    expect(models.getAllByText('Large v3')).toHaveLength(1);
    expect(models.getAllByText('Medium')).toHaveLength(2);
    expect(models.queryByText('Fastest, 99 languages')).toBeNull();
    expect(models.getByText('Fastest, English only')).toBeTruthy();
  });
});

describe('Text search answers from the catalog first', () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it('lists a catalog Qwen model before a Hugging Face-only one, and a model in both once', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const hfOnly = 'someone/Qwen-Only-On-HF-GGUF';
    const inBoth = 'unsloth/Qwen3.5-2B-GGUF';
    restoreFetch = installHuggingFace(url =>
      url.pathname === '/api/models'
        ? [inBoth, hfOnly].map(id => ({ id, author: id.split('/')[0], downloads: 10, likes: 0, tags: ['gguf'], siblings: [] }))
        : undefined,
    );
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    await clearStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    const search = models.getByPlaceholderText('Search models');
    fireEvent.changeText(search, 'qwen');
    fireEvent(search, 'submitEditing');

    await waitFor(() => expect(models.getByText('Qwen-Only-On-HF-GGUF')).toBeTruthy());
    // The catalog model shows once, by its catalog name; its Hugging Face twin is not repeated.
    expect(models.getAllByText('Qwen 3.5 2B')).toHaveLength(1);
    expect(models.queryByText('Qwen3.5-2B-GGUF')).toBeNull();
    // Catalog first: the catalog Qwen is above the Hugging Face-only result in the list.
    const lines = screenText(models.toJSON()).split('\n');
    expect(lines.indexOf('Qwen 3.5 2B')).toBeGreaterThan(-1);
    expect(lines.indexOf('Qwen 3.5 2B')).toBeLessThan(lines.indexOf('Qwen-Only-On-HF-GGUF'));
    // A catalog model too big for the phone is left out.
    expect(models.queryByText('Qwen 3.8 27B')).toBeNull();
  });

  it('a search result says what matters: its active size, its other uploads, and nothing hidden', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const moe = 'unsloth/Tiny-MoE-8B-A1B-GGUF';
    restoreFetch = installHuggingFace(url =>
      url.pathname === '/api/models'
        ? [moe, 'bartowski/Tiny-MoE-8B-A1B-GGUF', 'someone/Tiny-MoE-8B-A1B-abliterated-GGUF']
          .map(id => ({ id, author: id.split('/')[0], downloads: 10, likes: 0, tags: ['gguf'], siblings: [] }))
        : undefined,
    );
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    await clearStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    const search = models.getByPlaceholderText('Search models');
    fireEvent.changeText(search, 'tiny-moe');
    fireEvent(search, 'submitEditing');

    await waitFor(() => expect(models.getAllByText('Tiny-MoE-8B-A1B-GGUF')).toHaveLength(1));
    const text = screenText(models.toJSON());
    // Its speed shows as a badge: a mixture-of-experts model that runs like a 1B.
    expect(models.getByLabelText('Mixture of experts: runs like a 1B model')).toBeTruthy();
    expect(text).toMatch(/MoE 1B/);
    expect(text).toMatch(/\+1 uploads/);
    expect(text).not.toMatch(/abliterated/i);
  });

  it('a model with a published MTP head carries the MTP badge, and one without does not', async () => {
    // 16 GB: Gemma 4 E4B (6 GB with its projector) loads and is not one of the picks.
    installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 16 * GB, availBytes: 12 * GB } });
    restoreFetch = installHuggingFace();
    const React = require('react');
    const { render, waitFor, within } = requireRTL();
    await launchReadsDevice();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));

    const gemma = await waitFor(() => models.getByLabelText('Gemma 4 E4B'));
    expect(within(gemma).getByLabelText('MTP: replies faster')).toBeTruthy();
    // A screen reader focuses the whole card, so the card itself says it.
    expect(gemma.props.accessibilityHint).toContain('MTP: replies faster');
    const minicpm = models.getByLabelText('MiniCPM5 2B');
    expect(within(minicpm).queryByLabelText('MTP: replies faster')).toBeNull();
  });
});

describe("A model's detail offers its sizes in words", () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it('shows Smaller, Recommended and Best, with every file behind All files', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const MODEL_ID = 'someone/Sizes-Demo-7B-GGUF';
    const files = [
      ['sizes-demo-q2_k.gguf', 1000],
      ['sizes-demo-q3_k_m.gguf', 1500],
      ['sizes-demo-q4_k_m.gguf', 2000],
      ['sizes-demo-q5_k_m.gguf', 2500],
      ['sizes-demo-q8_0.gguf', 4000],
    ] as const;
    restoreFetch = installHuggingFace(url => {
      // A model's files come from its listing with blob sizes (`?blobs=true`), as Hugging Face serves it.
      if (url.pathname === `/api/models/${MODEL_ID}` && url.searchParams.get('blobs') === 'true') {
        return {
          id: MODEL_ID, author: 'someone', downloads: 1, likes: 0, tags: ['gguf'],
          siblings: files.map(([rfilename, mb]) => ({ rfilename, size: mb * MB, lfs: { size: mb * MB } })),
        };
      }
      if (url.pathname === '/api/models') {
        return [{ id: MODEL_ID, author: 'someone', downloads: 1, likes: 0, tags: ['gguf'], siblings: [] }];
      }
      return undefined;
    });
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await clearStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    const search = models.getByPlaceholderText('Search models');
    fireEvent.changeText(search, 'Sizes Demo');
    fireEvent(search, 'submitEditing');
    fireEvent.press(await waitFor(() => models.getByText('Sizes-Demo-7B-GGUF')));

    await waitFor(() => expect(models.getByText('Sizes')).toBeTruthy());
    expect(models.queryByText('Available Files')).toBeNull();
    expect(models.queryByText(/Choose a quantization/)).toBeNull();

    // Three sizes in words, smallest to largest; the raw quant names are not the labels.
    await waitFor(() => expect(models.getByTestId('file-card-2')).toBeTruthy());
    expect(models.queryByTestId('file-card-3')).toBeNull();
    expect(within(models.getByTestId('file-card-0')).getByText(/· Smaller/)).toBeTruthy();
    expect(within(models.getByTestId('file-card-0')).getByText('sizes-demo-q2_k')).toBeTruthy();
    expect(within(models.getByTestId('file-card-1')).getByText(/· Recommended/)).toBeTruthy();
    expect(within(models.getByTestId('file-card-1')).getByText('sizes-demo-q4_k_m')).toBeTruthy();
    expect(within(models.getByTestId('file-card-2')).getByText(/· Best/)).toBeTruthy();
    expect(within(models.getByTestId('file-card-2')).getByText('sizes-demo-q8_0')).toBeTruthy();
    expect(models.queryByText(/GB · Q4_K_M/)).toBeNull();

    // All files: every runnable file, by its quant name.
    expect(within(models.getByTestId('all-files-toggle')).getByText('All files')).toBeTruthy();
    fireEvent.press(models.getByTestId('all-files-toggle'));
    await waitFor(() => expect(models.getByTestId('file-card-4')).toBeTruthy());
    expect(models.getByText(/GB · Q4_K_M/)).toBeTruthy();
    expect(models.queryByText(/· Recommended/)).toBeNull();
    expect(within(models.getByTestId('all-files-toggle')).getByText('Fewer sizes')).toBeTruthy();

    // Fewer sizes goes back to the three.
    fireEvent.press(models.getByTestId('all-files-toggle'));
    await waitFor(() => expect(models.queryByTestId('file-card-3')).toBeNull());
    expect(within(models.getByTestId('file-card-1')).getByText(/· Recommended/)).toBeTruthy();
  });
});
