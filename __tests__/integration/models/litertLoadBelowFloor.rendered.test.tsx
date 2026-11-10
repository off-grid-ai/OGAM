/**
 * RENDERED — a LiteRT load free RAM cannot hold is refused with a memory message, not kept.
 *
 * DEVICE GROUND TRUTH (Pixel 9, 12 GB, Android 17, 2026-11-02): with too little free RAM for Gemma 4 E2B,
 * "Load Anyway" skips the memory gate and native clamps the context to fit what is free. When even the
 * weights do not fit, native drops the context to a token or two; the model stayed loaded and every turn
 * failed as "context full". The load is now refused with a memory message. A context native clamped that
 * still reaches its floor, or a small one the user chose, still loads and answers.
 *
 * Real: the chat screen, the turn path, activeModelService and its loaders, liteRTService, the stores.
 * Faked: the LiteRT native module (its load result is what native reports), the filesystem, RAM.
 */
import { setupChatScreen, renderedThread } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

const assistantLines = (h: Harness) => renderedThread(h.view!).filter(line => line.startsWith('assistant:'));

/** The Max Tokens description in the chat's text settings, which names the context the engine loaded. */
function loadedContextShown(h: Harness): string | null {
  const { TextGenerationSection } = require('../../../src/components/GenerationSettingsModal/TextGenerationSection');
  const s = h.renderAside(h.React.createElement(TextGenerationSection, {}));
  if (!s.queryByText(/How much it reads and writes/)) h.rtl.fireEvent.press(s.getByTestId('modal-text-advanced-toggle'));
  const match = s.queryByText(/Loaded context: \d+ tokens/);
  const text = match ? String(([] as unknown[]).concat(match.props.children).join('')) : null;
  s.unmount();
  return text && /Loaded context: (\d+) tokens/.exec(text)![0];
}

describe('LiteRT load below a usable context', () => {
  it('Load Anyway on a phone that cannot hold the weights shows a memory error and no reply', async () => {
    const h = await setupChatScreen({
      navigation: 'real',
      engine: 'litert',
      modelFileSizeBytes: 2.41 * GB,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 1.6 * GB },
      deferInitialLoad: true,
    });
    h.render();
    const view = h.view!;
    h.boundary.litert.scriptTurn({ content: 'Paris.' });
    await h.tapSend('What is the capital of France?');
    await h.rtl.waitFor(() => expect(view.queryByText('Load Anyway')).not.toBeNull(), { timeout: 20000 });
    expect(view.queryByText(/Not enough free memory to run this model right now/)).toBeNull();

    h.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'cpu', maxNumTokens: 1 });
    await h.rtl.act(async () => {
      h.rtl.fireEvent.press(view.getByText('Load Anyway'));
    });

    const error = await h.rtl.waitFor(
      () => view.getByText(/Not enough free memory to run this model right now/),
      { timeout: 20000 },
    );
    expect(String(([] as unknown[]).concat(error.props.children).join('')).match(/Failed to load model/g) ?? []).toHaveLength(1);
    await h.settle();
    expect(assistantLines(h)).toEqual([]);
  }, 60000);

  it('answers on a small context the user chose', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', deferInitialLoad: true });
    h.setTextSettingViaUI('liteRTMaxTokens', 512);
    h.render();
    h.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: 512 });
    expect(assistantLines(h)).toEqual([]);

    await h.send('What is the capital of France?', { content: 'Paris.' });

    await h.rtl.waitFor(() => expect(assistantLines(h)).toEqual([expect.stringContaining('Paris.')]), { timeout: 20000 });
    expect(h.view!.queryByText(/Not enough free memory/)).toBeNull();
    expect(loadedContextShown(h)).toBe('Loaded context: 512 tokens');
  }, 60000);

  it('answers on a context native clamped that still reaches its floor', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', deferInitialLoad: true });
    h.setTextSettingViaUI('liteRTMaxTokens', 4096);
    h.render();
    h.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: 1024 });
    expect(assistantLines(h)).toEqual([]);

    await h.send('What is the capital of France?', { content: 'Paris.' });

    await h.rtl.waitFor(() => expect(assistantLines(h)).toEqual([expect.stringContaining('Paris.')]), { timeout: 20000 });
    expect(h.view!.queryByText(/Not enough free memory/)).toBeNull();
    expect(loadedContextShown(h)).toBe('Loaded context: 1024 tokens');
  }, 60000);
});
