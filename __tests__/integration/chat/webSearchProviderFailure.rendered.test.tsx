/**
 * Web search that the provider refuses (403) or cannot serve (503) is a failed search, not an empty one.
 *
 * In a real chat turn the model calls web_search. The search provider answers with an error status. The
 * user opens the turn's work and reads the search result: it must say the search failed, and must not
 * say the web had no results for the query - that would tell the user (and the model) something false.
 *
 * Real ChatScreen, real tool loop, real web_search handler, real chat store and render. Fakes only at
 * the device boundary: the llama.rn / LiteRT engine (scripted tool call, then reply) and the search provider at
 * fetch (harness/webSearchFake).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installWebSearchFake, type WebSearchFake } from '../../harness/webSearchFake';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const QUERY = 'Off Grid AI release notes';
const REPLY = 'I could not search the web just now.';

describe('web search provider failure in a chat turn', () => {
  let search: WebSearchFake | undefined;

  afterEach(() => search?.restore());

  it.each([
    ['llama', 403],
    ['llama', 503],
    ['litert', 403],
    ['litert', 503],
  ] as const)('on %s, a search answered with HTTP %i shows as a failed search', async (engine, status) => {
    const h = await setupChatScreen({ engine, platform: engine === 'llama' ? 'ios' : 'android' });
    search = installWebSearchFake(status);
    // Web search is on by default for a new install, so the user has nothing to enable.
    h.render();
    if (engine === 'llama') {
      // llama.rn hands back tool calls in the OpenAI shape the device wire capture shows.
      h.boundary.llama!.scriptCompletions([
        {
          text: '',
          toolCalls: [{
            id: 'call_search_0',
            type: 'function',
            function: { name: 'web_search', arguments: JSON.stringify({ query: QUERY }) },
          }] as never,
        },
        { text: REPLY },
      ]);
    } else {
      h.boundary.litert.scriptTurns([
        { content: '', toolCalls: [{ name: 'web_search', arguments: { query: QUERY } }] },
        { content: REPLY },
      ]);
    }

    // Before: no search has happened in this chat.
    expect(h.view!.queryByTestId('tool-result-label-web_search')).toBeNull();

    await h.tapSend('search the web for the Off Grid AI release notes');
    await h.rtl.waitFor(() => expect(h.view!.getByText(REPLY)).toBeTruthy());

    // Open the turn's work and the search result.
    h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));
    const label = await h.rtl.waitFor(() => h.view!.getByTestId('tool-result-label-web_search'));
    expect(label).not.toHaveTextContent(/no results/i);
    h.rtl.fireEvent.press(h.view!.getByTestId('tool-result-accordion-web_search'));

    await h.rtl.waitFor(() =>
      expect(h.view!.getByText(new RegExp(`Web search is unavailable right now \\(HTTP ${status}\\)`))).toBeTruthy(),
    );
    expect(h.view!.queryByText(/No results found/i)).toBeNull();
  });
});
