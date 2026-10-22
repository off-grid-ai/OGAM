/**
 * Screen readers say which model each download button downloads (9354460b1).
 *
 * A model card's download button is an icon. A screen-reader user moving through the Models screen
 * heard "Download model" on every card and could not tell which model a button would fetch. Now each
 * card's download button says "Download <the model's name>", the name the card shows.
 *
 * The person opens Models and moves through the Text, Image and Speech tabs. On each tab every card
 * that offers a download names its own model, and activating the button found by that spoken name
 * downloads exactly that model.
 *
 * Real ModelsScreen, its three tabs, ModelCard, the download actions, background download service and
 * stores. Fakes only at the device boundary: the RAM sensor, the native download module, the file
 * system, the unzip module and the network (fetch: Hugging Face and the remote catalog).
 */
import { installNativeBoundary, requireRTL, GB, MB } from '../../harness/nativeBoundary';
import { installImageZipPackage, sdMnnTree } from '../../harness/imageModelPackage';

type Node = { props?: Record<string, unknown>; children?: unknown };

function texts(node: unknown): string[] {
  if (typeof node === 'string') return [node];
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap(texts);
  return texts((node as Node).children);
}

/**
 * Every card on screen that offers a download, as what the person meets: the name the card shows
 * first, and what a screen reader says for that card's download button.
 */
function downloadCards(tree: unknown, cardId: RegExp): { card: string; shows: string; says: unknown }[] {
  const out: { card: string; shows: string; says: unknown }[] = [];
  const seen = new Set<string>();
  const find = (node: unknown, testID: string): Node | undefined => {
    if (!node || typeof node === 'string') return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = find(child, testID);
        if (hit) return hit;
      }
      return undefined;
    }
    if ((node as Node).props?.testID === testID) return node as Node;
    return find((node as Node).children, testID);
  };
  const walk = (node: unknown) => {
    if (!node || typeof node === 'string') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const testID = (node as Node).props?.testID;
    if (typeof testID === 'string' && cardId.test(testID)) {
      if (!seen.has(testID)) {
        seen.add(testID);
        const button = find(node, `${testID}-download`);
        if (button) {
          expect(button.props?.accessibilityRole).toBe('button');
          out.push({ card: testID, shows: texts(node)[0], says: button.props?.accessibilityLabel });
        }
      }
      return;
    }
    walk((node as Node).children);
  };
  walk(tree);
  return out;
}

const TEXT_REPO = 'openbmb/MiniCPM5-2B-GGUF';
const TEXT_NAME = 'MiniCPM5 2B';
const TEXT_FILES = [['MiniCPM5-2B-Q4_K_M.gguf', 1500 * MB], ['MiniCPM5-2B-Q8_0.gguf', 2600 * MB]] as const;
const ZIP_NAME = 'AnythingV5.zip';
const IMAGE_NAME = 'Anything V5 (GPU)';

/** Hugging Face and the remote catalog as the phone sees them: one image repo with four models,
 *  everything else empty. The fake answers by path only. */
