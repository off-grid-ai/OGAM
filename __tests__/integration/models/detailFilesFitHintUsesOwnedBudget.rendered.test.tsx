/**
 * Detail "Available Files" device-fit list — the single owned budget (memoryBudget.fitTier).
 *
 * SPEC (the OGAM user's view): in a model's detail view, the "Available Files" list offers every LOADABLE
 * quant (fitTier !== 'wontFit' — down to the aggressive ceiling, since the load path can reach it via
 * reclaim credit + Load Anyway) and hides only the genuinely-too-big ones. That decision is the ONE owned
 * primitive `fitTier`, never a hand-rolled copy that could drift from the browse-list / picker copies.
 *
 * This mounts the REAL ModelsScreen, arrives at a model's detail via a real search+tap, and asserts the
 * rendered file list against `fitTier`'s verdict per file: a loadable quant renders, a 'wontFit' quant is
 * absent. Boundary fakes only: native download + fs + RAM (installNativeBoundary) and the HuggingFace
 * network transport. The budget math, screen, hooks, ModelCard all run REAL.
 *
 * Falsification (DRY): the expected present/absent set is computed from `fitTier` itself, so if a caller's
 * inline copy of the formula drifts from the owner, the rendered list stops matching and this test reds.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/fit-hint';

describe('detail Available Files fit hint matches the owned fileExceedsBudget verdict (rendered)', () => {
  it('offers every loadable quant (fitTier !== wontFit) — hides only the genuinely-too-big one', async () => {
    // Device: a 6GB Android phone → budget = 6 * modelBudgetFraction(6)=0.60 = 3.6GB.
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 4 * GB } });

    // Two quant files straddling the budget: a 2GB (fits) and a 5GB (exceeds).
    const fitFile = { name: 'model-Q4_K_M.gguf', size: 2 * GB, quantization: 'Q4_K_M', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q4_K_M.gguf` };
    const bigFile = { name: 'model-Q8_0.gguf', size: 5 * GB, quantization: 'Q8_0', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q8_0.gguf` };
    const modelInfo = { id: MODEL_ID, name: 'Fit Hint Model', author: 'org', description: 'test', downloads: 50, likes: 1, tags: [], lastModified: '', files: [fitFile, bigFile] };
    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        searchModels: jest.fn(async () => [modelInfo]),
        getModelFiles: jest.fn(async () => [fitFile, bigFile]),
        getModelDetails: jest.fn(async () => modelInfo),
        getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
        formatModelSize: jest.fn(() => '2.0 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(1)} GB`),
      },
    }));

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { fitTier } = require('../../../src/services/memoryBudget');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await hardwareService.refreshMemoryInfo();
    const ramGB = hardwareService.getTotalMemoryGB();

    // The list now offers every LOADABLE quant (fitTier !== 'wontFit', up to the aggressive ceiling)
    // and hides only the genuinely-too-big ones. On 6GB the aggressive ceiling is 4.5GB: 2GB is loadable,
    // 5GB is past it → 'wontFit'.
    expect(fitTier(fitFile.size, ramGB)).not.toBe('wontFit'); // loadable → must render
    expect(fitTier(bigFile.size, ramGB)).toBe('wontFit');     // past aggressive ceiling → hidden

    const utils = render(React.createElement(ModelsScreen, {}));
    const { getByTestId, getByText, queryByText } = utils;

    await act(async () => { fireEvent.changeText(getByTestId('search-input'), 'fit'); });
    await act(async () => {
      fireEvent(getByTestId('search-input'), 'submitEditing');
      await new Promise((r) => setTimeout(r, 600));
    });
    await waitFor(() => expect(getByText('Fit Hint Model')).toBeTruthy(), { timeout: 6000 });
    await act(async () => { fireEvent.press(getByText('Fit Hint Model')); });
    await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy(), { timeout: 4000 });

    // Wait for the files to load (the fitting file card renders).
    await waitFor(() => expect(getByText('model-Q4_K_M')).toBeTruthy(), { timeout: 4000 });

    // TERMINAL artifact: the list offers the under-budget quant and HIDES the over-budget one —
    // exactly the fileExceedsBudget verdict. (Display names strip the .gguf extension.)
    expect(queryByText('model-Q4_K_M')).not.toBeNull();
    expect(queryByText('model-Q8_0')).toBeNull();
  }, 30000);

  it('BOUNDARY: a file EXACTLY at the aggressive ceiling is Won\'t-fit (hidden), one just under is loadable (shown)', async () => {
    // The list hides only 'wontFit' — files past the AGGRESSIVE ceiling (fitTier's `size < ceil`). Pin
    // that boundary on a device where the ceiling is a WHOLE number of bytes: 8GB × aggressive 0.75 =
    // EXACTLY 6.0 GB. A file of EXACTLY 6.0GB is 'wontFit' (not `< ceil`) → HIDDEN; 6.0GB−1byte is 'tight'
    // → SHOWN. Flipping fitTier's `<` to `<=` would make the exact-ceiling file 'tight'/shown → red.
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 5 * GB } });

    /* eslint-disable @typescript-eslint/no-var-requires */
    const { modelBudgetFraction } = require('../../../src/services/memoryBudget');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const ceilBytes = 8 * modelBudgetFraction(8, 'android', 'aggressive') * GB; // 8 × 0.75 × GB = exactly 6.0 GB (integer bytes)
    const atCeiling = { name: 'model-atceiling.gguf', size: ceilBytes, quantization: 'Q6', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-atceiling.gguf` };
    const underCeiling = { name: 'model-under.gguf', size: ceilBytes - 1, quantization: 'Q5', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-under.gguf` };
    const modelInfo = { id: MODEL_ID, name: 'Boundary Model', author: 'org', description: 'test', downloads: 50, likes: 1, tags: [], lastModified: '', files: [underCeiling, atCeiling] };
    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        searchModels: jest.fn(async () => [modelInfo]),
        getModelFiles: jest.fn(async () => [underCeiling, atCeiling]),
        getModelDetails: jest.fn(async () => modelInfo),
        getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
        formatModelSize: jest.fn(() => '6.0 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(2)} GB`),
      },
    }));

    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { fitTier } = require('../../../src/services/memoryBudget');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await hardwareService.refreshMemoryInfo();
    const ramGB = hardwareService.getTotalMemoryGB();
    // Owner verdict: EXACTLY at the aggressive ceiling is 'wontFit'; just-under is loadable ('tight').
    expect(fitTier(atCeiling.size, ramGB)).toBe('wontFit');
    expect(fitTier(underCeiling.size, ramGB)).not.toBe('wontFit');

    const { getByTestId, getByText, queryByText } = render(React.createElement(ModelsScreen, {}));
    await act(async () => { fireEvent.changeText(getByTestId('search-input'), 'boundary'); });
    await act(async () => { fireEvent(getByTestId('search-input'), 'submitEditing'); await new Promise((r) => setTimeout(r, 600)); });
    await waitFor(() => expect(getByText('Boundary Model')).toBeTruthy(), { timeout: 6000 });
    await act(async () => { fireEvent.press(getByText('Boundary Model')); });
    await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy(), { timeout: 4000 });
    await waitFor(() => expect(getByText('model-under')).toBeTruthy(), { timeout: 4000 });

    // TERMINAL artifact: just-under (loadable) renders; EXACTLY-at-ceiling (Won't fit) is hidden.
    expect(queryByText('model-under')).not.toBeNull();
    expect(queryByText('model-atceiling')).toBeNull();
  }, 30000);
});
