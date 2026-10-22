/**
 * Recommended models keep their catalog facts when Hugging Face cannot be reached.
 *
 * The person opens Models with no connection to Hugging Face. The details the app asks Hugging Face
 * for (one request per recommended model) only enrich the cards; when every one of them fails with a
 * network error, the cards below the picks still show each model's catalog name and description,
 * nothing on the screen says anything failed, and opening a card still works.
 *
 * Real ModelsScreen, useTextModels, huggingFaceService, stores. Fakes only at the device boundary:
 * the RAM sensor, the file system, and the network (fetch rejects as React Native's does offline).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

type CatalogEntry = { id: string; name: string; description: string; params: number };

/** The network as an offline phone answers it: every Hugging Face request fails to connect. */
function installOfflineNetwork(): { detailRequests: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const detailRequests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/api/models/')) detailRequests.push(decodeURIComponent(url.pathname.slice('/api/models/'.length)));
    throw new TypeError('Network request failed');
  }) as typeof fetch;
  return { detailRequests, restore: () => { globalThis.fetch = original; } };
}

async function launchReadsDevice() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

describe('recommended model details fail to load', () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it('the model cards still show their catalog name and description, and no failure', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    const network = installOfflineNetwork();
    restore = network.restore;
    const React = require('react');
    const { render, waitFor, within, act, fireEvent } = requireRTL();
    await launchReadsDevice();
    const { CATALOG } = require('@offgrid/models');
    const minicpm: CatalogEntry = CATALOG.find((e: CatalogEntry) => e.name === 'MiniCPM5 2B');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));

    // The app asked Hugging Face for the recommended models' details, and every request failed.
    await waitFor(() => expect(network.detailRequests).toContain(minicpm.id));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // The card for a model outside the picks shows the catalog's name and description.
    const card = await waitFor(() => {
      const cards = models.queryAllByTestId(/^model-card-\d+$/);
      const found = cards.find(c => within(c).queryByText(minicpm.name));
      expect(found).toBeTruthy();
      return found!;
    });
    expect(within(card).getByText(new RegExp(minicpm.description.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(within(card).getByText(new RegExp(`${String(minicpm.params).replace('.', '\\.')}B params`))).toBeTruthy();
    // The picks above the list are there too.
    expect(models.getByTestId('device-picks')).toBeTruthy();
    // Nothing on screen says the details failed.
    expect(models.queryByText(/fail|error|network/i)).toBeNull();

    // The card still opens the model's detail.
    expect(models.queryByText('Sizes')).toBeNull();
    fireEvent.press(within(card).getByText(minicpm.name));
    await waitFor(() => expect(models.getByText('Sizes')).toBeTruthy());
  });
});
