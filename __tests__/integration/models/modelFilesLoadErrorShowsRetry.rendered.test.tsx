/**
 * RENDERED (UI integration) — model-detail "Available Files" shows a RETRY state when the
 * file-list fetch fails, not the misleading "No compatible files found".
 *
 * REGRESSION exposed by the HF/AWS outage: tapping a model when HuggingFace is unreachable left
 * the "Available Files" area either spinning forever (no request timeout) or — once the fetch
 * failed — showing "No compatible files found for this model.", which blames the model when the
 * truth is the network failed.
 *
 * SPEC (OGAM user's view): when the file list can't be fetched, the detail screen says so plainly
 * ("Couldn't load files. Check your connection.") and offers a Retry that re-runs the fetch. A
 * successful retry then renders the files. "No compatible files found" is reserved for a fetch that
 * SUCCEEDED but returned nothing that fits.
 *
 * Boundary fakes only: native download + fs + RAM (installNativeBoundary) and global fetch (the
 * HuggingFace transport). The real huggingFaceService, screen, useTextModels hook,
 * handleSelectModel, timeout/fail-fast behavior, and filesLoadError state machine all run.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/retry-model';
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('model detail Available Files — fetch failure shows Retry, success renders files', () => {
  it('shows the retry state on a failed file-list fetch, then renders files after Retry', async () => {
    const hfModel = {
      id: MODEL_ID,
      author: 'org',
      downloads: 50,
      likes: 1,
      tags: ['gguf'],
      lastModified: '',
      siblings: [],
    };
    let fileListAttempts = 0;

    // Fake the external HTTP transport, not our HuggingFace service. Search succeeds. The first
    // tree request fails as an aborted request (the real 5s-timeout shape), and Retry succeeds.
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/models?')) {
        return {
          ok: true,
          json: async () => (url.includes('search=retry') ? [hfModel] : []),
        } as Response;
      }
      if (url.endsWith(`/models/${MODEL_ID}/tree/main`)) {
        fileListAttempts += 1;
        if (fileListAttempts === 1) {
          const aborted = new Error('network request timed out');
          aborted.name = 'AbortError';
          throw aborted;
        }
        return {
          ok: true,
          json: async () => [
            { type: 'file', path: 'model-Q4_K_M.gguf', size: 2 * GB },
          ],
        } as Response;
      }
      const modelId = decodeURIComponent(
        url.split('/models/')[1] || 'org/unknown',
      );
      return {
        ok: true,
        json: async () => ({ ...hfModel, id: modelId }),
      } as Response;
    }) as typeof fetch;

    const { rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
    });
    const { fireEvent, waitFor, act } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());

    // Arrive at the model's detail the way a user does: search, submit, tap the result.
    await act(async () => {
      fireEvent.changeText(view.getByTestId('search-input'), 'retry');
    });
    await act(async () => {
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(r => setTimeout(r, 600));
    });
    await waitFor(() => expect(view.getByText('retry-model')).toBeTruthy(), {
      timeout: 6000,
    });
    await act(async () => {
      fireEvent.press(view.getByText('retry-model'));
    });

    // The first file-list fetch failed → the RETRY state renders, NOT "No compatible files found".
    await waitFor(
      () => expect(view.getByTestId('model-files-load-error')).toBeTruthy(),
      { timeout: 4000 },
    );
    expect(view.getByText(/Couldn't load files/)).toBeTruthy();
    expect(
      view.queryByText('No compatible files found for this model.'),
    ).toBeNull();

    // Tapping Retry re-runs the fetch — which now succeeds — and the file renders.
    await act(async () => {
      fireEvent.press(view.getByTestId('model-files-retry'));
    });
    await waitFor(() => expect(view.getByText('model-Q4_K_M')).toBeTruthy(), {
      timeout: 4000,
    });
    expect(view.queryByTestId('model-files-load-error')).toBeNull();
  }, 30000);
});
