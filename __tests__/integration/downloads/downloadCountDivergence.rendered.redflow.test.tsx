/**
 * RED-FLOW (UI, rendered) — T001 / DEV-B7: the downloads BADGE count (ModelsScreen) diverges from the
 * Download Manager's active count when a download has FAILED while others are in flight (incl. a vision
 * model whose mmproj sidecar is downloading — the device's "mmproj in flight, multiple downloads" state).
 *
 * ROOT (a DRY / single-source-of-truth break): "how many downloads are active" is computed in TWO places
 * with TWO definitions — ModelsScreen's badge uses `isActiveStatus` (useModelsScreen.ts), which DROPS
 * 'failed'; the Download Manager's `startedItems` (useDownloadManager.ts, `status !== 'completed' &&
 * !== 'cancelled'`) KEEPS it. Same "how many downloads" question asked on two screens, two answers.
 *
 * Real stack over the native-download + FS fakes: seed native rows (a device-boundary leaf — what the OS
 * DownloadManager reports), run the REAL hydrateDownloadStore, mount the REAL screens, assert the two
 * RENDERED numbers agree. RED on HEAD: badge = 3 (drops the failed one) vs DM active = 4 (keeps it) — the
 * same off-by-one the device saw. Falsify: flip the failed row to 'running' → both = 4 → green.
 *
 * NOTE on scope: the device's exact trigger was an mmproj-concurrency-timing artifact (hard to reproduce
 * deterministically); this pins the SAME root (divergent count definitions) deterministically via the
 * 'failed' divergence, and includes the vision+mmproj rows to confirm the vision entry itself counts
 * CONSISTENTLY (it is the failed row that diverges, not the mmproj).
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

describe('T001 (rendered) — download badge vs Download Manager active count', () => {
  it('shows the SAME active-download count on the badge and the Download Manager', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, waitFor } = requireRTL();
    const { hydrateDownloadStore } = require('../../../src/services/downloadHydration');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const { DownloadManagerScreen } = require('../../../src/screens/DownloadManagerScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // Device condition: two text models in flight + a vision model (main + mmproj sidecar, folded into ONE
    // store entry via mmProjDownloadId) + ONE model that FAILED (a network drop while others continued).
    // These are real native rows the OS reports; hydrateDownloadStore (our real code) maps them to the store.
    boundary.download!.seedActive({ downloadId: 'dl-a', fileName: 'llama-q4.gguf', modelId: 'meta/llama', modelType: 'text', status: 'running', bytesDownloaded: 100 * MB, totalBytes: 3000 * MB });
    boundary.download!.seedActive({ downloadId: 'dl-b', fileName: 'mistral-q4.gguf', modelId: 'mistral/mistral', modelType: 'text', status: 'running', bytesDownloaded: 50 * MB, totalBytes: 4000 * MB });
    boundary.download!.seedActive({ downloadId: 'dl-v', fileName: 'SmolVLM-Instruct-Q4_K_M.gguf', modelId: 'HuggingFaceTB/SmolVLM', modelType: 'text', status: 'running', bytesDownloaded: 200 * MB, totalBytes: 1500 * MB, ...( { mmProjDownloadId: 'dl-v-mm' } as Record<string, unknown>) });
    boundary.download!.seedActive({ downloadId: 'dl-v-mm', fileName: 'SmolVLM-Instruct-mmproj.gguf', modelId: 'HuggingFaceTB/SmolVLM', modelType: 'text', status: 'running', bytesDownloaded: 90 * MB, totalBytes: 190 * MB });
    boundary.download!.seedActive({ downloadId: 'dl-c', fileName: 'qwen-q4.gguf', modelId: 'Qwen/Qwen', modelType: 'text', status: 'failed', bytesDownloaded: 10 * MB, totalBytes: 2000 * MB });
    await hydrateDownloadStore();

    // BADGE — the number a user sees on the real ModelsScreen (renders only when count > 0).
    const models = render(React.createElement(ModelsScreen, {}));
    let badge = NaN;
    await waitFor(() => {
      badge = Number(models.getByTestId('downloads-badge-count').props.children);
      expect(Number.isNaN(badge)).toBe(false);
    });
    models.unmount();

    // ACTIVE COUNT — the number a user sees on the real Download Manager, reading the SAME store.
    const dm = render(React.createElement(DownloadManagerScreen, {}));
    await waitFor(() => { expect(dm.queryByText('Download Manager')).not.toBeNull(); });
    const downloading = Number(dm.getByTestId('dm-active-downloading-count').props.children);
    const queuedEl = dm.queryByTestId('dm-active-queued-count');
    const queued = queuedEl ? Number(String(queuedEl.props.children).match(/\d+/)?.[0] ?? '0') : 0;
    const failedEl = dm.queryByTestId('dm-active-failed-count');
    const failed = failedEl ? Number(String(failedEl.props.children).match(/\d+/)?.[0] ?? '0') : 0;

    // SPEC (device 2026-07-15): the badge counts OUTSTANDING download work — downloading + queued +
    // failed/retriable — and the Download Manager surfaces the same three, so the two agree. A failed
    // download must be visible on the badge (it needs a retry/remove), not silently dropped.
    expect(badge).toBe(downloading + queued + failed);
  });
});
