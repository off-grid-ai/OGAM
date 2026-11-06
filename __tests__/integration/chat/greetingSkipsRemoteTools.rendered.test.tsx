import { setupChatScreen } from '../../harness/chatHarness';



// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('greeting with remote tools enabled', () => {
  it('answers on the selected model without sending unrelated remote tools', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios', pro: true, backupModel: true });
    h.enableGenerationDetailsViaUI();
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
    // Knowledge search is not offered in a chat with no documents (searchableKnowledge), so 2, not 3.
    h.rtl.fireEvent.press(h.view!.getAllByTestId('generation-details-toggle').at(-1)!);
    const offered = h.view!.getAllByTestId('tools-sent-list').at(-1)!;
    const names = String(offered.props.children).replace(/^Tools it had for this reply: /, '').split(', ');
    expect(names).toHaveLength(2);
    expect(offered).not.toHaveTextContent(/Remote action|remote_action/);
    expect(h.view!.queryByTestId('tool-result-label-model_fallback')).toBeNull();
    mcp.removeServer('greeting-server');
  });
});
