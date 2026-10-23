/**
 * RENDERED — the "Insufficient Memory" sheet must never say the model fits while refusing it.
 *
 * DEVICE GROUND TRUTH (2026-10-22, iPhone, release tip fd73fdfbb): the first turn on Qwen3.5 2B showed
 * "it needs ~1818MB but only 1898MB is available ... Load Anyway?". The verdict adds a 200MB OS/app
 * headroom to the estimate (1818 + 200 > 1898); the copy quoted the estimate without it.
 *
 * An iPhone maps the weights, so only the KV cache and the headroom must fit in what is free (that
 * device case now loads). Pinned in the band: a 1GB GGUF at the default 4K context needs ~114–229MB of
 * KV (quantized or f16), so 260MB available is above the bare KV but below KV + headroom on either.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB, MB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('memory refusal copy agrees with the verdict', () => {
  it('a refusal inside the headroom band quotes a need larger than what is available', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'ios',
      modelFileSizeBytes: 1 * GB,
      ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 260 * MB },
      deferInitialLoad: true,
    });
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', Math.round(1 * GB));
    h.render();

    h.boundary.llama!.scriptCompletion({ text: 'Paris.' });
    await h.tapSend('What is the capital of France?');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText('Load Anyway')).not.toBeNull();
    }, { timeout: 20000 });
    const body = h.view!.getByText(/it needs ~\d+MB but only \d+MB is available/).props.children as string;
    const [, needMB, availMB] = /it needs ~(\d+)MB but only (\d+)MB/.exec(String(body))!;
    expect(Number(needMB)).toBeGreaterThan(Number(availMB));
  }, 45000);
});
