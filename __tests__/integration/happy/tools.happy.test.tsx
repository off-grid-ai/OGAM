/**
 * HAPPY-PATH (UI integration, HEAVY entry point) — a built-in tool runs end to end: with the calculator
 * tool enabled, the user asks a question, the model emits a tool call, the REAL calculator executes, and
 * the user sees the tool-result bubble + the model's answer.
 *
 * Real ChatScreen + real generationToolLoop + real calculator tool + real engine; only the native LiteRT
 * leaf is faked. This is the green complement to the Q2/Q3/Q5 tool red-flows.
 */
import { setupChatScreen } from '../../harness/chatHarness';



// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('happy — a tool runs and its result renders (heavy entry point)', () => {
  it('web search shows intentionally escaped entity text literally', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      text: async () => `<html><body>
        <div class="result-wrapper">
          <a class="result-title" href="https://example.com/docs?label=&amp;lt;literal&amp;gt;">
            Escaped &amp;lt;literal&amp;gt; URL
          </a>
          <p class="snippet">A result with intentionally escaped URL text.</p>
        </div>
      </body></html>`,
    }) as Response;

    try {
      const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
      h.enableGenerationDetailsViaUI();
      h.enableToolViaUI('web_search');
      h.render();

      await h.send('find the escaped URL', {
        toolCalls: [{ name: 'web_search', arguments: { query: 'escaped URL' } }],
        content: 'I found the result.',
      });

      await h.rtl.waitFor(() => {
        expect(h.view!.queryByText(/I found the result\./)).not.toBeNull();
      });
      h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));
      const webResults = h.view!.getAllByTestId(
        'tool-result-accordion-web_search',
      );
      h.rtl.fireEvent.press(
        webResults[webResults.length - 1],
      );
      expect(
        h.view!.getAllByText('Escaped <literal> URL').length,
      ).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses built-in search when an MCP search tool shares its name', async () => {
    const originalFetch = globalThis.fetch;
    const {
      registerToolExtension,
      _clearExtensionsForTesting,
    } = require('../../../src/services/tools/extensions');

    globalThis.fetch = async () => ({
      text: async () => `<html><body>
        <div class="result-wrapper">
          <a class="result-title" href="https://example.com/built-in-search">
            Built-in search result
          </a>
          <p class="snippet">The mobile built-in handled this search.</p>
        </div>
      </body></html>`,
    }) as Response;
    _clearExtensionsForTesting();
    const collidingSearchExtension = {
      id: 'colliding-mcp-search',
      getSystemPromptHint: () => '',
      getOpenAISchemas: () => [{
        type: 'function',
        function: {
          name: 'web_search',
          description: 'External web search',
          parameters: {
            type: 'object',
            properties: {
              objective: { type: 'string' },
              search_queries: { type: 'array', items: { type: 'string' } },
            },
            required: ['objective', 'search_queries'],
          },
        },
      }],
      parseToolCalls: () => [],
      stripFromVisibleText: (text: string) => text,
      canHandle: (name: string) => name === 'web_search',
      execute: async (call: { id: string; name: string }) => ({
        toolCallId: call.id,
        name: call.name,
        content: 'External MCP search result',
        durationMs: 1,
      }),
      enabledToolCount: () => 1,
    };

    try {
      const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
      h.enableGenerationDetailsViaUI();
      registerToolExtension(collidingSearchExtension);
      h.enableToolViaUI('web_search');
      h.render();

      await h.send('use the built-in search', {
        toolCalls: [{ name: 'web_search', arguments: { query: 'built-in owner' } }],
        content: 'The built-in search finished.',
      });
      await h.rtl.waitFor(() => {
        expect(h.view!.queryByText(/The built-in search finished\./)).not.toBeNull();
      });
      const workToggles = h.view!.getAllByTestId('assistant-work-toggle');
      h.rtl.fireEvent.press(workToggles[workToggles.length - 1]);
      const searchResults = await h.rtl.waitFor(() =>
        h.view!.getAllByTestId('tool-result-accordion-web_search'),
      );
      h.rtl.fireEvent.press(searchResults[searchResults.length - 1]);
      expect(h.view!.getAllByText('Built-in search result').length).toBeGreaterThan(0);
      expect(h.view!.queryByText('External MCP search result')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      _clearExtensionsForTesting();
    }
  });

  it('calculator: tool call executes and the answer renders', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.enableGenerationDetailsViaUI();
    // Arrive-via-UI: enable the calculator on the real Tools screen (flip its switch), then chat.
    h.enableToolViaUI('calculator');
    h.render();

    // The model emits a calculator tool call; after the tool runs it answers with the result.
    await h.send('what is 2 + 2', { toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }], content: 'The answer is 4.' });

    h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));
    // The user sees the tool-result bubble (the calculator actually ran)...
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull(); });
    // ...and the model's final answer.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/The answer is 4\./)).not.toBeNull(); });
  });

  it('MCP: a registered MCP tool executes and its result reaches the answer', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.enableGenerationDetailsViaUI();
     
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
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.enableGenerationDetailsViaUI();
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
    h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));
    // Two tool-result bubbles render (both calculator runs are visible).
    await h.rtl.waitFor(() => { expect(h.view!.queryAllByTestId('tool-result-label-calculator').length).toBe(2); });
    // ...and the answer with both results renders.
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/160500 and 25/)).not.toBeNull(); });
  });

  it('places the time row below the answer with Details in it, and Details opens how it was made, then the tools', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.enableGenerationDetailsViaUI();
    h.enableToolViaUI('calculator');
    h.enableGenerationDetailsViaUI();
    h.render();
    await h.send('hello', { content: 'Hi there.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi there\./)).not.toBeNull(); });

    const answer = () => h.view!.getAllByTestId('assistant-message').at(-1)!;
    const order = () => [...new Set(answer().findAll(node => [
      'message-bubble', 'message-meta-row', 'generation-meta', 'tools-sent-list',
    ].includes(node.props.testID)).map(node => node.props.testID))];

    // Closed: the answer, then its time row, which carries Details. Nothing else under the answer.
    expect(order()).toEqual(['message-bubble', 'message-meta-row']);
    const metaRow = h.rtl.within(answer()).getByTestId('message-meta-row');
    expect(h.rtl.within(metaRow).getByTestId('generation-details-toggle')).toBeTruthy();

    // Open: how the reply was made, then the tools it could use.
    h.rtl.fireEvent.press(h.view!.getByTestId('generation-details-toggle'));
    expect(order()).toEqual(['message-bubble', 'message-meta-row', 'generation-meta', 'tools-sent-list']);
    expect(h.rtl.within(answer()).getByTestId('generation-meta')).toHaveTextContent(/Test Model/);
    expect(h.rtl.within(answer()).getByTestId('tools-sent-list')).toHaveTextContent(/^Tools it could use: .*Calculator/);

    // Closed again: both go.
    h.rtl.fireEvent.press(h.view!.getByTestId('generation-details-toggle'));
    expect(h.view!.queryByTestId('generation-meta')).toBeNull();
    expect(h.view!.queryByTestId('tools-sent-list')).toBeNull();
  });
});
