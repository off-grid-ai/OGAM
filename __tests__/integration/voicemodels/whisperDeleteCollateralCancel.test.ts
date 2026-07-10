/**
 * Voice-model management BUG HUNT — Whisper (STT) delete cancels an UNRELATED
 * in-flight download.
 *
 * Attack: base.en is downloading while the user deletes a DIFFERENT, already-on-disk
 * model (small.en) from the Download Manager. Unrelated models must not interfere.
 *
 * Root cause (src/services/whisperService.ts:172-179): deleteModel() unconditionally
 * cancels `this.activeDownloadId` — a single instance field tracking WHATEVER download
 * is in flight, regardless of which model was asked to be deleted. So deleting any
 * completed model aborts the unrelated in-flight download (its partial file is then
 * unlinked and its store row removed).
 *
 * The bug assertion is expressed with `it.failing`: it documents the DESIRED invariant
 * (the in-flight download is NOT cancelled) and passes ONLY while the bug is present.
 * When whisperService is fixed to cancel by model id, this test turns RED — the signal
 * to drop `.failing` and make it a permanent green guard. The precondition (download is
 * genuinely in flight) is a SEPARATE normal test so a false green can't hide behind
 * `it.failing`.
 */
import RNFS from 'react-native-fs';
import { whisperService } from '../../../src/services/whisperService';
import { backgroundDownloadService } from '../../../src/services/backgroundDownloadService';
import { useDownloadStore } from '../../../src/stores/downloadStore';

const exists = RNFS.exists as jest.Mock;
const unlink = RNFS.unlink as jest.Mock;
const mkdir = RNFS.mkdir as jest.Mock;

const BASE_DL_ID = 'native-base-en-123';

/**
 * Kick off a base.en download that stays in flight (its promise never settles) while
 * small.en is on disk. Returns spies + the cleanup to settle the dangling promise.
 */
async function startInflightBaseThenDeleteSmall() {
  useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
  mkdir.mockResolvedValue(undefined);
  unlink.mockResolvedValue(undefined);
  exists.mockImplementation(async (p: string) => {
    const path = String(p);
    if (path.endsWith('whisper-models')) return true;      // models dir
    if (path.includes('ggml-small.en.bin')) return true;   // completed on disk
    return false;                                          // base.en not yet
  });

  let settle!: () => void;
  const runningForever = new Promise<void>((res) => { settle = res; });
  const cancelSpy = jest
    .spyOn(backgroundDownloadService, 'cancelDownload')
    .mockResolvedValue(undefined as never);
  jest.spyOn(backgroundDownloadService, 'downloadFileTo').mockReturnValue({
    downloadIdPromise: Promise.resolve(BASE_DL_ID),
    promise: runningForever as unknown as Promise<never>,
  } as never);

  const inflight = whisperService.downloadModel('base.en').catch(() => {});
  for (let i = 0; i < 12; i++) await Promise.resolve();
  return { cancelSpy, inflight, settle };
}

describe('Whisper delete must not cancel an unrelated in-flight download', () => {
  beforeEach(() => { jest.restoreAllMocks(); });

  it('precondition: base.en is genuinely in flight (activeDownloadId set)', async () => {
    const { inflight, settle } = await startInflightBaseThenDeleteSmall();
    expect(
      (whisperService as unknown as { activeDownloadId: string | null }).activeDownloadId,
    ).toBe(BASE_DL_ID);
    settle();
    await inflight;
  });

  // BUG: deleting small.en cancels the base.en native task. `it.failing` passes while
  // the bug exists; it flips red once deleteModel cancels by model id (then drop .failing).
  it.failing(
    'deleting small.en (on disk) must NOT cancel the in-flight base.en download',
    async () => {
      const { cancelSpy, inflight, settle } = await startInflightBaseThenDeleteSmall();
      await whisperService.deleteModel('small.en');
      const cancelledIds = cancelSpy.mock.calls.map((c) => c[0]);
      // Desired invariant — currently violated (base.en IS cancelled).
      expect(cancelledIds).not.toContain(BASE_DL_ID);
      settle();
      await inflight;
    },
  );
});
