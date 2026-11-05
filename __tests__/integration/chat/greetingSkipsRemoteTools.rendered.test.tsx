import { setupChatScreen } from '../../harness/chatHarness';

// The tools-sent row is developer detail: the chat shows it with "Show generation details" on.
beforeEach(() => {
  const { useAppStore } = require('../../../src/stores/appStore');
  useAppStore.setState((state: { settings: object }) => ({ settings: { ...state.settings, showGenerationDetails: true } }));
});


// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('greeting with remote tools enabled', () => {
  it('answers on the selected model without sending unrelated remote tools', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios', pro: true, backupModel: true });
    h.boundary.fs!.seedFile(`${h.boundary.fs!.DocumentDirectoryPath}/all-MiniLM-L6-v2-Q8_0.gguf`, 25 * 1024 * 1024);
    const { useMcpStore } = require('../../../pro/mcp/mcpStore');
    const mcp = useMcpStore.getState();
    mcp.addServer({ id: 'greeting-server', name: 'Mac tools', url: 'http://mac.local/mcp' });
    mcp.setConnectionState('greeting-server', 'connected');
    mcp.setServerTools('greeting-server', Array.from({ length: 17 }, (_, i) => ({
      name: `remote_action_${i}`,
      description: `Run remote action ${i} on the Mac`,
      inputSchema: { type: 'object', properties: {} },
    })));
    h.render();
    h.boundary.llama!.scriptCompletions([
      { text: 'none' },
      { text: 'Hello!' },
    ]);

    await h.tapSend('Hi');

    await h.rtl.waitFor(() => expect(h.view!.queryByText('Hello!')).not.toBeNull(), { timeout: 8000 });
    expect(h.view!.getByText('Tools sent in request (3)')).toBeTruthy();
    h.rtl.fireEvent.press(h.view!.getByText('Tools sent in request (3)'));
    expect(h.view!.queryByText('• remote_action_0')).toBeNull();
    expect(h.view!.queryByTestId('tool-result-label-model_fallback')).toBeNull();
    mcp.removeServer('greeting-server');
  });
});
