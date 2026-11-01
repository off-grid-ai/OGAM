/**
 * An iPhone short of free pages is refused a text-model load with the memory message, not killed.
 *
 * DEVICE GROUND TRUTH (iPhone 17 Pro Max, 2026-10-27, jetsam + [WIRE-RAM] log): a 5.3 GB Qwen3.5-9B Q4 was
 * loaded with its weights mapped while the phone had 1.0 GB of free pages (systemAvailableBytes 1033961472)
 * and the app's own headroom read 4.5 GB. The gate said safe (mapped weights are not charged to the app's
 * limit); the GPU wired them, the OS ran out of pages and killed the app within seconds.
 *
 * The gate now also needs the phone's free pages to cover mapped weights + KV cache + headroom.
 *
 * Real ChatScreen and llm service; only the native engine, the disk and the RAM sensor are faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

async function sendWithSystemFree(systemAvailBytes: number) {
  const h = await setupChatScreen({ navigation: 'real',
    engine: 'llama',
    platform: 'ios',
    modelFileSizeBytes: 3.5 * GB,
    ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 8 * GB, systemAvailBytes },
    deferInitialLoad: true,
  });
  h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(5 * GB));
  h.render();
  await h.send('what is the capital of France', { text: 'Paris.' });
  return h;
}

describe('iPhone text load goes by the phone\'s free pages too', () => {
  it('1 GB of free pages: the memory refusal shows and no reply is made', async () => {
    const h = await sendWithSystemFree(1 * GB);
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/it needs ~/)).not.toBeNull(); }, { timeout: 8000 });
    expect(h.view!.queryByText(/Paris\./)).toBeNull();
  }, 30000);

  it('control: 9 GB of free pages loads the model and the reply renders', async () => {
    const h = await sendWithSystemFree(9 * GB);
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Paris\./)).not.toBeNull(); }, { timeout: 8000 });
    expect(h.view!.queryByText(/it needs ~/)).toBeNull();
  }, 30000);
});
