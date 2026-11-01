/**
 * useVoiceDownloadItems tests
 *
 * Surfaces voice (TTS) + transcription (STT/Whisper) models in the Download Manager.
 * TTS state comes from the SAME ModelDownloadService projection the Voice panel reads (Pro's
 * ttsProvider), not a parallel `downloads.listVoiceModels` hook, so the two surfaces can't disagree
 * (the "Kokoro shows downloaded while still downloading" bug). Delete routes through the Pro delete
 * hook.
 *
 * Only the device is faked: the in-memory disk (a Whisper model is a file in the whisper folder),
 * async-storage, and ExecuTorch's resource fetcher for Kokoro (harness/kokoroResourceBoundary). The
 * hook, whisperService, the whisper store, ModelDownloadService, Pro (activated through the real
 * license path in harness/proHarness), its TTS store and download provider run for real.
 */
import { installModelManagerDevice, type ModelManagerDevice } from '../../../harness/modelManagerDevice';
import { requireRTL } from '../../../harness/nativeBoundary';
import type { DownloadItem } from '../../../../src/screens/DownloadManagerScreen/items';
import type { VoiceDownloadItems } from '../../../../src/screens/DownloadManagerScreen/useVoiceDownloadItems';

const WHISPER_FILE = '/docs/whisper-models/ggml-base.en.bin';

let device: ModelManagerDevice;
let rtl: ReturnType<typeof requireRTL>;
let result: { current: VoiceDownloadItems };
let unmount: () => void;
let alertsClosed: number;

const tts = () => require('../../../../pro/audio/ttsStore').useTTSStore;
const cache = () => require('../../../harness/kokoroResourceBoundary').currentKokoroResourceBoundary();

beforeEach(async () => {
  device = await installModelManagerDevice({ platform: 'android' });
  require('../../../harness/kokoroResourceBoundary').installKokoroResourceBoundary();
  await require('../../../harness/proHarness').installPro();
  rtl = requireRTL();
  require('../../../../src/services/modelDownloadService/registerProviders').registerCoreDownloadProviders();
  device.fs.seedFile(WHISPER_FILE, 142_000_000);
  alertsClosed = 0;
});

afterEach(() => unmount?.());

async function mount() {
  const { useVoiceDownloadItems } = require('../../../../src/screens/DownloadManagerScreen/useVoiceDownloadItems');
  const view = rtl.renderHook(() => useVoiceDownloadItems(() => { alertsClosed += 1; }));
  result = view.result;
  unmount = view.unmount;
  await rtl.act(async () => { await device.settle(); });
}

async function waitUntil(check: () => boolean) {
  await rtl.waitFor(() => expect(check()).toBe(true));
}

const item = (modelType: 'stt' | 'tts'): DownloadItem | undefined =>
  result.current.voiceItems.find(i => i.modelType === modelType);

/** Kokoro downloaded through the TTS store, the way the Voice panel's Download button does it. */
async function downloadKokoro() {
  cache().seedVoice();
  await rtl.act(async () => { await tts().getState().downloadModels(); });
}

describe('useVoiceDownloadItems', () => {
  it('lists transcription (stt) and voice (tts) downloaded models', async () => {
    await downloadKokoro();
    await mount();

    await waitUntil(() => result.current.voiceItems.length === 2);
    expect(item('stt')).toEqual(expect.objectContaining({
      type: 'completed', fileName: 'ggml-base.en.bin', modelId: 'base.en', filePath: WHISPER_FILE,
    }));
    expect(item('tts')).toEqual(expect.objectContaining({ type: 'completed', modelId: 'kokoro', fileName: 'Kokoro TTS' }));
  });

  it('shows an in-progress voice download as an ACTIVE item, never as completed, then as completed when it finishes', async () => {
    // Regression (the sync bug): the Download Manager showed Kokoro under "Downloaded Models" while
    // the Voice panel showed it downloading. With one source, a downloading engine can only ever
    // produce an ACTIVE item here.
    await mount();
    const finish = cache().holdNext(0.3);
    let done!: Promise<void>;
    await rtl.act(async () => { done = tts().getState().downloadModels(); await device.settle(); });

    await waitUntil(() => item('tts')?.status === 'downloading');
    expect(item('tts')?.type).toBe('active');
    expect(result.current.voiceItems.some(i => i.modelType === 'tts' && i.type === 'completed')).toBe(false);

    finish();
    await rtl.act(async () => { await done; });
    await waitUntil(() => item('tts')?.type === 'completed');
    expect(item('tts')?.status).toBe('completed');
  });

  it('surfaces a FAILED voice download as a retryable failed item with the engine message', async () => {
    // Regression: a failed Kokoro download used to be dropped entirely (nothing shown, no way to
    // retry). It must render as a failed ACTIVE item so the Download Manager shows Retry.
    await mount();
    cache().failFetch(new Error('Download interrupted'));
    await rtl.act(async () => { await tts().getState().downloadModels().catch(() => {}); await device.settle(); });

    await waitUntil(() => item('tts')?.status === 'failed');
    const failed = item('tts')!;
    expect(failed.type).toBe('active');
    // Engine message present: shown verbatim, so no canned reason code. Retry still renders because
    // isRetryable(undefined) === true.
    expect(failed.reason).toBe('Download interrupted');
    expect(failed.reasonCode).toBeUndefined();
  });

  it('falls back to the retryable code when the engine gives no failure message', async () => {
    await mount();
    cache().failFetch(new Error(''));
    await rtl.act(async () => { await tts().getState().downloadModels().catch(() => {}); await device.settle(); });

    await waitUntil(() => item('tts')?.status === 'failed');
    expect(item('tts')?.reasonCode).toBe('download_interrupted');
  });

  it('omits voice models when no voice model was downloaded', async () => {
    await mount();

    await waitUntil(() => result.current.voiceItems.length === 1);
    expect(item('stt')?.modelId).toBe('base.en');
    expect(item('tts')).toBeUndefined();
  });

  it('builds a delete alert that removes a transcription model on confirm', async () => {
    await mount();
    await waitUntil(() => !!item('stt'));

    const alert = result.current.buildDeleteAlert(item('stt')!);
    expect(alert.title).toBe('Delete Transcription Model');

    await rtl.act(async () => { alert.buttons?.find(b => b.text === 'Delete')?.onPress?.(); await device.settle(); });

    expect(alertsClosed).toBe(1);
    await waitUntil(() => !item('stt'));
    expect(await device.fs.exists(WHISPER_FILE)).toBe(false);
  });

  it('builds a delete alert that deletes a voice model through Pro', async () => {
    await downloadKokoro();
    await mount();
    await waitUntil(() => item('tts')?.type === 'completed');
    expect(cache().files.size).toBeGreaterThan(0);

    const alert = result.current.buildDeleteAlert(item('tts')!);
    expect(alert.title).toBe('Delete Voice Model');

    await rtl.act(async () => { alert.buttons?.find(b => b.text === 'Delete')?.onPress?.(); await device.settle(); });

    await waitUntil(() => cache().files.size === 0);
    await waitUntil(() => item('tts')?.type !== 'completed');
  });
});
