/**
 * Voice-model BUG HUNT — an STT (Whisper) download interrupted by an app-kill is not
 * recoverable after relaunch (B7 class for STT).
 *
 * sttProvider.reconcile() is the launch hook meant to turn an interrupted in-flight
 * download into a retriable 'failed' row. But it iterates useDownloadStore, and that
 * store is a PLAIN zustand create() with NO persist middleware — so on relaunch it is
 * EMPTY. reconcile() therefore finds nothing to mark failed, and sttProvider.list()
 * has no in-flight entry to report. Whisper writes to the final `ggml-<id>.bin` path,
 * so if any partial file survives it is either invisible or (see the partial-completed
 * test) mis-reported as completed — never as a failed/retriable STT download.
 *
 * This test reproduces the post-relaunch state (empty store) exactly, runs the REAL
 * reconcile() + list(), and asserts the terminal artifact a user needs: the
 * interrupted download surfaces as a `failed`/retriable STT item. It does not today.
 */
import RNFS from 'react-native-fs';
import { sttProvider } from '../../../src/services/modelDownloadService/providers/sttProvider';
import { useDownloadStore } from '../../../src/stores/downloadStore';

const exists = RNFS.exists as jest.Mock;
const readDir = RNFS.readDir as jest.Mock;

describe('an interrupted STT download must be recoverable after relaunch', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    // Post-relaunch reality: downloadStore is NOT persisted, so it starts empty.
    useDownloadStore.setState({ downloads: {}, downloadIdIndex: {} });
  });

  // BUG (B7 class for STT): the unpersisted store is wiped on relaunch, so reconcile
  // finds nothing and nothing scans disk → the interrupted download vanishes.
  // `it.failing` passes while the bug exists; flips red once an interrupted STT
  // download is surfaced as failed/retriable after relaunch (then drop .failing).
  it.failing('reconcile + list surface the interrupted base.en download as failed/retriable', async () => {
    // The models dir exists but holds no *valid completed* model — an interrupted
    // download for base.en happened last session (its store row died with the process).
    exists.mockResolvedValue(true);
    readDir.mockResolvedValue([]); // no completed ggml-*.bin on disk

    // Launch reconcile (as ModelDownloadService.reconcile does). reconcile is optional
    // on the provider contract; the sttProvider implements it.
    await sttProvider.reconcile?.();

    const items = await sttProvider.list();
    const baseEn = items.find((d) => d.id === 'stt:base.en');

    // TERMINAL ARTIFACT: the user must see the interrupted download as a failed,
    // retriable STT item so they can resume it. Today it is simply GONE (the
    // unpersisted store was wiped and nothing scans for the orphaned attempt).
    expect(baseEn).toBeDefined();
    expect(baseEn?.status).toBe('failed');
  });
});
