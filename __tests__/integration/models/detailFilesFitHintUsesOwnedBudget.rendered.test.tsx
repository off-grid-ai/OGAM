/**
 * Detail "Available Files" device-fit hint — the single owned budget (memoryBudget.fileExceedsBudget).
 *
 * SPEC (the OGAM user's view): a model's detail view lists every discovered quantization. Files that do
 * not fit this device remain visible, show the owned compatibility warning, and cannot be downloaded.
 * The fit decision is the ONE owned primitive `fileExceedsBudget` (device-tier fraction of TOTAL RAM),
 * never a hand-rolled copy of the budget arithmetic that could drift from other model surfaces.
 *
 * This mounts the REAL ModelsScreen, arrives at a model's detail via a real search+tap, and asserts the
 * rendered file list against `fileExceedsBudget`'s verdict for each file: both quantizations render and
 * the over-budget quant is disabled. Boundary fakes only: native download + fs + RAM (installNativeBoundary)
 * and the HuggingFace network transport. The REAL Mobile composition root (Shared application + download
 * coordinator) is booted via startMobileApplicationFixture; the budget math, screen, hooks, ModelCard all run REAL.
 *
 * Falsification (DRY): the expected present/absent set is computed from `fileExceedsBudget` itself, so if
 * a caller's inline copy of the formula drifts from the owner (different fraction, wrong comparison, a
 * unit slip), the rendered list stops matching the owner's verdict and this test goes red.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

let fixture: import("../../harness/mobileApplicationFixture").MobileApplicationFixture | undefined;
afterEach(async () => { await fixture?.dispose(); fixture = undefined; });

// Boots the REAL Mobile composition root (Shared application + download coordinator) over the fakes.
// The fit hint flows Mobile device RAM -> Shared's owned budget -> rendered file list; nothing is mocked.
async function bootApplication() {
  const { startMobileApplicationFixture } = require("../../harness/mobileApplicationFixture") as typeof import("../../harness/mobileApplicationFixture");
  fixture = await startMobileApplicationFixture();
}

const MODEL_ID = 'org/fit-hint';

describe('detail Available Files fit hint matches the owned fileExceedsBudget verdict (rendered)', () => {
  it('lists every quant and disables the one that exceeds the owned budget', async () => {
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

    await bootApplication();
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { fileExceedsBudget } = require('../../../src/services/memoryBudget');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
     

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

    // All repository quantizations stay visible. The owned budget disables the unsafe one.
    expect(queryByText('model-Q4_K_M')).not.toBeNull();
    expect(queryByText('model-Q8_0')).not.toBeNull();
    expect(getByText(/Too large/)).toBeTruthy();
    expect(getByTestId('file-card-1-download').props.accessibilityState.disabled).toBe(true);
  }, 30000);

  it('BOUNDARY (M5a): a file EXACTLY at the budget is treated as over-budget (>=), one just under fits', async () => {
    // Pins the exact budget comparison (the `>=` in fileExceedsBudget). The verifier's `>=`→`>` mutant
    // survived because no test straddled equality. Device chosen so the budget is a WHOLE number of
    // bytes: 4GB × balanced 0.50 = EXACTLY 2.0 GB (2147483648 B) — the only tier where integer bytes can
    // hit exact equality (0.60×6GB is 3.6GB, not an integer, so >= and > can't differ there). A file of
    // EXACTLY 2.0GB must be disabled (>= = exceeds); 2.0GB−1byte must stay enabled. Reverting to `>`
    // enables the exact-budget file and makes this test red (mutant killed).
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 3 * GB } });

     
    const { modelBudgetFraction } = require('../../../src/services/memoryBudget');
     
    const budgetBytes = 4 * modelBudgetFraction(4, 'android', 'balanced') * GB; // 4 × 0.50 × GB = exactly 2.0 GB (integer bytes)
    const atBudget = { name: 'model-atbudget.gguf', size: budgetBytes, quantization: 'Q5', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-atbudget.gguf` };
    const underBudget = { name: 'model-under.gguf', size: budgetBytes - 1, quantization: 'Q4', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-under.gguf` };
    const modelInfo = { id: MODEL_ID, name: 'Boundary Model', author: 'org', description: 'test', downloads: 50, likes: 1, tags: [], lastModified: '', files: [underBudget, atBudget] };
    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        searchModels: jest.fn(async () => [modelInfo]),
        getModelFiles: jest.fn(async () => [underBudget, atBudget]),
        getModelDetails: jest.fn(async () => modelInfo),
        getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
        formatModelSize: jest.fn(() => '2.0 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(2)} GB`),
      },
    }));

    await bootApplication();
    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { fileExceedsBudget } = require('../../../src/services/memoryBudget');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
     

    await hardwareService.refreshMemoryInfo();
    const ramGB = hardwareService.getTotalMemoryGB();
    // Owner verdict is the source of truth: exact-budget EXCEEDS (>=), just-under FITS.
    expect(fileExceedsBudget(atBudget.size, ramGB)).toBe(true);
    expect(fileExceedsBudget(underBudget.size, ramGB)).toBe(false);

    const { getByTestId, getByText, queryByText } = render(React.createElement(ModelsScreen, {}));
    await act(async () => { fireEvent.changeText(getByTestId('search-input'), 'boundary'); });
    await act(async () => { fireEvent(getByTestId('search-input'), 'submitEditing'); await new Promise((r) => setTimeout(r, 600)); });
    await waitFor(() => expect(getByText('Boundary Model')).toBeTruthy(), { timeout: 6000 });
    await act(async () => { fireEvent.press(getByText('Boundary Model')); });
    await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy(), { timeout: 4000 });
    await waitFor(() => expect(getByText('model-under')).toBeTruthy(), { timeout: 4000 });

    // Both files render; EXACTLY-at-budget is disabled at the `>=` boundary.
    expect(queryByText('model-under')).not.toBeNull();
    expect(queryByText('model-atbudget')).not.toBeNull();
    expect(getByText(/Too large/)).toBeTruthy();
    expect(getByTestId('file-card-0-download').props.accessibilityState.disabled).toBe(true);
    expect(getByTestId('file-card-1-download').props.accessibilityState.disabled).toBe(false);
  }, 30000);
});
