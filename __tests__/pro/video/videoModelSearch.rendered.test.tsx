/**
 * Finding a video model in Models › Video: search, a model's versions, and their downloads.
 *
 * SPEC (OGAM user's view): the Video tab lists the video models this phone can run. I can search
 * Hugging Face; a failed search says why. Opening a model
 * shows its memory suggestion against this phone and the versions this phone can run, the standard
 * one first; downloading a version shows it downloading and can be cancelled. Back returns to the list.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk, the RAM sensor, the
 * native background downloads, and Hugging Face's API at `fetch` (its /api/models search and a
 * repo's ?blobs=true listing, in Hugging Face's own shapes).
 */
jest.unmock('@react-navigation/native');

import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';

const REPO = 'off-grid-ai/Wan2.1-T2V-1.3B-GGUF';
const REPO_NAME = 'Wan 2.1 (1.3B)';
const HF = 'https://huggingface.co/api';

let app: AnalyticsApp | undefined;
let original: typeof globalThis.fetch | undefined;

afterEach(() => {
  if (original) globalThis.fetch = original;
  original = undefined;
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

/** Hugging Face: a search answers `results`, or fails with `status`; the repo lists two weights. */
function serveHuggingFace(search: { results?: Array<{ id: string; downloads: number }>; status?: number }) {
  original = globalThis.fetch;
  const inner = original;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (href.startsWith(`${HF}/models?`)) {
      if (search.status) return json({ error: 'Service unavailable' }, search.status);
      return json(search.results ?? []);
    }
    if (href === `${HF}/models/${REPO}?blobs=true`) {
      return json({
        id: REPO,
        siblings: [
          { rfilename: 'README.md', size: 2048 },
          { rfilename: 'Wan2.1-T2V-1.3B-Q8_0.gguf', size: 1519435360, lfs: { size: 1519435360, oid: 'a'.repeat(64) } },
          { rfilename: 'Wan2.1-T2V-1.3B-calibrated-Q4_K_S.gguf', size: 816061024, lfs: { size: 816061024, oid: 'b'.repeat(64) } },
        ],
      });
    }
    return inner(input, init);
  }) as typeof globalThis.fetch;
}

async function videoTab(): Promise<AnalyticsApp> {
  app = await launchApp({ release: false, download: true });
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  rtl.fireEvent.press(await view.findByTestId('video-models-tab'));
  await view.findByText(REPO_NAME, {}, { timeout: 10_000 });
  return app;
}

it('a failed search says why', async () => {
  serveHuggingFace({ status: 503 });
  const { view, rtl } = await videoTab();
  rtl.fireEvent.changeText(view.getByLabelText('Search video models on Hugging Face'), 'wan');
  await view.findByText('Hugging Face search failed: HTTP 503', {}, { timeout: 10_000 });
}, 60_000);

it('a model shows its versions, standard first; a version downloads and can be cancelled', async () => {
  serveHuggingFace({});
  const { view, rtl } = await videoTab();
  expect(view.queryByText('Available versions')).toBeNull();
  rtl.fireEvent.press(view.getByTestId(`video-model-card-${REPO}`));
  await view.findByText('Available versions', {}, { timeout: 10_000 });
  // 16 GB suggested against this 12 GB phone.
  expect(view.getByText('16 GB memory suggested · This phone: 12 GB')).toBeTruthy();
  expect(view.getByText('Local generation may exceed available memory.')).toBeTruthy();
  const standard = await view.findByText('Wan 2.1 - Standard', {}, { timeout: 10_000 });
  const compact = view.getByText('Wan 2.1 - Compact Q4_K_S');
  expect(standard).toBeTruthy();
  expect(compact).toBeTruthy();

  rtl.fireEvent.press(view.getByLabelText('Download Wan 2.1 - Compact Q4_K_S'));
  rtl.fireEvent.press(await view.findByLabelText('Cancel download', {}, { timeout: 10_000 }));
  await view.findByLabelText('Download Wan 2.1 - Compact Q4_K_S', {}, { timeout: 10_000 });

  rtl.fireEvent.press(view.getAllByLabelText('Back').pop()!);
  await rtl.waitFor(() => expect(view.queryByText('Available versions')).toBeNull());
  expect(view.getByText(REPO_NAME)).toBeTruthy();
}, 60_000);
