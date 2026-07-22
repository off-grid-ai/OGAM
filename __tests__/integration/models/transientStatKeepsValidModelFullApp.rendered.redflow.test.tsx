import { renderMainApp } from '../../harness/appJourney';
import { createDownloadedModel } from '../../utils/factories';

// G1 (docs/RELEASE_571_GAP_FINDINGS.md): validateModelFile (llmSafetyChecks.ts) runs RNFS.stat
// OUTSIDE its inner try/catches, so a TRANSIENT stat failure on an EXISTING file falls to the outer
// catch and returns { valid:false }. validateAndResolveModels (modelManager/storage.ts:184-191) then
// RNFS.unlink()s the user's multi-GB model and drops it — silent data loss on a flaky filesystem.
// Existence was already confirmed before validate runs, so a stat throw here is transient, never
// "file missing". The fix must distinguish "provably corrupt" (delete) from "couldn't verify" (keep).

// ANCHOR always survives (no stat error) so ≥1 model remains and the app boots to Home rather than
// onboarding — its survival is not what's under test, it just keeps the app in a steady state.
const ANCHOR_ID = 'test/anchor/anchor-Q4_K_M.gguf';
const ANCHOR_PATH = '/docs/models/anchor-Q4_K_M.gguf';
const HEALTHY_ID = 'test/healthy/keep-Q4_K_M.gguf';
const HEALTHY_PATH = '/docs/models/keep-Q4_K_M.gguf';
const CORRUPT_ID = 'test/corrupt/corrupt-Q4_K_M.gguf';
const CORRUPT_PATH = '/docs/models/corrupt-Q4_K_M.gguf';

describe('G1 transient stat error must not delete a valid model', () => {
  it('keeps a healthy model whose stat throws transiently, while still removing a genuinely corrupt one', async () => {
    const models = [
      createDownloadedModel({
        id: ANCHOR_ID,
        name: 'Anchor Model',
        fileName: 'anchor-Q4_K_M.gguf',
        filePath: ANCHOR_PATH,
        fileSize: 4096,
        engine: 'llama',
      }),
      createDownloadedModel({
        id: HEALTHY_ID,
        name: 'Keep Me Model',
        fileName: 'keep-Q4_K_M.gguf',
        filePath: HEALTHY_PATH,
        fileSize: 4096,
        engine: 'llama',
      }),
      createDownloadedModel({
        id: CORRUPT_ID,
        name: 'Corrupt Model',
        fileName: 'corrupt-Q4_K_M.gguf',
        filePath: CORRUPT_PATH,
        fileSize: 4096,
        engine: 'llama',
      }),
    ];

    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: models,
      beforeRender: async ({ boundary: device }) => {
        const fs = device.fs!;
        // Genuinely corrupt: too small to be a real GGUF → validation SHOULD remove it (proves the
        // self-heal path actually ran, so a surviving healthy model isn't a no-op false green).
        fs.seedFile(CORRUPT_PATH, 128);
        // The healthy model file exists (auto-seeded at 4096) but its stat throws a transient I/O
        // error during validation. exists() still succeeds — the file is really there.
        const statMock = fs.module.stat as jest.Mock;
        const realStat = statMock.getMockImplementation()!;
        let hiccupped = false;
        statMock.mockImplementation(async (p: string) => {
          if (!hiccupped && String(p).endsWith('keep-Q4_K_M.gguf')) {
            hiccupped = true;
            throw new Error('EIO: temporary I/O failure, stat');
          }
          return realStat(p);
        });
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('downloads-icon'));

    // Positive presence first (list really rendered): the anchor is there.
    await rtl.waitFor(() =>
      expect(view.getByTestId(`completed-download-${ANCHOR_ID}`)).toBeTruthy(),
    );
    // The genuinely-corrupt model is removed — proves validation executed (not a no-op green).
    expect(view.queryByTestId(`completed-download-${CORRUPT_ID}`)).toBeNull();

    // The healthy model whose stat merely hiccupped must STILL be present and NOT deleted from disk.
    expect(view.getByTestId(`completed-download-${HEALTHY_ID}`)).toBeTruthy();
    await expect(
      (boundary.fs!.module.exists as (path: string) => Promise<boolean>)(
        HEALTHY_PATH,
      ),
    ).resolves.toBe(true);
  }, 30000);
});
