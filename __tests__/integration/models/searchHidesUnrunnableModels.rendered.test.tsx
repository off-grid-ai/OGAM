/**
 * Models search offers only models this phone can run as a chat model.
 *
 * The person types into the Text search on the Models screen and submits. What comes back is only
 * what they could download and chat with here:
 *  (a) a model Too big for this phone is left out, judged by its parameter count when Hugging Face's
 *      search answer carries no file sizes (the 8B that a 16 GB phone shows is not offered on 8 GB);
 *  (b) a catalog model that needs a newer llama.cpp build than this app's engine is left out, and is
 *      offered once the engine is new enough;
 *  (c) an image generator (Stable Diffusion, FLUX, SDXL) never shows in the chat search.
 *
 * Real ModelsScreen, useTextModels, huggingFace service, shared catalog + offer rules, memory budget,
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

describe('Models search leaves out what this phone cannot run', () => {
  let restoreFetch: () => void = () => {};
  afterEach(() => restoreFetch());

  const BIG = 'someone/Demo-Chat-8B-GGUF';
  const SMALL = 'someone/Demo-Chat-1B-GGUF';

  it.each([
    { phone: '8 GB', totalBytes: 8 * GB, bigShown: false },
    { phone: '16 GB', totalBytes: 16 * GB, bigShown: true },
  ])('a $phone phone: an 8B search result with no file sizes is offered only when it fits', async ({ totalBytes, bigShown }) => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes, availBytes: totalBytes / 2 } });
    restoreFetch = installHuggingFace(url =>
      url.pathname === '/api/models' ? searchListing([BIG, SMALL]) : undefined,
    );
    const { waitFor } = requireRTL();
    await clearStorage();

    const models = await openModelsAndSearch('demo-chat');

    // The search answered: the 1B fits every phone and is listed.
    await waitFor(() => expect(models.getByText('Demo-Chat-1B-GGUF')).toBeTruthy());
    if (bigShown) {
      expect(models.getByText('Demo-Chat-8B-GGUF')).toBeTruthy();
    } else {
      expect(models.queryByText('Demo-Chat-8B-GGUF')).toBeNull();
    }
  });

  it('a catalog model that needs a newer llama.cpp than the engine is not offered; a new enough engine offers it', async () => {
    const restoreFetches: (() => void)[] = [];
    const { CATALOG } = require('@offgrid/models');
    const needsNewer = CATALOG.find((e: { name: string }) => e.name === 'K2 Horizon 3.7B');
    expect(needsNewer.minLlamaBuild).toBeGreaterThan(Number(shippedBuild()));

    // Engine reports a build: first the one this app ships, then (another install) one new enough.
    const run = async (build: string | undefined) => {
      installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
      engineReportsBuild(build);
      // Hugging Face answers the search with an unrelated model, so an answered search is visible.
      restoreFetches.push(installHuggingFace(url =>
        url.pathname === '/api/models' ? searchListing(['someone/Horizon-Chat-1B-GGUF']) : undefined,
      ));
      await clearStorage();
      return openModelsAndSearch('horizon');
    };
    restoreFetch = () => restoreFetches.reverse().forEach(r => r());

    const { waitFor } = requireRTL();

    // A new enough engine: the search finds it (proves the search reaches it at all).
    const newer = await run(String(needsNewer.minLlamaBuild));
    await waitFor(() => expect(newer.getByText('Horizon-Chat-1B-GGUF')).toBeTruthy());
    expect(newer.getByText('K2 Horizon 3.7B')).toBeTruthy();
    newer.unmount();

    // The engine this app ships: the same search does not offer it.
    const shipped = await run(shippedBuild());
    const rtl = requireRTL();
    await rtl.waitFor(() => expect(shipped.getByText('Horizon-Chat-1B-GGUF')).toBeTruthy());
    expect(shipped.queryByText('K2 Horizon 3.7B')).toBeNull();
    expect(shipped.queryByText('K2 Horizon 7B')).toBeNull();
    shipped.unmount();

    // An engine that cannot say its build: still not offered.
    const unknown = await run(undefined);
    await rtl.waitFor(() => expect(unknown.getByText('Horizon-Chat-1B-GGUF')).toBeTruthy());
    expect(unknown.queryByText('K2 Horizon 3.7B')).toBeNull();
    unknown.unmount();
  });

  it('the chat search does not list image generators', async () => {
    installNativeBoundary({ fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
    restoreFetch = installHuggingFace(url =>
      url.pathname === '/api/models'
        ? searchListing([
          'second-state/stable-diffusion-v1-5-GGUF',
          'city96/FLUX.1-schnell-gguf',
          'someone/sdxl-turbo-GGUF',
          'someone/Diffusion-Chat-3B-GGUF',
        ])
        : undefined,
    );
    const { waitFor } = requireRTL();
    await clearStorage();

    const models = await openModelsAndSearch('diffusion');

    // The search answered with its chat model ...
    await waitFor(() => expect(models.getByText('Diffusion-Chat-3B-GGUF')).toBeTruthy());
    // ... and none of the image generators it also returned.
    expect(models.queryByText('stable-diffusion-v1-5-GGUF')).toBeNull();
    expect(models.queryByText('FLUX.1-schnell-gguf')).toBeNull();
    expect(models.queryByText('sdxl-turbo-GGUF')).toBeNull();
  });
});
