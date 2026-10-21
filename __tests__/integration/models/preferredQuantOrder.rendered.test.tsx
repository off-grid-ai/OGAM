/**
 * UI integration — which quant a model's detail offers first: the "Recommended" size, and the head
 * of the full list behind "All files".
 *
 * Real ModelsScreen (search → detail), real huggingFaceService, real catalog-file preference and the
 * shared @offgrid/models rule. Faked only at the boundaries: the Hugging Face network (global fetch,
 * answering by URL path only — it decides nothing about quants), the native downloader, the disk and
 * the RAM sensor.
 *
 * Product rule pinned: an Android phone on the CPU (or the NPU) gets Q4_0 first when the repo has it
 * (llama.cpp repacks Q4_0 for ARM; HTP runs it natively). On the GPU, and on iOS, Q4_K_M comes first.
 * A repo without Q4_0 still offers Q4_K_M first.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const REPO = 'org/Qwen3-1.7B-GGUF';
const FILES = [
  { path: 'Qwen3-1.7B-Q4_0.gguf', size: 1.05 * GB },
  { path: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1.1 * GB },
  { path: 'Qwen3-1.7B-Q8_0.gguf', size: 1.8 * GB },
  { path: 'Qwen3-1.7B-Q6_K.gguf', size: 1.4 * GB },
];

/** Hugging Face's API, answered by path. */
function installHuggingFace(files: typeof FILES): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => body }) as Response;
    if (url.hostname !== 'huggingface.co') return json({}, 404);
    const siblings = files.map(f => ({ rfilename: f.path, size: f.size }));
    const repo = { id: REPO, modelId: REPO, author: 'org', downloads: 1000, likes: 10, tags: ['gguf'], siblings };
    if (/^\/api\/models\/.+\/tree\/[^/]+$/.test(url.pathname)) {
      return json(files.map(f => ({ type: 'file', path: f.path, size: f.size, lfs: { size: f.size } })));
    }
    if (url.pathname === '/api/models') return json(url.searchParams.get('search') ? [repo] : []);
    if (url.pathname.startsWith('/api/models/')) return json(repo);
    return json({}, 404);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

let restoreFetch: () => void = () => {};
afterEach(() => restoreFetch());

/** Search for the repo, open it, and return the file the "Recommended" size card names, and every
 *  file name in the order the "All files" list shows them. */
async function openDetailFileOrder(opts: { platform: 'android' | 'ios'; files?: typeof FILES; pickGpu?: boolean }): Promise<{ recommended: string; order: string[] }> {
  installNativeBoundary({ download: true, fs: true, ram: { platform: opts.platform, totalBytes: 12 * GB, availBytes: 8 * GB } });
  restoreFetch = installHuggingFace(opts.files ?? FILES);
  const React = require('react');
  const { render, fireEvent, waitFor, act, within } = requireRTL();
  const { hardwareService } = require('../../../src/services/hardware');
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  await hardwareService.refreshMemoryInfo();

  if (opts.pickGpu) {
    // The user picked the GPU in settings before browsing.
    const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const settings = render(React.createElement(BackendSelector, {}));
    fireEvent.press(settings.getByTestId('backend-opencl-button'));
    await waitFor(() => expect(settings.queryByText('GPU Layers (OpenCL)')).not.toBeNull());
    settings.unmount();
  }

  const view = render(React.createElement(ModelsScreen, {}));
  await act(async () => { fireEvent.changeText(view.getByTestId('search-input'), 'qwen3'); });
  await act(async () => {
    fireEvent(view.getByTestId('search-input'), 'submitEditing');
    await new Promise(r => setTimeout(r, 600));
  });
  const card = await waitFor(() => view.getByText(/Qwen3-1\.7B/), { timeout: 6000 });
  await act(async () => { fireEvent.press(card); });
  await waitFor(() => expect(view.getByTestId('model-detail-screen')).toBeTruthy(), { timeout: 4000 });
  // The sizes in words: the Recommended card names the preferred file.
  const recommendedCard = await waitFor(() => {
    const cards = view.queryAllByTestId(/^file-card-\d+$/).filter(fileCard => within(fileCard).queryByText(/· Recommended/));
    expect(cards).toHaveLength(1);
    return cards[0];
  }, { timeout: 4000 });
  const recommended = String(within(recommendedCard).getByText(/^Qwen3-1\.7B-Q/).props.children);
  // All files: every file, in the phone's order.
  await act(async () => { fireEvent.press(view.getByTestId('all-files-toggle')); });
  await waitFor(() => expect(view.queryAllByText(/^Qwen3-1\.7B-Q/).length).toBe((opts.files ?? FILES).length), { timeout: 4000 });
  return { recommended, order: view.queryAllByText(/^Qwen3-1\.7B-Q/).map(node => String(node.props.children)) };
}

describe('Model detail: the preferred quant is Recommended and comes first', () => {
  it('Android on the CPU: Q4_0 first', async () => {
    const { recommended, order } = await openDetailFileOrder({ platform: 'android' });
    expect(recommended).toBe('Qwen3-1.7B-Q4_0');
    expect(order[0]).toBe('Qwen3-1.7B-Q4_0');
  }, 30000);

  it('Android on the GPU: Q4_K_M first', async () => {
    const { recommended, order } = await openDetailFileOrder({ platform: 'android', pickGpu: true });
    expect(recommended).toBe('Qwen3-1.7B-Q4_K_M');
    expect(order[0]).toBe('Qwen3-1.7B-Q4_K_M');
  }, 30000);

  it('iOS: Q4_K_M first', async () => {
    const { recommended, order } = await openDetailFileOrder({ platform: 'ios' });
    expect(recommended).toBe('Qwen3-1.7B-Q4_K_M');
    expect(order[0]).toBe('Qwen3-1.7B-Q4_K_M');
  }, 30000);

  it('Android on the CPU, a repo without Q4_0: Q4_K_M first', async () => {
    const { recommended, order } = await openDetailFileOrder({ platform: 'android', files: FILES.filter(f => !f.path.includes('Q4_0')) });
    expect(recommended).toBe('Qwen3-1.7B-Q4_K_M');
    expect(order[0]).toBe('Qwen3-1.7B-Q4_K_M');
  }, 30000);
});
