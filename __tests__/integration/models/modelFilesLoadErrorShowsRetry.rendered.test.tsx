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
 * Boundary fakes only: native download + fs + RAM (installNativeBoundary) and the HuggingFace
 * network wrapper (searchModels returns the model; getModelFiles fails the first attempt, succeeds
 * the second). The screen, the useTextModels hook, handleSelectModel, and the real filesLoadError
 * state machine all run REAL.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/retry-model';

describe('model detail Available Files — fetch failure shows Retry, success renders files', () => {
  it('shows the retry state on a failed file-list fetch, then renders files after Retry', async () => {
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB } });

    const okFile = { name: 'model-Q4_K_M.gguf', size: 2 * GB, quantization: 'Q4_K_M', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q4_K_M.gguf` };
    const modelInfo = { id: MODEL_ID, name: 'Retry Model', author: 'org', description: 'test', downloads: 50, likes: 1, tags: [], lastModified: '', files: [] };
    // Per-id attempt counter: FIRST getModelFiles for this model fails (network down), the retry
    // succeeds. Robust to any prefetch of other model ids.
    const attempts: Record<string, number> = {};
    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        searchModels: jest.fn(async () => [modelInfo]),
        getModelDetails: jest.fn(async () => modelInfo),
        getModelFiles: jest.fn(async (id: string) => {
          attempts[id] = (attempts[id] || 0) + 1;
          if (id === MODEL_ID && attempts[id] === 1) throw new Error('network down');
          return [okFile];
        }),
        getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
        formatModelSize: jest.fn(() => '2.0 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(1)} GB`),
      },
    }));

    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    await hardwareService.refreshMemoryInfo();

    const { getByTestId, getByText, queryByText, queryByTestId } = render(React.createElement(ModelsScreen, {}));

    // Arrive at the model's detail the way a user does: search, submit, tap the result.
    await act(async () => { fireEvent.changeText(getByTestId('search-input'), 'retry'); });
    await act(async () => {
      fireEvent(getByTestId('search-input'), 'submitEditing');
      await new Promise((r) => setTimeout(r, 600));
    });
    await waitFor(() => expect(getByText('Retry Model')).toBeTruthy(), { timeout: 6000 });
    await act(async () => { fireEvent.press(getByText('Retry Model')); });

    // The first file-list fetch failed → the RETRY state renders, NOT "No compatible files found".
    await waitFor(() => expect(getByTestId('model-files-load-error')).toBeTruthy(), { timeout: 4000 });
    expect(getByText(/Couldn't load files/)).toBeTruthy();
    expect(queryByText('No compatible files found for this model.')).toBeNull();

    // Tapping Retry re-runs the fetch — which now succeeds — and the file renders.
    await act(async () => { fireEvent.press(getByTestId('model-files-retry')); });
    await waitFor(() => expect(getByText('model-Q4_K_M')).toBeTruthy(), { timeout: 4000 });
    expect(queryByTestId('model-files-load-error')).toBeNull();
  }, 30000);
});
