/**
 * The first chat model on its way opens the chat. PostHog (2026-11-19): half the new people who started
 * their first download left before it finished, because the chat stayed shut until the model was on the
 * phone. Now the chat opens at once, says the model is downloading, and a message sent before it arrives
 * waits in the queue and goes when it arrives.
 *
 * Real ChatScreen, real composer, real download service over the native download fake, real queue and
 * load; only the native leaves (llama.rn, the downloader, the disk) are faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { MB } from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

const FILE = { name: 'Qwen3.5-0.8B-Q4_K_M.gguf', size: 600 * MB, quantization: 'Q4_K_M', downloadUrl: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf' };

/** No chat model chosen, the first one downloading: what a new person has after Start chatting. */
type Row = { downloadId: string; fileName?: string; modelId?: string };

async function firstModelDownloading(): Promise<{ h: Harness; row: Row }> {
  const h = await setupChatScreen({ navigation: 'real', engine: 'llama', deferInitialLoad: true, download: true });
  const { activeModelService } = require('../../../src/services/activeModelService');
  const { modelDownloadService } = require('../../../src/services/modelDownloadService');
  // The app's boot step: the download service routes each model type to its provider.
  require('../../../src/services/modelDownloadService/registerProviders').registerCoreDownloadProviders();
  await h.rtl.act(async () => {
    await activeModelService.unloadTextModel(false);
    await modelDownloadService.start({ modelType: 'text', modelId: 'unsloth/Qwen3.5-0.8B-GGUF', file: FILE });
  });
  // The app root's native download listeners (App.tsx), which the harness shell does not mount.
  const { useDownloadListeners } = require('../../../src/hooks/useDownloads');
  const Listeners = () => { useDownloadListeners(); return null; };
  h.mountBeside(h.React.createElement(Listeners));
  const row = await h.rtl.waitFor(() => {
    const active = h.boundary.download!.active();
    expect(active).toHaveLength(1);
    return active[0];
  });
  expect(h.useAppStore.getState().activeModelId).toBeNull();
  return { h, row };
}

async function progress(h: Harness, row: Row, fraction: number) {
  await h.rtl.act(async () => {
    h.boundary.download!.events.emit('DownloadProgress', {
      downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
      bytesDownloaded: FILE.size * fraction, totalBytes: FILE.size, status: 'running',
    });
  });
}

describe('the first chat model on its way', () => {
  it('opens the chat, holds the first message, and answers it when the model arrives', async () => {
    const { h, row } = await firstModelDownloading();
    // Start chatting opens the chat straight from setup.
    const view = await h.openScreen('Chat', {});
    await progress(h, row, 0.4);

    // BEFORE the fix: "No Model Selected". Now: the chat, with the model's progress and a live composer.
    await h.rtl.waitFor(() => expect(view.getByTestId('empty-chat-hint').props.children).toMatch(/downloading: 40%/));
    expect(view.queryByText('Needs a chat model.')).toBeNull();

    h.boundary.llama!.scriptCompletion({ text: 'Hello from the phone.' });
    await h.tapSend('hello');

    // The message waits for the model, said in words, and nothing is generated yet.
    await h.rtl.waitFor(() => expect(view.getByText('1 queued')).toBeTruthy());
    expect(view.getByTestId('queue-waiting-label').props.children).toMatch(/^40% · sends when .+ is ready$/);
    expect(view.queryByTestId('queued-send-now-0')).toBeNull();
    expect(h.boundary.llama!.calls.completion).toHaveLength(0);

    // The native side finishes: the model is chosen on arrival, and the waiting message goes.
    const path = `${h.boundary.fs!.DocumentDirectoryPath}/models/${FILE.name}`;
    await h.rtl.act(async () => {
      h.boundary.fs!.seedFile(path, FILE.size);
      h.boundary.download!.events.emit('DownloadComplete', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        bytesDownloaded: FILE.size, totalBytes: FILE.size, status: 'completed', localUri: `file://${path}`,
      });
    });
    await h.rtl.waitFor(() => expect(view.queryByText(/Hello from the phone\./)).not.toBeNull(), { timeout: 8000 });
    expect(h.useAppStore.getState().activeModelId).not.toBeNull();
    expect(view.queryByTestId('queue-indicator')).toBeNull();
  });

  it('offers Retry where the message waits when the download stops', async () => {
    const { h, row } = await firstModelDownloading();
    const view = await h.openScreen('Chat', {});
    await h.tapSend('hello');
    await h.rtl.waitFor(() => expect(view.getByText('1 queued')).toBeTruthy());

    await h.rtl.act(async () => {
      h.boundary.download!.events.emit('DownloadError', {
        downloadId: row.downloadId, fileName: row.fileName, modelId: row.modelId,
        status: 'failed', reason: 'Network lost', reasonCode: 'network_lost',
      });
    });

    await h.rtl.waitFor(() => expect(view.getByTestId('queue-waiting-label').props.children).toMatch(/stopped downloading$/));
    expect(view.getByTestId('queue-retry-model-button')).toBeTruthy();
    // The message is still there, waiting.
    expect(view.getByTestId('queued-message-0')).toBeTruthy();
  });
});
