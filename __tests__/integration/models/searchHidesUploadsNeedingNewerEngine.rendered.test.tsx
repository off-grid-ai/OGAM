/**
 * Models search does not offer a Hugging Face upload of a catalog model this engine cannot load.
 *
 * The catalog says K2 Horizon needs a newer llama.cpp than this app ships, so its catalog card is not
 * offered. A Hugging Face search for it must not offer it either, under its Hugging Face name: not the
 * catalog's own repo (IFM/K2-Horizon-3.7B-GGUF) and not another uploader's copy of the same model.
 * When the engine is new enough, the same search offers them.
 *
 * Real ModelsScreen, useTextModels, huggingFace service, shared search + catalog, memory budget,
 * stores. Fakes only at the device boundary: the RAM sensor, the file system, the engine's reported
 * llama.cpp build (llama.rn BuildInfo), and Hugging Face (fetch).
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

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

/** Hugging Face's search listing: ids only, no file sizes (siblings empty), as /api/models answers. */
const searchListing = (ids: string[]) =>
  ids.map(id => ({ id, author: id.split('/')[0], downloads: 10, likes: 0, tags: ['gguf'], siblings: [] }));

/** The llama.cpp build the engine reports about itself (llama.rn BuildInfo), read at the native leaf. */
function engineReportsBuild(number: string | undefined) {
  const llama = require('llama.rn');
  llama.BuildInfo = number === undefined ? undefined : { number, commit: 'test' };
}

/** The build this app ships: llama.rn's own version file. */
function shippedBuild(): string {
  const src: string = require('fs').readFileSync(require.resolve('llama.rn/src/version.ts'), 'utf8');
  return /BUILD_NUMBER = '(\d+)'/.exec(src)![1];
}

async function clearStorage() {
  const AsyncStorage =
    require('@react-native-async-storage/async-storage').default ??
    require('@react-native-async-storage/async-storage');
  await AsyncStorage.clear();
  const { hardwareService } = require('../../../src/services/hardware');
  await hardwareService.getDeviceInfo();
}

async function openModelsAndSearch(query: string) {
  const React = require('react');
  const { render, fireEvent } = requireRTL();
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  const models = render(React.createElement(ModelsScreen));
  const search = models.getByPlaceholderText('Search models');
  fireEvent.changeText(search, query);
  fireEvent(search, 'submitEditing');
  return models;
}

// The catalog's own repo for K2 Horizon 3.7B, another uploader's K2 Horizon 7B, and an unrelated
// model so an answered search is visible whatever the engine.
const CATALOG_REPO = 'IFM/K2-Horizon-3.7B-GGUF';
const OTHER_UPLOAD = 'bartowski/IFM_K2-Horizon-7B-GGUF';
const UNRELATED = 'someone/Horizon-Chat-1B-GGUF';

describe('Models search leaves out uploads of a model this engine cannot load', () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  it('a Hugging Face upload of K2 Horizon is offered only when the engine is new enough', async () => {
    const { CATALOG } = require('@offgrid/models');
    const needsNewer = CATALOG.find((e: { id: string }) => e.id === CATALOG_REPO);
    expect(needsNewer.minLlamaBuild).toBeGreaterThan(Number(shippedBuild()));

    const restoreFetches: (() => void)[] = [];
    restoreFetch = () => restoreFetches.reverse().forEach(r => r());
    const run = async (build: string | undefined) => {
      installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
      engineReportsBuild(build);
      restoreFetches.push(installHuggingFace(url =>
        url.pathname === '/api/models' ? searchListing([CATALOG_REPO, OTHER_UPLOAD, UNRELATED]) : undefined,
      ));
      await clearStorage();
      return openModelsAndSearch('horizon');
    };

    // A new enough engine: the search offers the catalog card and the other uploader's copy, and the
    // catalog's own repo is not listed twice under its Hugging Face name.
    const newer = await run(String(needsNewer.minLlamaBuild));
    let rtl = requireRTL();
    await rtl.waitFor(() => expect(newer.getByText('Horizon-Chat-1B-GGUF')).toBeTruthy());
    expect(newer.getByText('K2 Horizon 3.7B')).toBeTruthy();
    expect(newer.getByText('IFM_K2-Horizon-7B-GGUF')).toBeTruthy();
    expect(newer.queryByText('K2-Horizon-3.7B-GGUF')).toBeNull();
    newer.unmount();

    // The engine this app ships: neither the catalog card nor any Hugging Face upload of the model.
    const shipped = await run(shippedBuild());
    rtl = requireRTL();
    await rtl.waitFor(() => expect(shipped.getByText('Horizon-Chat-1B-GGUF')).toBeTruthy());
    expect(shipped.queryByText('K2 Horizon 3.7B')).toBeNull();
    expect(shipped.queryByText('K2-Horizon-3.7B-GGUF')).toBeNull();
    expect(shipped.queryByText('IFM_K2-Horizon-7B-GGUF')).toBeNull();
    shipped.unmount();

    // An engine that cannot say its build: still not offered.
    const unknown = await run(undefined);
    rtl = requireRTL();
    await rtl.waitFor(() => expect(unknown.getByText('Horizon-Chat-1B-GGUF')).toBeTruthy());
    expect(unknown.queryByText('K2-Horizon-3.7B-GGUF')).toBeNull();
    expect(unknown.queryByText('IFM_K2-Horizon-7B-GGUF')).toBeNull();
    unknown.unmount();
  });
});
