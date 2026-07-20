/**
 * G7 (docs/RELEASE_571_GAP_FINDINGS.md): reconcileFinishedImageDownloads re-unzips a `_zip_name`
 * remnant (mid-unzip kill) and registered the model on isValidZip alone (size>0 + PK header) WITHOUT
 * the completeness gate the live/resume paths run. A truncated-but-PK zip yields a PARTIAL tree
 * (missing pos_emb.bin / *.mnn.weight), registered as usable → native crash at generation. The
 * recovery path must run ensureImageExtractionComplete like the live path and NOT register a partial.
 */
import { renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_ID = 'sd_test_mnn'; // detectBackend → 'mnn' (completeness contract applies)
const IMAGE_MODELS_DIR = '/docs/image_models';
const MODEL_DIR = `${IMAGE_MODELS_DIR}/${MODEL_ID}`;
const ZIP_NAME = `${MODEL_ID}.zip`;
const ZIP_PATH = `${IMAGE_MODELS_DIR}/${ZIP_NAME}`;

describe('G7 reconcile must not register a partial re-unzip', () => {
  it('does not publish a partially-extracted mnn model recovered from a _zip_name remnant', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 8 * GB, availBytes: 6 * GB },
      },
      beforeRender: async ({ boundary }) => {
        const fs = boundary.fs!;
        // A staged zip (valid PK header, non-zero) plus the _zip_name sentinel that marks a
        // mid-unzip kill, but NO _ready — the exact state reconcile re-unzips from.
        fs.seedFile(ZIP_PATH, 24 * 1024 * 1024);
        await (fs.module.writeFile as (p: string, c: string) => Promise<void>)(
          `${MODEL_DIR}/_zip_name`,
          ZIP_NAME,
        );
        // Partial extraction: only unet.mnn present; base files + weight pairing missing.
        fs.seedFile(`${MODEL_DIR}/unet.mnn`, 1024);
        // isValidZip reads the first bytes; make the zip path report a real PK header.
        const readMock = fs.module.read as jest.Mock;
        const realRead = readMock.getMockImplementation();
        readMock.mockImplementation(async (p: string, ...rest: unknown[]) =>
          String(p).endsWith(ZIP_NAME) ? 'PK' : realRead?.(p, ...rest),
        );
        // Re-unzip is a native boundary; keep the tree partial (no new files appear).
        const { unzip } = require('react-native-zip-archive') as { unzip: jest.Mock };
        unzip.mockImplementation(async () => MODEL_DIR);
      },
    });

    // App boots (proves reconcile ran during startup recovery).
    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );

    const exists = boundary.fs!.module.exists as (p: string) => Promise<boolean>;
    // The partial extraction must NOT be published: no _ready written, and the unusable dir cleaned
    // up so it resurfaces as re-downloadable. (On HEAD the reconcile wrote _ready + registered it.)
    await rtl.waitFor(async () => {
      expect(await exists(`${MODEL_DIR}/_ready`)).toBe(false);
      expect(await exists(MODEL_DIR)).toBe(false);
    });
  }, 45000);
});
