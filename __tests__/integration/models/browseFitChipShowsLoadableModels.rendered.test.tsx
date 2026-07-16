/**
 * Browse fit chip — a model that's OVER the balanced budget but still loadable ('tight', under the
 * aggressive ceiling) now SHOWS in browse with a fit chip, instead of being hidden.
 *
 * SPEC: browse no longer hides loadable models behind fileExceedsBudget (the balanced budget). It keeps
 * any model with a quant that isn't 'wontFit' (past the aggressive ceiling) and tags it with a device-fit
 * chip (Easy / Fits / Tight). Only genuinely-too-big models are hidden. Recommended stays filtered and
 * search/sort are untouched — this is only the browse-results relaxation + the chip.
 *
 * Mounts the REAL ModelsScreen, searches, and asserts the previously-hidden 'tight' model now renders with
 * its Tight chip. RED before the relaxation (useTextModels hid it via fileExceedsBudget; ModelCardContent
 * had no chip). Boundary fakes only: native download + fs + RAM + the HuggingFace transport.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/tight-fit';

describe('browse shows a loadable-but-over-balanced-budget model with a fit chip (rendered)', () => {
  it('renders the tight model (not hidden) and its Tight chip', async () => {
    // 8GB Android: balanced soft = 4.8GB, aggressive ceil = 6.0GB. A single 5GB quant is OVER the balanced
    // budget (old behaviour: hidden) but under the aggressive ceiling → 'tight' → now shown with a chip.
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 5 * GB } });

    const tightFile = { name: 'model-Q5_K_M.gguf', size: 5 * GB, quantization: 'Q5_K_M', downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q5_K_M.gguf` };
    const modelInfo = { id: MODEL_ID, name: 'Tight Fit Model', author: 'org', description: 'test', downloads: 50, likes: 1, tags: [], lastModified: '', files: [tightFile] };
    jest.doMock('../../../src/services/huggingface', () => ({
      huggingFaceService: {
        searchModels: jest.fn(async () => [modelInfo]),
        getModelFiles: jest.fn(async () => [tightFile]),
        getModelDetails: jest.fn(async () => modelInfo),
        getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
        formatModelSize: jest.fn(() => '5.0 GB'),
        formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(1)} GB`),
      },
    }));

    const React = require('react');
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { fitTier } = require('../../../src/services/memoryBudget');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');

    await hardwareService.refreshMemoryInfo();
    const ramGB = hardwareService.getTotalMemoryGB();
    // Precondition: this model is 'tight' — loadable, but over the balanced budget (old code hid it).
    expect(fitTier(tightFile.size, ramGB)).toBe('tight');

    const { getByTestId, getByText, queryByTestId } = render(React.createElement(ModelsScreen, {}));
    await act(async () => { fireEvent.changeText(getByTestId('search-input'), 'tight'); });
    await act(async () => { fireEvent(getByTestId('search-input'), 'submitEditing'); await new Promise((r) => setTimeout(r, 600)); });

    // TERMINAL artifact: the model is NOT hidden (renders), and carries the Tight fit chip.
    await waitFor(() => expect(getByText('Tight Fit Model')).toBeTruthy(), { timeout: 6000 });
    expect(queryByTestId('fit-chip-tight')).not.toBeNull();
  }, 30000);
});
