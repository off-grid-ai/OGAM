/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — a built-in tool runs end to end: with the calculator
 * tool enabled, the user asks a question, the model emits a tool call, the REAL calculator executes, and
 * the user sees the tool-result bubble + the model's answer.
 *
 * Real ChatScreen + real generationToolLoop + real calculator tool + real engine; only the native LiteRT
 * leaf is faked. This is the green complement to the Q2/Q3/Q5 tool red-flows.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('happy — a tool runs and its result renders (heavy entry point)', () => {
  it('calculator: tool call executes and the answer renders', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    // Enable the calculator tool the way the UI does (settings the send path reads).
    h.useAppStore.getState().updateSettings({ enabledTools: ['calculator'] });
    h.render();

    // The model emits a calculator tool call; after the tool runs it answers with the result.
    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: 'The answer is 4.' });

    // The user sees the tool-result bubble (the calculator actually ran)...
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull(); });
    // ...and the model's final answer.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 4\./)).not.toBeNull(); });
  });

  it('MCP: a registered MCP tool executes and its result reaches the answer', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { registerToolExtension, _clearExtensionsForTesting } = require('../../../src/services/tools/extensions');
    /* eslint-enable @typescript-eslint/no-var-requires */
    _clearExtensionsForTesting();
    let executed = false;
    registerToolExtension({
      id: 'mcp',
      getSystemPromptHint: () => '',
      getOpenAISchemas: () => [{ type: 'function', function: { name: 'mcp_weather', description: 'weather', parameters: { type: 'object', properties: {} } } }],
      parseToolCalls: () => [],
      stripFromVisibleText: (t: string) => t,
      canHandle: (name: string) => name === 'mcp_weather',
      execute: async (call: { id: string; name: string }) => { executed = true; return { toolCallId: call.id, name: call.name, content: 'Sunny, 24C', durationMs: 1 }; },
      enabledToolCount: () => 1,
    });
    h.render();

    await h.send('what is the weather', { toolCalls: [{ name: 'mcp_weather', arguments: {} }], content: 'It is sunny and 24C.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/It is sunny and 24C\./)).not.toBeNull(); });
    expect(executed).toBe(true); // the real extension executed
    _clearExtensionsForTesting();
  });

  it('show generation details: the details row renders when enabled', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.useAppStore.getState().updateSettings({ showGenerationDetails: true });
    h.render();
    await h.send('hello', { content: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });
    // With details on, the model name is shown in the per-message details.
    expect(h.view!.queryByText(/Test Model/)).not.toBeNull();
  });
});
