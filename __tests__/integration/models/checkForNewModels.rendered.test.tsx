/**
 * Check for new models (v0.0.116): a model added to the remote catalog shows up without an app update.
 *
 * The person opens Models and taps the refresh icon. The app fetches the catalog file. A bottom sheet
 * names each new model, and the new model is in the list right away, not only after a relaunch. When
 * the catalog has nothing new, the sheet says the list is up to date and the list does not change.
 *
 * Real ModelsScreen, modelCatalogStore, the shared catalog fetch/parse/merge (@offgrid/models), the
 * CatalogCheckSheet and stores. Fakes only at the device boundary: the RAM sensor, the file system,
 * and the network (the catalog file on GitHub and Hugging Face, both through fetch).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const CATALOG_URL = 'https://raw.githubusercontent.com/off-grid-ai/OGAM/main/catalog/models.json';

/** The catalog file as it is published: the envelope with the sections the app reads. */
function catalogFile(text: unknown[], models: unknown[] = []): string {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt: '2026-10-22',
    sections: { models, text, transcription: [], coreml: [], litert: [] },
  });
}

/** An sd.cpp image model added to the catalog after this build shipped (the full `models` shape). */
const NEW_IMAGE_MODEL = {
  id: 'someone/Brandnew-Image-GGUF',
  name: 'Brandnew Image',
  kind: 'image',
  org: 'Someone',
  minRamGb: 8,
  files: [{
    name: 'brandnew-image-q4_0.gguf',
    url: 'https://huggingface.co/someone/Brandnew-Image-GGUF/resolve/main/brandnew-image-q4_0.gguf',
    sizeBytes: 2_000_000_000,
    role: 'primary',
  }],
};

/** A chat model added to the catalog after this build shipped (the README's `text` shape). */
const NEW_MODEL = {
  id: 'someone/Brandnew-3B-GGUF',
  name: 'Brandnew 3B',
  params: 3,
  description: 'Added after the release',
  minRam: 4,
  type: 'text',
  org: 'Qwen',
  isNew: true,
};

interface Network {
  restore: () => void;
  catalogRequests: () => number;
  serveCatalog: (body: string) => void;
}

/** The network: the catalog file at its GitHub URL, Hugging Face answering with empty results. */
function installNetwork(initialCatalog: string): Network {
  const original = globalThis.fetch;
  let catalog = initialCatalog;
  let requests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = String(input);
    if (href === CATALOG_URL) {
      requests += 1;
      const body = catalog;
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) } as Response;
    }
    const url = new URL(href);
    if (url.pathname.startsWith('/api/models/') && !url.pathname.includes('/tree/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      const body = { id, author: id.split('/')[0], downloads: 0, likes: 0, tags: ['gguf'], siblings: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' } as Response;
  }) as typeof fetch;
  return {
    restore: () => { globalThis.fetch = original; },
    catalogRequests: () => requests,
    serveCatalog: body => { catalog = body; },
  };
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

describe('Check for new models on the Models screen', () => {
  let network: Network | null = null;
  afterEach(() => network?.restore());

  it('names the new model in a sheet and shows it in the list right away', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    network = installNetwork(catalogFile([NEW_MODEL]));
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await freshLaunch();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());

    // BEFORE: launch never fetched the catalog; the new model is not listed and no sheet is open.
    expect(network.catalogRequests()).toBe(0);
    expect(models.queryByText('Brandnew 3B')).toBeNull();
    expect(models.queryByTestId('catalog-check-sheet')).toBeNull();
    // A bundled model is in the list, so the list is really there.
    expect(models.getByText('MiniCPM5 2B')).toBeTruthy();

    fireEvent.press(models.getByTestId('check-new-models-button'));

    // The sheet names the one new model.
    const sheet = await waitFor(() => models.getByTestId('catalog-check-sheet'));
    expect(network.catalogRequests()).toBe(1);
    expect(models.getByText('1 new model')).toBeTruthy();
    expect(within(sheet).getByText('Brandnew 3B')).toBeTruthy();
    // It names only what is new: a bundled model is not reported as new.
    expect(within(sheet).queryByText('MiniCPM5 2B')).toBeNull();

    // The list shows the new model now, without a relaunch, and keeps the bundled ones.
    await waitFor(() => expect(within(models.getByTestId('models-list')).getByText('Brandnew 3B')).toBeTruthy());
    expect(within(models.getByTestId('models-list')).getByText('MiniCPM5 2B')).toBeTruthy();

    // A second check with the same catalog finds nothing new, and the model stays listed.
    fireEvent.press(models.getByTestId('check-new-models-button'));
    await waitFor(() => expect(models.getByText('Up to date')).toBeTruthy());
    expect(network.catalogRequests()).toBe(2);
    expect(models.queryByText('1 new model')).toBeNull();
    expect(within(models.getByTestId('models-list')).getByText('Brandnew 3B')).toBeTruthy();
  });

  it('says Up to date when the catalog has nothing new, and the list does not change', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    network = installNetwork(catalogFile([]));
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await freshLaunch();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());
    const listBefore = within(models.getByTestId('models-list')).getAllByText(/./).map(n => n.props.children);

    // BEFORE: no sheet, nothing fetched.
    expect(models.queryByTestId('catalog-check-sheet')).toBeNull();
    expect(models.queryByText('Up to date')).toBeNull();
    expect(network.catalogRequests()).toBe(0);

    fireEvent.press(models.getByTestId('check-new-models-button'));

    await waitFor(() => expect(models.getByText('Up to date')).toBeTruthy());
    expect(network.catalogRequests()).toBe(1);
    expect(models.queryByText(/new model/)).toBeNull();
    expect(models.queryByText('Brandnew 3B')).toBeNull();
    const listAfter = within(models.getByTestId('models-list')).getAllByText(/./).map(n => n.props.children);
    expect(listAfter).toEqual(listBefore);
  });

  it('lists an sd.cpp image model the catalog adds on the Image tab, without an app update', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    network = installNetwork(catalogFile([], [NEW_IMAGE_MODEL]));
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await freshLaunch();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());
    fireEvent.press(models.getByText('Image'));
    // BEFORE: a bundled sd.cpp model is listed; the catalog's new one is not.
    await waitFor(() => expect(models.getAllByText(/^FLUX\.2 klein 4B/).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(models.queryByText('Brandnew Image')).toBeNull();

    fireEvent.press(models.getByTestId('check-new-models-button'));

    // AFTER: the sheet names it, and the Image tab lists it now (a second copy, outside the sheet),
    // beside the bundled ones.
    const sheet = await waitFor(() => models.getByTestId('catalog-check-sheet'));
    expect(within(sheet).getByText('Brandnew Image')).toBeTruthy();
    await waitFor(() => expect(models.getAllByText('Brandnew Image')).toHaveLength(2), { timeout: 4000 });
    expect(models.getAllByText(/^FLUX\.2 klein 4B/).length).toBeGreaterThan(0);
  });
});
