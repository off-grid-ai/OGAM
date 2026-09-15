/** A failed remote stream is replaced by another discovered model in the real chat UI. */
import { setupChatScreen } from '../../harness/chatHarness';
import { installRemoteStream } from '../../harness/remoteHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const FAILED_STREAM =
  'data: {"choices":[{"delta":{"content":"Failed route partial."}}]}\n\n' +
  'data: {"error":{"message":"Model unavailable"}}\n\n';
const BACKUP_STREAM =
  'data: {"choices":[{"delta":{"content":"Backup answer."}}]}\n\n' +
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
  'data: [DONE]\n\n';

describe('remote model fallback in chat', () => {
  it('shows the change, removes failed text, and names the model that answered', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { useRemoteServerStore } = require('../../../src/stores');
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/models')) {
        return {
          ok: true,
          json: async () => ({ object: 'list', data: [
            { id: 'first-model', object: 'model', owned_by: 'test' },
            { id: 'backup-model', object: 'model', owned_by: 'test' },
          ] }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof global.fetch;
    try {
      const server = await remoteServerManager.addServer({
        name: 'Model server', endpoint: 'http://localhost:1234', providerType: 'openai-compatible',
      });
      await useRemoteServerStore.getState().discoverModels(server.id);
      await remoteServerManager.setActiveRemoteTextModel(server.id, 'first-model');
    } finally {
      global.fetch = originalFetch;
    }
    installRemoteStream([FAILED_STREAM, BACKUP_STREAM]);
    h.render();
    h.enableGenerationDetailsViaUI();
    await h.tapSend('Answer me');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Backup answer/)).not.toBeNull();
      expect(h.view!.queryByTestId('tool-result-label-model_fallback')).not.toBeNull();
    }, { timeout: 8000 });
    await h.rtl.act(async () => {
      let action: any = h.view!.getByText('Generation details');
      while (action && typeof action.props.onPress !== 'function') action = action.parent;
      expect(action).not.toBeNull();
      action.props.onPress();
    });
    await h.rtl.waitFor(() => expect(h.view!.queryByTestId('generation-meta')).not.toBeNull());
    expect(h.view!.queryByText(/backup-model/)).not.toBeNull();
    expect(h.view!.queryByText(/Failed route partial/)).toBeNull();
  });

  it('uses a downloaded local model when no other remote model is available', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.boundary.llama!.scriptCompletion({ text: 'Local answer.' });
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { useRemoteServerStore } = require('../../../src/stores');
    const originalFetch = global.fetch;
    global.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/models')) {
        return { ok: true, json: async () => ({ object: 'list', data: [
          { id: 'first-model', object: 'model', owned_by: 'test' },
        ] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof global.fetch;
    try {
      const server = await remoteServerManager.addServer({
        name: 'Model server', endpoint: 'http://localhost:1234', providerType: 'openai-compatible',
      });
      await useRemoteServerStore.getState().discoverModels(server.id);
      await remoteServerManager.setActiveRemoteTextModel(server.id, 'first-model');
    } finally {
      global.fetch = originalFetch;
    }
    installRemoteStream(FAILED_STREAM);
    h.render();
    h.enableGenerationDetailsViaUI();
    await h.tapSend('Answer me');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Local answer/)).not.toBeNull();
      expect(h.view!.queryByTestId('tool-result-label-model_fallback')).not.toBeNull();
    }, { timeout: 8000 });
    await h.rtl.act(async () => {
      let action: any = h.view!.getByText('Generation details');
      while (action && typeof action.props.onPress !== 'function') action = action.parent;
      expect(action).not.toBeNull();
      action.props.onPress();
    });
    expect(h.view!.queryByText('Test Model')).not.toBeNull();
    expect(h.view!.queryByText(/Failed route partial/)).toBeNull();
    expect(useRemoteServerStore.getState().activeRemoteTextModelId).toBeNull();
  });
});
