/**
 * Maker filters (v0.0.116): a curated model is found under its maker's filter, and Liquid AI has one.
 *
 * The person opens Models, opens the filters, opens Org and taps a maker. The curated models from that
 * maker are listed; models from other makers are not. The catalog names makers for people ("Meta",
 * "Mistral") while the filter keys by the Hugging Face org; a catalog model must still be found under
 * its maker. Liquid AI is one of the makers to pick, and its curated LFM model is under it.
 *
 * Real ModelsScreen, TextModelsTab + TextFiltersSection, useTextModels, the shared catalog, stores.
 * Fakes only at the device boundary: the RAM sensor, the file system, and Hugging Face (fetch), which
 * answers every search with no results so only the curated catalog can fill the list.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

/** Hugging Face with nothing to add: empty search, a bare record for a model's details. */
function installEmptyHuggingFace(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/api/models/') && !url.pathname.includes('/tree/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      const body = { id, author: id.split('/')[0], downloads: 0, likes: 0, tags: ['gguf'], siblings: [] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
    }
    return { ok: true, status: 200, json: async () => [], text: async () => '[]' } as Response;
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

async function freshLaunch() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

// Each maker's curated model, as the shared catalog names it, and one model from another maker that
// must not be listed under it. A 16 GB phone has room for all of them.
const MAKERS: { chip: string; model: string; otherMaker: string }[] = [
  { chip: 'Liquid AI', model: 'LFM2.5 8B A1B', otherMaker: 'MiniCPM5 2B' },
  { chip: 'Llama', model: 'Muse Glimmer 30B', otherMaker: 'LFM2.5 8B A1B' },
  { chip: 'Mistral', model: 'Devstral Small 2 24B', otherMaker: 'LFM2.5 8B A1B' },
];

describe('Maker filters on the Models screen', () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it.each(MAKERS)('the $chip filter lists $model', async ({ chip, model, otherMaker }) => {
    installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 16 * GB, availBytes: 12 * GB } });
    restoreFetch = installEmptyHuggingFace();
    const React = require('react');
    const { render, fireEvent, waitFor, within } = requireRTL();
    await freshLaunch();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    const models = render(React.createElement(ModelsScreen));
    await waitFor(() => expect(models.getByTestId('device-picks')).toBeTruthy());

    // BEFORE: no maker chosen, both models are in the list.
    const list = () => within(models.getByTestId('models-list'));
    expect(list().getByText(model)).toBeTruthy();
    expect(list().getByText(otherMaker)).toBeTruthy();
    expect(models.queryByText(chip)).toBeNull();

    fireEvent.press(models.getByTestId('text-filter-toggle'));
    fireEvent.press(await waitFor(() => models.getByText(/^Org /)));
    fireEvent.press(await waitFor(() => models.getByText(chip)));

    // AFTER: the maker's curated model is listed; the other maker's is not.
    await waitFor(() => expect(list().queryByText(otherMaker)).toBeNull());
    expect(list().getByText(model)).toBeTruthy();
  });
});
