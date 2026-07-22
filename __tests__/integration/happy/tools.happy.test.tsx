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
    // Arrive-via-UI: enable the calculator on the real Tools screen (flip its switch), then chat.
    h.enableToolViaUI('calculator');
    h.render();

    // The model emits a calculator tool call; after the tool runs it answers with the result.
    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: 'The answer is 4.' });

    // The user sees the tool-result bubble (the calculator actually ran)...
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull(); });
    // ...and the model's final answer.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 4\./)).not.toBeNull(); });
  });

  it('datetime: tool call executes and the answer renders', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.enableToolViaUI('get_current_datetime');
    h.render();

    await h.send('what time is it in UTC?', {
      toolCalls: [
        { name: 'get_current_datetime', arguments: { timezone: 'UTC' } },
      ],
      content: 'I retrieved the current UTC date and time.',
    });

    await h.rtl.waitFor(() => {
      expect(
        h.view!.queryByTestId('tool-result-label-get_current_datetime'),
      ).not.toBeNull();
      expect(
        h.view!.queryByText(/I retrieved the current UTC date and time\./),
      ).not.toBeNull();
    });
  });

  it('device info: tool call executes and the answer renders', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.enableToolViaUI('get_device_info');
    h.render();

    await h.send('how much memory does this device have?', {
      toolCalls: [
        { name: 'get_device_info', arguments: { info_type: 'memory' } },
      ],
      content: 'I retrieved the device memory information.',
    });

    await h.rtl.waitFor(() => {
      expect(
        h.view!.queryByTestId('tool-result-label-get_device_info'),
      ).not.toBeNull();
      expect(
        h.view!.queryByText(/I retrieved the device memory information\./),
      ).not.toBeNull();
    });
  });

  it('MCP: a registered MCP tool executes and its result reaches the answer', async () => {
    const h = await setupChatScreen({ engine: 'litert' });

    const { registerToolExtension, _clearExtensionsForTesting } = require('../../../src/services/tools/extensions');

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

  it('T044: two parallel calculator calls render two tool-result bubbles, both correct', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.enableToolViaUI('calculator');
    h.render();
    // The model emits TWO calculator tool calls in one turn (parallel, index 0+1); the real tool loop runs
    // both and the answer carries both results.
    await h.send('compute 500*321 and 12+13', {
      toolCalls: [
        { name: 'calculator', arguments: { expression: '500*321' } },
        { name: 'calculator', arguments: { expression: '12+13' } },
      ],
      content: 'Results: 160500 and 25.',
    });
    // Two tool-result bubbles render (both calculator runs are visible).
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByTestId('tool-result-label-calculator')).toHaveLength(2); });
    // ...and the answer with both results renders.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/160500 and 25/)).not.toBeNull(); });
  });

  it('show generation details: the details row renders when enabled', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.enableGenerationDetailsViaUI(); // real segmented toggle
    h.render();
    await h.send('hello', { content: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });
    // With details on, the model name is shown in the per-message details.
    expect(h.view!.queryByText(/Test Model/)).not.toBeNull();
  });
});
