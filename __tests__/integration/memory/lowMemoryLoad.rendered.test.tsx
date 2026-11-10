/**
 * UI integration — a chat model that will not fit as a copy loads mapped instead of crashing or
 * being refused.
 *
 * Device ground truth (in-app analytics, 0.0.122): on 7 GB Android phones K2 Horizon 3.7B (3.16 GB,
 * Q4_K_M) loaded as a copy with a median 3.0 GB free and killed the app with 1.9 GB free. Android
 * repacks Q4_K weights into memory, so the whole file counts against free RAM, but the gate credited
 * at least 60% of RAM as free and never saw the shortfall.
 *
 * Real ChatScreen, real llmService / activeModelService / residency load path. Faked only at the
 * device line: llama.rn (GGUF header and initLlama), the in-memory disk and the RAM sensor. The params
 * initLlama receives are what the phone runs with.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

/** GGUF general.file_type for Q4_K_M: a quant llama.cpp repacks for ARM. */
const Q4_K_M = 15;
const MODEL_FILE = '/docs/models/ggml-small.gguf';

async function sendOnSevenGbPhone(availBytes: number) {
  const h = await setupChatScreen({ navigation: 'real',
    engine: 'llama',
    platform: 'android',
    deferInitialLoad: true,
    modelFileSizeBytes: 3.16 * GB,
    ram: { platform: 'android', totalBytes: 7.3 * GB, availBytes },
    llamaModelInfo: { 'general.architecture': 'llama', 'general.file_type': Q4_K_M },
  });
  h.boundary.fs!.seedFile(MODEL_FILE, Math.round(3.16 * GB));
  h.render();
  await h.send('hello', { text: 'Hi there.' });
  await h.rtl.waitFor(() => {
    expect(h.view!.queryByText(/Hi there\./)).not.toBeNull();
  });
  const inits = h.boundary.llama!.calls.initLlama;
  return { h, params: inits[inits.length - 1] as Record<string, unknown> };
}

describe('a chat model too big to copy into free RAM', () => {
  it('7 GB Android with 1.9 GB free: loads mapped without the repack, answers, and says it is in low-memory mode', async () => {
    const { h, params } = await sendOnSevenGbPhone(1.9 * GB);
    expect(params.use_mmap).toBe(true);
    expect(params.no_extra_bufts).toBe(true);
    expect(h.view!.queryByText('Running in low-memory mode. Close other apps for full speed.')).not.toBeNull();
    expect(h.view!.queryByText(/Not enough memory/)).toBeNull();
  });

  it('7 GB Android with 4 GB free: copies and repacks as before, at full speed, with no notice', async () => {
    const { h, params } = await sendOnSevenGbPhone(4 * GB);
    expect(params.use_mmap).toBe(false);
    expect(params.no_extra_bufts).toBe(false);
    expect(h.view!.queryByText(/low-memory mode/)).toBeNull();
  });

  it('a model too big for the phone even mapped is still refused, with Load Anyway', async () => {
    const h = await setupChatScreen({ navigation: 'real',
      engine: 'llama',
      platform: 'android',
      deferInitialLoad: true,
      modelFileSizeBytes: 3.16 * GB,
      ram: { platform: 'android', totalBytes: 7.3 * GB, availBytes: 1.9 * GB },
      llamaModelInfo: { 'general.architecture': 'llama', 'general.file_type': Q4_K_M },
    });
    // The download is 5 GB: past the shared fit rule's ceiling (62% of 7.3 GB), so "Too big".
    h.boundary.fs!.seedFile(MODEL_FILE, Math.round(5 * GB));
    h.render();
    await h.tapSend('hello');
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    }, { timeout: 10000 });
    expect(h.boundary.llama!.calls.initLlama).toHaveLength(0);
  });

  it('switching away from a low-memory model credits nothing back: its file pages already counted as free', async () => {
    const { h } = await sendOnSevenGbPhone(1.9 * GB);
    // A second chat model, 2.5 GB: as a copy it needs more than the 1.9 GB free (plus what Android
    // reclaims). Crediting the outgoing model's 3.16 GB file would wrongly admit the copy.
    h.boundary.fs!.seedFile('/docs/models/second.gguf', Math.round(2.5 * GB));
    const { useAppStore } = require('../../../src/stores');
    const first = useAppStore.getState().downloadedModels[0];
    useAppStore.getState().addDownloadedModel({ ...first, id: 'second', name: 'Second', fileName: 'second.gguf',
      filePath: '/docs/models/second.gguf', fileSize: Math.round(2.5 * GB) });
    const { activeModelService } = require('../../../src/services/activeModelService');
    await h.rtl.act(() => activeModelService.loadTextModel('second'));

    const inits = h.boundary.llama!.calls.initLlama;
    const last = inits[inits.length - 1] as Record<string, unknown>;
    expect(String(last.model)).toMatch(/second\.gguf$/);
    expect(last.use_mmap).toBe(true);
  });
});
