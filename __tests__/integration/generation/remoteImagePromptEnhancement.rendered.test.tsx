import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteStream } from '../../harness/remoteHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('Remote image prompt enhancement in Chat', () => {
  const originalFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  it('sends the enhanced prompt to the selected remote image model', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const server = await remoteServerManager.addServer({
      name: 'Desktop image server',
      endpoint: 'http://192.168.1.4:7881',
      providerType: 'openai-compatible',
      mediaModels: { image: 'remote-image' },
    });
    await remoteServerManager.setActiveRemoteMediaModel(server.id, 'image', 'remote-image');

    const sentPrompts: string[] = [];
    let finishImage: (() => void) | undefined;
    const imageResponse = new Promise<void>(resolve => { finishImage = resolve; });
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
      sentPrompts.push(body.prompt ?? '');
      await imageResponse;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }] }),
      } as Response;
    }) as typeof fetch;

    h.render();
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(h.view!.getByText('IMAGE GENERATION'));
    h.rtl.fireEvent.press(h.view!.getByTestId('image-enhance-on'));
    h.rtl.fireEvent.press(h.view!.getByText('Done'));

    h.boundary.llama!.scriptCompletion({
      text: 'A green Ferrari on a coast road at sunset',
      pauseAfter: 'A green Ferrari',
    });
    await h.cycleImageMode();
    await h.tapSend('Draw a green Ferrari');

    await h.rtl.waitFor(() => expect(h.view!.getByText(/A green Ferrari$/)).toBeTruthy());
    expect(h.view!.getByText(/Generating Image/)).toBeTruthy();
    h.boundary.llama!.releaseStream();

    await h.rtl.waitFor(() => expect(sentPrompts).toEqual(['A green Ferrari on a coast road at sunset']));
    expect(h.view!.getByTestId('image-generation-working-indicator')).toBeTruthy();
    finishImage!();
    await h.rtl.waitFor(() => expect(h.view!.getByText(/Generated image for: “Draw a green Ferrari”/)).toBeTruthy());
    expect(h.view!.queryByText('0/1')).toBeNull();
  });

  it('shows a remote text-model rejection and uses the original image prompt', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.ejectAll();
    const server = await remoteServerManager.addServer({
      name: 'Desktop image server',
      endpoint: 'http://192.168.1.5:7881',
      providerType: 'openai-compatible',
      mediaModels: { image: 'remote-image' },
    });
    await remoteServerManager.setActiveRemoteMediaModel(server.id, 'image', 'remote-image');
    await remoteServerManager.setActiveRemoteTextModel(server.id, 'remote-text');

    const sentPrompts: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { prompt?: string };
      sentPrompts.push(body.prompt ?? '');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' }] }),
      } as Response;
    }) as typeof fetch;
    const remoteText = installRemoteStream(
      '__PAUSE__\n' + 'data: {"error":{"message":"Loading model"}}\n\n',
    );

    h.render();
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(h.view!.getByText('IMAGE GENERATION'));
    h.rtl.fireEvent.press(h.view!.getByTestId('image-enhance-on'));
    h.rtl.fireEvent.press(h.view!.getByText('Done'));
    await h.cycleImageMode();
    await h.tapSend('Draw a green Ferrari');

    await h.rtl.waitFor(() => expect(h.view!.getAllByText(/Enhancing your prompt/).length).toBeGreaterThan(0));
    expect(h.view!.getByText('Generating Image')).toBeTruthy();
    remoteText.release();

    await h.rtl.waitFor(() => expect(sentPrompts).toEqual(['Draw a green Ferrari']));
    expect(h.view!.getByText(/Prompt enhancement skipped: Loading model/)).toBeTruthy();
    expect(h.view!.getByText(/Generated image for: “Draw a green Ferrari”/)).toBeTruthy();
    expect(h.view!.queryByText('0/1')).toBeNull();
  });
});
