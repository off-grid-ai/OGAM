/**
 * useImageModels.searchDeadline.test.ts
 *
 * An image model search that never answers ends at SD_SEARCH_DEADLINE_MS with a line, not a spinner
 * that turns forever (hand test 19). Only the device boundary and the network edge (global fetch) are
 * faked; the hook, huggingFaceModelBrowser and the stores run for real.
 *
 * - a held search: the spinner runs until the deadline, then ends with "Search took too long ..."
 * - a search that fails before the deadline keeps its own message (not the deadline line)
 */
import {
  installNativeBoundary,
  requireRTL,
  GB,
} from '../../../harness/nativeBoundary';
import { serveHfImageCatalog, type HfImageCatalogServer } from '../../../harness/hfImageCatalogServer';

jest.unmock('@react-navigation/native');

const DEADLINE_LINE = 'Search took too long. Check your connection and try again.';
const SEARCH = /^https:\/\/huggingface\.co\/api\/models\?/;

let server: HfImageCatalogServer | undefined;
let catalogFetch: typeof globalThis.fetch | undefined;
afterEach(() => {
  jest.useRealTimers();
  if (catalogFetch) globalThis.fetch = catalogFetch;
  catalogFetch = undefined;
  server?.restore();
  server = undefined;
});

/** Hugging Face search answers the way `answer` says; every other request goes to the catalog server. */
function serveSearch(answer: (signal: AbortSignal | undefined) => Promise<Response>) {
  catalogFetch = globalThis.fetch;
  const passThrough = catalogFetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return SEARCH.test(url) ? answer(init?.signal ?? undefined) : passThrough(input, init);
  }) as typeof globalThis.fetch;
}

/** A request that never answers; like a real fetch, it rejects when its signal aborts. */
const neverAnswers = (signal: AbortSignal | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
  });

async function mount() {
  installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB }, fs: true, download: true });
  server = serveHfImageCatalog({});
  const rtl = requireRTL();
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  await (AsyncStorage.default ?? AsyncStorage).clear();
  const services = require('../../../../src/services');
  await services.hardwareService.getDeviceInfo();
  const { useImageModels, SD_SEARCH_DEADLINE_MS } = require('../../../../src/screens/ModelsScreen/useImageModels');
  const view = rtl.renderHook(() => useImageModels(() => {}));
  await rtl.waitFor(() => expect(view.result.current.imageRec).not.toBeNull());
  return { rtl, result: view.result, deadlineMs: SD_SEARCH_DEADLINE_MS as number };
}

describe('image model search deadline', () => {
  it('a search that never answers ends at the deadline with a line, not a spinner', async () => {
    const m = await mount();
    serveSearch(neverAnswers);
    jest.useFakeTimers();

    m.rtl.act(() => { m.result.current.setImageSearchQuery('flux'); });
    await m.rtl.act(async () => { jest.advanceTimersByTime(300); });
    expect(m.result.current.hfModelsLoading).toBe(true);

    // Just before the deadline the search is still running and says nothing.
    await m.rtl.act(async () => { jest.advanceTimersByTime(m.deadlineMs - 300 - 1); });
    expect(m.result.current.hfModelsLoading).toBe(true);
    expect(m.result.current.hfModelsError).toBeNull();

    await m.rtl.act(async () => { jest.advanceTimersByTime(1); });
    await m.rtl.waitFor(() => expect(m.result.current.hfModelsLoading).toBe(false));
    expect(m.result.current.hfModelsError).toBe(DEADLINE_LINE);
  });

  it('a search that fails before the deadline keeps its own message', async () => {
    const m = await mount();
    serveSearch(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 }));
    jest.useFakeTimers();

    m.rtl.act(() => { m.result.current.setImageSearchQuery('flux'); });
    await m.rtl.act(async () => { jest.advanceTimersByTime(300); });
    await m.rtl.waitFor(() => expect(m.result.current.hfModelsLoading).toBe(false));

    expect(m.result.current.hfModelsError).toBe('Hugging Face search failed: HTTP 500');
    expect(m.result.current.hfModelsError).not.toBe(DEADLINE_LINE);
  });
});
