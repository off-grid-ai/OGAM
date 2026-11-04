/**
 * RENDERED — a LiteRT model refused for memory says how far off the phone is.
 *
 * DEVICE GROUND TRUTH (Pixel 9, 12 GB, Android 17, 2026-11-02): Gemma 4 E2B LiteRT (2.41 GB file, ~3.6 GB
 * estimated) was refused with about 1.6 GB free. The sheet said only "Not enough free memory", with no way
 * to tell whether closing an app would be enough. It now quotes the need and what the phone can spare.
 *
 * Real: the chat screen, the turn path, activeModelService, residency, the stores. Faked: the LiteRT
 * native module, the filesystem, RAM.
 */
import { setupChatScreen, renderedThread } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

describe('LiteRT memory refusal', () => {
  it('quotes the need and what the phone can spare on the first send, the need being larger', async () => {
    const h = await setupChatScreen({
      navigation: 'real',
      engine: 'litert',
      modelFileSizeBytes: 2.41 * GB,
      ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 1.6 * GB },
      deferInitialLoad: true,
    });
    h.render();
    const view = h.view!;
    expect(view.queryByText('Insufficient Memory')).toBeNull();

    h.boundary.litert.scriptTurn({ content: 'Paris.' });
    await h.tapSend('What is the capital of France?');

    await h.rtl.waitFor(() => expect(view.queryByText('Insufficient Memory')).not.toBeNull(), { timeout: 20000 });
    const body = String(view.getByText(/needs about [\d.]+ GB and the phone can spare [\d.]+ GB right now/).props.children);
    const [, need, spare] = /needs about ([\d.]+) GB and the phone can spare ([\d.]+) GB/.exec(body)!;
    expect(Number(need)).toBeGreaterThan(Number(spare));
    expect(view.queryByText('Load Anyway')).not.toBeNull();
    expect(renderedThread(view).filter(line => line.startsWith('assistant:'))).toEqual([]);
  }, 45000);
});
