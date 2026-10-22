/**
 * Model cards warn before a download (v0.0.116-beta.1): "Newer: …" and "Research licence".
 *
 * The person searches on the Models screen. A result that a newer model replaces says so on its card
 * ("Newer: Qwen 3.5"), so the person does not download an old model by mistake. A model with a
 * research-only licence says "Research licence" on its card. A normal card says neither.
 *
 * Where "Research licence" can come from in this build: only a chat model with `nonCommercial` in the
 * remote catalog's `text` section (reached by "Check for new models"). No bundled chat entry sets it
 * (only the Qwen-Image image entries do, and the Image tab shows no fact chips), search results never
 * carry it, and the published catalog file (2026-10-21) has an empty `text` section. So the label is
 * wired, and this test proves the wiring, but no real model shows it today.
 *
 * Real ModelsScreen, search (shared @offgrid/models grouping + replacement rule), modelCatalogStore
 * (shared fetch/parse/merge), ModelCard and stores. Fakes only at the device boundary: the RAM sensor,
 * the file system, and the network (Hugging Face and the catalog file on GitHub, both through fetch).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const CATALOG_URL = 'https://raw.githubusercontent.com/off-grid-ai/OGAM/main/catalog/models.json';

type Route = (url: URL) => unknown | undefined;

const reply = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }) as Response;

/** The network: the catalog file at its GitHub URL, Hugging Face answering the routes a test names. */
function installNetwork(opts: { catalog?: string; hf?: Route } = {}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href === CATALOG_URL) return reply(opts.catalog ?? '');
    const url = new URL(href);
    const body = opts.hf?.(url);
    if (body !== undefined) return reply(body);
    if (url.pathname.startsWith('/api/models/') && !url.pathname.includes('/tree/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      return reply({ id, author: id.split('/')[0], downloads: 0, likes: 0, tags: ['gguf'], siblings: [] });
    }
    return reply([]);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** The catalog file as it is published, with chat models in its `text` section. */
function catalogFile(text: unknown[]): string {
  return JSON.stringify({ schemaVersion: 1, updatedAt: '2026-10-22', sections: { models: [], text, transcription: [], coreml: [], litert: [] } });
}

/** The text a node shows, in reading order. */
function screenText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!node) return '';
  if (Array.isArray(node)) return node.map(screenText).join('\n');
  return screenText((node as { children?: unknown }).children);
}

/** The text of the one model card that names `name`. */
function cardText(screen: { getAllByTestId: (id: RegExp) => unknown[] }, name: string): string {
  const { within } = requireRTL();
  const cards = screen.getAllByTestId(/^model-card-\d+$/).filter((card: any) => within(card).queryByText(name));
  expect(cards).toHaveLength(1);
  return screenText(cards[0]);
}

async function freshLaunch() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  // What App.tsx does at launch: read the device, then the catalog a previous check saved (none).
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
  const { initModelCatalog } = require('../../../src/stores/modelCatalogStore');
  await initModelCatalog();
}

describe('Model cards say when a newer model replaces them and when the licence is research-only', () => {
  let restoreNetwork: () => void = () => {};
  afterEach(() => restoreNetwork());

  it('a search result a newer model replaces says "Newer: …"; a normal result does not', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const old = 'bartowski/Llama-3.2-3B-Instruct-GGUF';
    const normal = 'someone/Orbitwise-3B-Instruct-GGUF';
    restoreNetwork = installNetwork({
      hf: url =>
        url.pathname === '/api/models'
          ? [old, normal].map(id => ({ id, author: id.split('/')[0], downloads: 100, likes: 0, tags: ['gguf'], siblings: [] }))
          : undefined,
    });
    const React = require('react');
    const { render, fireEvent, waitFor } = requireRTL();
    await freshLaunch();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());

    // BEFORE: neither result is on screen, and no card says a newer model replaces it.
    expect(models.queryByText('Llama-3.2-3B-Instruct-GGUF')).toBeNull();
    expect(models.queryByText('Orbitwise-3B-Instruct-GGUF')).toBeNull();
    expect(screenText(models.toJSON())).not.toMatch(/Newer:/);

    const search = models.getByPlaceholderText('Search models');
    fireEvent.changeText(search, 'instruct');
    fireEvent(search, 'submitEditing');

    await waitFor(() => expect(models.getByText('Llama-3.2-3B-Instruct-GGUF')).toBeTruthy());
    await waitFor(() => expect(models.getByText('Orbitwise-3B-Instruct-GGUF')).toBeTruthy());

    // The old Llama names the model that replaces it.
    expect(cardText(models, 'Llama-3.2-3B-Instruct-GGUF')).toMatch(/Newer: Qwen 3\.5/);
    // A normal result says nothing about a replacement or a licence.
    const normalCard = cardText(models, 'Orbitwise-3B-Instruct-GGUF');
    expect(normalCard).not.toMatch(/Newer:/);
    expect(normalCard).not.toMatch(/Research licence/);
  });

  it('a research-licensed model in the catalog says "Research licence"; a normal model does not', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const research = { id: 'somelab/Labonly-3B-GGUF', name: 'Labonly 3B', params: 3, description: 'A research model', minRam: 4, type: 'text', org: 'Qwen', nonCommercial: true };
    const normal = { id: 'somelab/Openuse-3B-GGUF', name: 'Openuse 3B', params: 3, description: 'A normal model', minRam: 4, type: 'text', org: 'Qwen' };
    restoreNetwork = installNetwork({ catalog: catalogFile([research, normal]) });
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await freshLaunch();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());

    // BEFORE: the bundled list is there, the two catalog models are not, and no card says
    // "Research licence" (no bundled chat model has a research licence).
    const list = () => within(models.getByTestId('models-list'));
    expect(list().getByText('MiniCPM5 2B')).toBeTruthy();
    expect(models.queryByText('Labonly 3B')).toBeNull();
    expect(models.queryByText('Openuse 3B')).toBeNull();
    expect(screenText(models.toJSON())).not.toMatch(/Research licence/);

    fireEvent.press(models.getByTestId('check-new-models-button'));
    await waitFor(() => expect(list().getByText('Labonly 3B')).toBeTruthy());
    await waitFor(() => expect(list().getByText('Openuse 3B')).toBeTruthy());

    // The research model says so on its card; the normal one and a bundled one do not.
    expect(cardText(models, 'Labonly 3B')).toMatch(/Research licence/);
    for (const name of ['Openuse 3B', 'MiniCPM5 2B']) {
      const text = cardText(models, name);
      expect(text).not.toMatch(/Research licence/);
      expect(text).not.toMatch(/Newer:/);
    }
  });
});
