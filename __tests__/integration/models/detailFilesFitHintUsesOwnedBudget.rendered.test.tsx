/**
 * Detail "Available Files" device-fit hint — the single owned budget (memoryBudget.fileExceedsBudget).
 *
 * SPEC (the OGAM user's view): in a model's detail view, the "Available Files" list offers exactly the
 * quant files that FIT this device's RAM budget and hides the ones that don't — and that fit decision is
 * the ONE owned primitive `fileExceedsBudget` (device-tier fraction of TOTAL RAM), never a hand-rolled
 * copy of the budget arithmetic that could drift from the download-warning / picker / browse-list copies.
 *
 * This mounts the REAL ModelsScreen, arrives at a model's detail via a real search+tap, and asserts the
 * rendered file list against `fileExceedsBudget`'s verdict for each file: the under-budget quant renders,
 * the over-budget quant is absent. Boundary fakes only: native download + fs + RAM (installNativeBoundary)
 * and the HuggingFace network transport. The budget math, screen, hooks, ModelCard all run REAL.
 *
 * Falsification (DRY): the expected present/absent set is computed from `fileExceedsBudget` itself, so if
 * a caller's inline copy of the formula drifts from the owner (different fraction, wrong comparison, a
 * unit slip), the rendered list stops matching the owner's verdict and this test goes red.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/fit-hint';

describe('detail Available Files fit hint matches the owned fileExceedsBudget verdict (rendered)', () => {
  it('offers exactly the files fileExceedsBudget says fit — hides the over-budget quant', async () => {
    // Device: a 6GB Android phone → budget = 6 * modelBudgetFraction(6)=0.60 = 3.6GB.
    const boundary = installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 4 * GB } });

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
    const { fileExceedsBudget } = require('../../../src/services/memoryBudget');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await hardwareService.refreshMemoryInfo();
    const ramGB = hardwareService.getTotalMemoryGB();

    // The owner's verdict is the source of truth for what the list must show.
    expect(fileExceedsBudget(fitFile.size, ramGB)).toBe(false); // fits → must render
    expect(fileExceedsBudget(bigFile.size, ramGB)).toBe(true);  // exceeds → must be hidden

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
});
