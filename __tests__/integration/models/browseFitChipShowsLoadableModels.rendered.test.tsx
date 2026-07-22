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
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/tight-fit';
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function installHuggingFaceBoundary(file: { name: string; size: number }) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/tree/main')
      ? [{ type: 'file', path: file.name, size: file.size }]
      : [
          {
            id: MODEL_ID,
            author: 'org',
            downloads: 50,
            likes: 1,
            tags: [],
            lastModified: '',
            siblings: [{ rfilename: file.name, size: file.size }],
          },
        ];
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}

describe('browse shows a loadable-but-over-balanced-budget model with a fit chip (rendered)', () => {
  it('renders the tight model (not hidden) and its Tight chip', async () => {
    // 8GB Android: balanced soft = 4.8GB, aggressive ceil = 6.0GB. A single 5GB quant is OVER the balanced
    // budget (old behaviour: hidden) but under the aggressive ceiling → 'tight' → now shown with a chip.
    const tightFile = {
      name: 'model-Q5_K_M.gguf',
      size: 5 * GB,
      quantization: 'Q5_K_M',
      downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q5_K_M.gguf`,
    };
    installHuggingFaceBoundary(tightFile);

    const { rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 5 * GB },
      },
    });
    const { fireEvent, waitFor, act } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('search-input'), 'tight');
    });
    await act(async () => {
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(resolve => setTimeout(resolve, 600));
    });

    // TERMINAL artifact: the model is NOT hidden (renders), and carries the Tight fit chip.
    await waitFor(() => expect(view.getByText('tight-fit')).toBeTruthy(), {
      timeout: 6000,
    });
    expect(view.queryByTestId('fit-chip-tight')).not.toBeNull();
  }, 30000);
});
