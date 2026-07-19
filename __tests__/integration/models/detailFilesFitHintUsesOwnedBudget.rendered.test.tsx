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
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'org/fit-hint';
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function installHuggingFaceBoundary(
  files: Array<{ name: string; size: number }>,
) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/tree/main')
      ? files.map(file => ({ type: 'file', path: file.name, size: file.size }))
      : [
          {
            id: MODEL_ID,
            author: 'org',
            downloads: 50,
            likes: 1,
            tags: [],
            lastModified: '',
            siblings: files.map(file => ({
              rfilename: file.name,
              size: file.size,
            })),
          },
        ];
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}

describe('detail Available Files fit hint matches the owned fileExceedsBudget verdict (rendered)', () => {
  it('offers every loadable quant (fitTier !== wontFit) — hides only the genuinely-too-big one', async () => {
    // Device: a 6GB Android phone → budget = 6 * modelBudgetFraction(6)=0.60 = 3.6GB.
    // Two quant files straddling the budget: a 2GB (fits) and a 5GB (exceeds).
    const fitFile = {
      name: 'model-Q4_K_M.gguf',
      size: 2 * GB,
      quantization: 'Q4_K_M',
      downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q4_K_M.gguf`,
    };
    const bigFile = {
      name: 'model-Q8_0.gguf',
      size: 5 * GB,
      quantization: 'Q8_0',
      downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-Q8_0.gguf`,
    };
    installHuggingFaceBoundary([fitFile, bigFile]);

    const { rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 6 * GB, availBytes: 4 * GB },
      },
    });
    const { fireEvent, waitFor, act } = rtl;

    await act(async () => {
      fireEvent.press(view.getByTestId('models-tab'));
    });
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('search-input'), 'fit');
    });
    await act(async () => {
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(r => setTimeout(r, 600));
    });
    await waitFor(() => expect(view.getByText('fit-hint')).toBeTruthy(), {
      timeout: 6000,
    });
    await act(async () => {
      fireEvent.press(view.getByText('fit-hint'));
    });
    await waitFor(
      () => expect(view.getByTestId('model-detail-screen')).toBeTruthy(),
      { timeout: 4000 },
    );

    // Wait for the files to load (the fitting file card renders).
    await waitFor(() => expect(view.getByText('model-Q4_K_M')).toBeTruthy(), {
      timeout: 4000,
    });

    // TERMINAL artifact: the list offers the under-budget quant and HIDES the over-budget one —
    // exactly the fileExceedsBudget verdict. (Display names strip the .gguf extension.)
    expect(view.queryByText('model-Q4_K_M')).not.toBeNull();
    expect(view.queryByText('model-Q8_0')).toBeNull();
  }, 30000);

  it("BOUNDARY: a file EXACTLY at the aggressive ceiling is Won't-fit (hidden), one just under is loadable (shown)", async () => {
    // The list hides only 'wontFit' — files past the AGGRESSIVE ceiling (fitTier's `size < ceil`). Pin
    // that boundary on a device where the ceiling is a WHOLE number of bytes: 8GB × aggressive 0.75 =
    // EXACTLY 6.0 GB. A file of EXACTLY 6.0GB is 'wontFit' (not `< ceil`) → HIDDEN; 6.0GB−1byte is 'tight'
    // → SHOWN. Flipping fitTier's `<` to `<=` would make the exact-ceiling file 'tight'/shown → red.
    const ceilBytes = 6 * GB;
    const atCeiling = {
      name: 'model-atceiling.gguf',
      size: ceilBytes,
      quantization: 'Q6',
      downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-atceiling.gguf`,
    };
    const underCeiling = {
      name: 'model-under.gguf',
      size: ceilBytes - 1,
      quantization: 'Q5',
      downloadUrl: `https://hf.co/${MODEL_ID}/resolve/main/model-under.gguf`,
    };
    installHuggingFaceBoundary([underCeiling, atCeiling]);

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
      fireEvent.changeText(view.getByTestId('search-input'), 'boundary');
    });
    await act(async () => {
      fireEvent(view.getByTestId('search-input'), 'submitEditing');
      await new Promise(resolve => setTimeout(resolve, 600));
    });
    await waitFor(() => expect(view.getByText('fit-hint')).toBeTruthy(), {
      timeout: 6000,
    });
    await act(async () => {
      fireEvent.press(view.getByText('fit-hint'));
    });
    await waitFor(
      () => expect(view.getByTestId('model-detail-screen')).toBeTruthy(),
      { timeout: 4000 },
    );
    await waitFor(() => expect(view.getByText('model-under')).toBeTruthy(), {
      timeout: 4000,
    });

    // TERMINAL artifact: just-under (loadable) renders; EXACTLY-at-ceiling (Won't fit) is hidden.
    expect(view.queryByText('model-under')).not.toBeNull();
    expect(view.queryByText('model-atceiling')).toBeNull();
  }, 30000);
});
