/**
 * RENDERED — a chat model that memory refuses offers a smaller one in one tap, and the turn goes on it.
 *
 * PostHog (2026-11-19): about one phone user in seven had a chat model refused for memory. The sheet
 * offered "Choose another model" (the full list) or "Load Anyway". A person who does not know which
 * model fits got no answer. Now the sheet's first button is the biggest smaller model on the phone.
 *
 * iPhone, 8 GB, 300 MB free: the 1 GB model needs 120-245 MB of KV cache (quantized or f16) plus 200 MB
 * headroom, more than is free; the 100 MB model needs 12-25 MB plus the headroom, which fits.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB, MB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

describe('memory refusal offers a smaller model', () => {
  it('Use <smaller model> loads it and answers the waiting question', async () => {
    const h = await setupChatScreen({
      navigation: 'real',
      engine: 'llama',
      platform: 'ios',
      modelFileSizeBytes: 1 * GB,
      ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 300 * MB },
      deferInitialLoad: true,
      extraModels: [
        { id: 'small', name: 'Small Model', fileName: 'small.gguf', fileSizeBytes: 100 * MB },
        // Bigger than the refused one: never offered as the smaller model.
        { id: 'big', name: 'Big Model', fileName: 'big.gguf', fileSizeBytes: 3 * GB },
      ],
    });
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(1 * GB));
    h.render();

    h.boundary.llama!.scriptCompletion({ text: 'Paris.' });
    await h.tapSend('What is the capital of France?');

    const smaller = await h.rtl.waitFor(() => h.view!.getByText('Use Small Model'), { timeout: 20000 });
    expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    expect(h.view!.queryByText('Use Big Model')).toBeNull();

    await h.rtl.act(async () => { h.rtl.fireEvent.press(smaller); });

    await h.rtl.waitFor(() => expect(h.view!.queryByText(/Paris\./)).not.toBeNull(), { timeout: 20000 });
    expect(h.useAppStore.getState().activeModelId).toBe('small');
    expect(h.boundary.llama!.calls.initLlama.at(-1)?.model).toMatch(/small\.gguf$/);
  }, 45000);
});
