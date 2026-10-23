/**
 * One tap downloads everything a model needs, on one progress bar: every part of a split model, and
 * the MTP head of a model whose head is published separately.
 *
 * SPEC (the user's view):
 *  - A repo has a Q8_0 split into two parts. The sizes show it once, without a part number, sized as
 *    the whole model. One tap fetches both parts; the progress counts both; the model is downloaded
 *    only when both are on disk.
 *  - A Gemma 4 E4B upload's size has a published MTP head. One tap fetches the head and the weights;
 *    the progress counts both; the model is downloaded with the head beside it.
 *
 * Real ModelsScreen, startModelDownload, the download pipeline (backgroundDownloadService, stores) and
 * the Hugging Face service. Faked at the device line only: the network (the repo listing), the
 * in-memory disk and the native background downloader, whose completion events the test emits.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

type Sibling = { rfilename: string; size: number };

function serveRepo(modelId: string, siblings: Sibling[]): () => void {
  const originalFetch = globalThis.fetch;
  const listed = siblings.map(f => ({ ...f, lfs: { size: f.size } }));
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/tree/main')) {
      return { ok: true, status: 200, json: async () => listed.map(f => ({ type: 'file', path: f.rfilename, size: f.size, lfs: f.lfs })) } as Response;
    }
    if (url.pathname === '/api/models') {
      return { ok: true, status: 200, json: async () => [{ id: modelId, author: 'test', downloads: 1, likes: 0, tags: ['gguf'], siblings: [] }] } as Response;
    }
    if (url.pathname.startsWith('/api/models/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/models/'.length));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id, author: id.split('/')[0], downloads: 1, likes: 0, tags: ['gguf'],
          siblings: id === modelId && url.searchParams.get('blobs') === 'true' ? listed : [],
        }),
      } as Response;
    }
    throw new Error(`Unexpected network request: ${url.toString()}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

async function openRepo(query: string, repoName: string) {
  const React = require('react');
  const { render, fireEvent, waitFor } = requireRTL();
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  const models = render(React.createElement(ModelsScreen));
  fireEvent.changeText(models.getByTestId('search-input'), query);
  fireEvent(models.getByTestId('search-input'), 'submitEditing');
  fireEvent.press(await waitFor(() => models.getByText(repoName)));
  return models;
}

type Boundary = ReturnType<typeof installNativeBoundary>;

/** The device finishes a transfer: its bytes land at `path` and the downloader says so. */
async function finish(boundary: Boundary, fileName: string, path: string, bytes: number): Promise<void> {
  const { act, waitFor } = requireRTL();
  const row = await waitFor(() => {
    const found = boundary.download!.active().find(r => r.fileName === fileName);
    expect(found).toBeTruthy();
    return found!;
  });
  await act(async () => {
    boundary.download!.events.emit('DownloadProgress', {
      downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
      bytesDownloaded: bytes, totalBytes: bytes, status: 'running',
    });
  });
  await act(async () => {
    boundary.fs!.seedFile(path, bytes);
    boundary.download!.events.emit('DownloadComplete', {
      downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
      bytesDownloaded: bytes, totalBytes: bytes, status: 'completed', localUri: `file://${path}`,
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

/** The card's "done / total" caption. */
function shownBytes(models: { queryAllByText: (m: RegExp) => Array<{ props: { children?: unknown } }> }): string | null {
  const label = models.queryAllByText(/^\d+(\.\d+)? [MG]B \/ \d+(\.\d+)? [MG]B$/)[0];
  return label ? String(label.props.children) : null;
}

describe('one-tap download', () => {
  it('a split model downloads every part on one progress bar, and is downloaded only when all are in', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const PART1 = 'Split-Test-Q8_0-00001-of-00002.gguf';
    const PART2 = 'Split-Test-Q8_0-00002-of-00002.gguf';
    const restore = serveRepo('test/Split-Test-GGUF', [
      { rfilename: PART1, size: 300 * MB },
      { rfilename: PART2, size: 100 * MB },
    ]);
    try {
      const { fireEvent, waitFor } = requireRTL();
      const models = await openRepo('Split Test', 'Split-Test-GGUF');

      // One size, named without its part number, sized as the whole model.
      await waitFor(() => expect(models.getByText('Split-Test-Q8_0')).toBeTruthy());
      expect(models.queryByText(/00002-of-00002/)).toBeNull();
      expect(models.queryByTestId('file-card-1')).toBeNull();
      expect(models.getByText(/400(\.0+)? MB|0\.39 GB|0\.4 GB/)).toBeTruthy();

      fireEvent.press(models.getByTestId('file-card-0-download'));
      // The later part comes first; the bar counts it against the whole model.
      await finish(boundary, PART2, `/docs/models/${PART2}`, 100 * MB);
      await waitFor(() => expect(shownBytes(models)).toBe('100 MB / 400 MB'));
      expect(models.queryByTestId('file-card-0-delete')).toBeNull();

      await finish(boundary, PART1, `/docs/models/${PART1}`, 300 * MB);
      await waitFor(() => expect(models.getByTestId('file-card-0-delete')).toBeTruthy());
      expect(await boundary.fs!.exists(`/docs/models/${PART1}`)).toBe(true);
      expect(await boundary.fs!.exists(`/docs/models/${PART2}`)).toBe(true);
      // The downloaded model is the whole of it: every list that shows its size shows both parts.
      const { useAppStore } = require('../../../src/stores');
      const saved = useAppStore.getState().downloadedModels.find((m: { fileName: string }) => m.fileName === PART1);
      expect(saved?.fileSize).toBe(400 * MB);
      models.unmount();
    } finally {
      restore();
    }
  });

  it('a model with a published MTP head downloads the head with the weights, on one progress bar', async () => {
    const boundary = installNativeBoundary({ download: true, fs: true });
    const WEIGHTS = 'gemma-4-E4B-it-Q4_K_M.gguf';
    const WEIGHTS_BYTES = 64 * MB;
    const HEAD = 'mtp-gemma-4-E4B-it-Q8_0.gguf';
    const HEAD_BYTES = 98653248;
    const restore = serveRepo('test/Head-Test-GGUF', [{ rfilename: WEIGHTS, size: WEIGHTS_BYTES }]);
    try {
      const { fireEvent, waitFor } = requireRTL();
      const models = await openRepo('Head Test', 'Head-Test-GGUF');
      fireEvent.press(await waitFor(() => models.getByTestId('file-card-0-download')));

      // The head is fetched with its checksum, from its published place.
      const headRow = await waitFor(() => {
        const row = boundary.download!.active().find(r => r.fileName === HEAD) as { url?: string; sha256?: string; totalBytes: number } | undefined;
        expect(row).toBeTruthy();
        return row!;
      });
      expect(headRow.totalBytes).toBe(HEAD_BYTES);
      expect(headRow.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(headRow.url).toMatch(/^https:\/\/huggingface\.co\/.+\/mtp-gemma-4-E4B-it-Q8_0\.gguf$/);

      await finish(boundary, HEAD, `/docs/models/${HEAD}`, HEAD_BYTES);
      // The bar counts the head against the whole job: 94 MB of head + 64 MB of weights.
      await waitFor(() => expect(shownBytes(models)).toBe('94 MB / 158 MB'));
      expect(models.queryByTestId('file-card-0-delete')).toBeNull();

      await finish(boundary, WEIGHTS, `/docs/models/${WEIGHTS}`, WEIGHTS_BYTES);
      await waitFor(() => expect(models.getByTestId('file-card-0-delete')).toBeTruthy());
      expect(await boundary.fs!.exists(`/docs/models/${HEAD}`)).toBe(true);
      models.unmount();
    } finally {
      restore();
    }
  });
});