function installNetwork(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === 'https://huggingface.co/api/models/xororz/sd-mnn/tree/main') {
      return new Response(JSON.stringify([
        ...sdMnnTree('AbsoluteReality.zip', 300 * MB),
        ...sdMnnTree(ZIP_NAME, 400 * MB),
        ...sdMnnTree('ChilloutMix.zip', 600 * MB),
        ...sdMnnTree('QteaMix.zip', 900 * MB),
      ]), { status: 200 });
    }
    const parsed = new URL(url);
    if (parsed.pathname === `/api/models/${TEXT_REPO}` && parsed.searchParams.get('blobs') === 'true') {
      return new Response(JSON.stringify({
        id: TEXT_REPO, author: 'openbmb', downloads: 1, likes: 0, tags: ['gguf'],
        siblings: TEXT_FILES.map(([rfilename, size]) => ({ rfilename, size, lfs: { size } })),
      }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function launchWithEmptyStorage() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

describe('Download buttons say which model they download', () => {
  let restoreNetwork: () => void = () => {};
  afterEach(() => restoreNetwork());

  async function openModels() {
    const boundary = installNativeBoundary({
      download: true,
      fs: true,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
    });
    installImageZipPackage(boundary);
    restoreNetwork = installNetwork();
    const React = require('react');
    const rtl = requireRTL();
    await launchWithEmptyStorage();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const models = rtl.render(React.createElement(ModelsScreen));
    return { boundary, rtl, models };
  }

  it('Text: each pick and each size of a model names that model, and that button downloads it', async () => {
    const { boundary, rtl, models } = await openModels();
    const { waitFor, fireEvent } = rtl;
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());

    // The picks row: each pick's download button says the pick's name.
    for (const slot of ['fast', 'balanced', 'best']) {
      const pick = models.getByTestId(`pick-${slot}`);
      const name = texts(rtl.within(pick).getByText(/^Qwen /).props.children).join('');
      expect(models.getByTestId(`pick-${slot}-download`).props.accessibilityLabel).toBe(`Download ${name}`);
    }

    // A model's detail: each size's card shows its file by name, and its download button says that
    // name, so two sizes of one model are never announced the same.
    fireEvent.press(models.getByText(TEXT_NAME));
    await waitFor(() => expect(models.getByTestId('file-card-1')).toBeTruthy());
    const cards = downloadCards(models.toJSON(), /^file-card-\d+$/);
    expect(cards).toHaveLength(2);
    expect(cards.map(c => c.shows).sort()).toEqual(['MiniCPM5-2B-Q4_K_M', 'MiniCPM5-2B-Q8_0']);
    for (const { shows, says } of cards) expect(says).toBe(`Download ${shows}`);
    expect(models.queryAllByRole('button', { name: 'Download model' })).toHaveLength(0);

    // BEFORE: nothing downloading.
    expect(boundary.download!.active()).toHaveLength(0);
    fireEvent.press(models.getByLabelText('Download MiniCPM5-2B-Q8_0'));

    // The device is asked for exactly that file.
    await waitFor(() => expect(boundary.download!.active().map(row => row.fileName)).toEqual(['MiniCPM5-2B-Q8_0.gguf']));
  });

  it('Image: each card names its own model, and that button downloads that model', async () => {
    const { boundary, rtl, models } = await openModels();
    const { waitFor, fireEvent } = rtl;
    // BEFORE: on the Text tab no image card is shown.
    expect(models.queryByText(IMAGE_NAME)).toBeNull();
    fireEvent.press(models.getByText('Image'));
    await waitFor(() => expect(models.getByText(IMAGE_NAME)).toBeTruthy(), { timeout: 4000 });

    const cards = downloadCards(models.toJSON(), /^image-model-card-\d+$/);
    expect(cards.map(c => c.shows)).toContain(IMAGE_NAME);
    for (const { shows, says } of cards) expect(says).toBe(`Download ${shows}`);
    expect(models.queryAllByRole('button', { name: 'Download model' })).toHaveLength(0);

    expect(boundary.download!.active()).toHaveLength(0);
    fireEvent.press(models.getByLabelText(`Download ${IMAGE_NAME}`));

    // The device is asked for that model's package (the app names the file by model and backend).
    await waitFor(() => expect(boundary.download!.active()).toHaveLength(1));
    expect(boundary.download!.active()[0].fileName).toMatch(/^anythingv5_/i);
  });

  it('Speech: each card names its own model, and that button downloads that model', async () => {
    const { boundary, rtl, models } = await openModels();
    const { waitFor, fireEvent } = rtl;
    expect(models.queryByTestId('speech-picks')).toBeNull();
    fireEvent.press(models.getByTestId('transcription-models-tab'));
    await waitFor(() => expect(models.getByTestId('speech-picks')).toBeTruthy());

    const cards = downloadCards(models.toJSON(), /^transcription-model-card-\d+$/);
    // Every speech model in the list below the picks offers a download on a fresh phone.
    expect(cards.map(c => c.shows)).toEqual(['Tiny', 'Base', 'Small', 'Medium', 'Base', 'Medium', 'Large v3 Turbo']);
    for (const { shows, says } of cards) expect(says).toBe(`Download ${shows}`);
    expect(models.queryAllByRole('button', { name: 'Download model' })).toHaveLength(0);

    // A name the list shows once reaches exactly that model.
    expect(boundary.download!.active()).toHaveLength(0);
    expect(models.queryByTestId('transcription-model-card-8-cancel')).toBeNull();
    fireEvent.press(models.getByLabelText('Download Large v3 Turbo'));

    await waitFor(() =>
      expect(boundary.download!.active().map(row => row.fileName)).toEqual(['ggml-large-v3-turbo.bin']),
    );
    // The card that said "Large v3 Turbo" is the one now downloading; it no longer offers a download.
    await waitFor(() => expect(models.getByTestId('transcription-model-card-8-cancel')).toBeTruthy());
    expect(models.queryByLabelText('Download Large v3 Turbo')).toBeNull();
  });
});
