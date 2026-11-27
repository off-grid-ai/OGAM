/**
 * Tools → Web search: the person points the model's searches at their own SearXNG server or their own
 * Tavily key, checks it with Test, and the next chat turn searches there.
 *
 * Real app, real navigation (Tools → Web search by tapping the row), real settings store, real Keychain
 * calls, real tool loop and web_search handler, real chat render. Fakes only at the device boundary: the
 * llama.rn engine (scripted tool call, then reply), the Keychain (stateful, harness/deviceKeychain) and
 * the network (harness/webSearchFake, which also plays the person's own server and Tavily).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { installWebSearchFake, type WebSearchFake } from '../../harness/webSearchFake';

jest.unmock('@react-navigation/native');
jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());

const SEARXNG = 'https://search.home.lan';
const TAVILY = 'https://api.tavily.com';
// The JSON shapes from each API's docs.
const SEARXNG_ANSWER = JSON.stringify({
  results: [{ title: 'Off Grid AI release notes', url: 'https://getoffgridai.co/releases', content: 'What shipped this week.' }],
});
const TAVILY_ANSWER = JSON.stringify({
  results: [{ title: 'Off Grid AI on Tavily', url: 'https://getoffgridai.co/', content: 'Private AI on your phone.' }],
});
const QUERY = 'Off Grid AI release notes';
const REPLY = 'Here is what shipped.';

async function openWebSearchSettings(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  const app = await h.openScreen('Tools');
  // Before: searches go to the built-in providers.
  expect(app.getByTestId('tool-picker-web-search-provider')).toHaveTextContent(/Built\ in/);
  h.rtl.fireEvent.press(app.getByTestId('tool-picker-open-web_search'));
  await h.rtl.waitFor(() => expect(app.getByTestId('web-search-provider-builtin')).toBeTruthy());
  expect(app.getByTestId('web-search-provider-builtin')).toHaveProp('accessibilityState', { selected: true });
  return app;
}

function scriptSearchTurn(h: Awaited<ReturnType<typeof setupChatScreen>>) {
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
}

describe('web search settings', () => {
  let search: WebSearchFake | undefined;
  afterEach(() => search?.restore());

  it('a SearXNG server set up and tested in settings answers the next chat search', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios' });
    search = installWebSearchFake(200);
    search.serve(SEARXNG, 200, SEARXNG_ANSWER);
    h.render();

    const app = await openWebSearchSettings(h);
    expect(app.queryByTestId('web-search-address')).toBeNull();

    // The pick shows as chosen at once, and its address field appears.
    h.rtl.fireEvent.press(app.getByTestId('web-search-provider-searxng'));
    expect(app.getByTestId('web-search-provider-searxng')).toHaveProp('accessibilityState', { selected: true });
    expect(app.getByTestId('web-search-provider-builtin')).toHaveProp('accessibilityState', { selected: false });

    h.rtl.fireEvent.changeText(app.getByTestId('web-search-address'), 'search.home.lan/');
    expect(app.queryByTestId('web-search-result')).toBeNull();
    h.rtl.fireEvent.press(app.getByTestId('web-search-test'));
    await h.rtl.waitFor(() => expect(app.getByTestId('web-search-result')).toHaveTextContent(/Works/));
    // The address as the app will use it, and the test asked only that server.
    expect(app.getByTestId('web-search-address')).toHaveProp('value', 'https://search.home.lan');
    expect(search.asked.map(a => new URL(a.url).origin)).toEqual([SEARXNG]);

    // Back on Tools, the row says where searches go now.
    h.rtl.fireEvent.press(app.getByTestId('web-search-back'));
    await h.rtl.waitFor(() =>
      expect(app.getByTestId('tool-picker-web-search-provider')).toHaveTextContent(/Your\ SearXNG\ server/),
    );

    // A chat turn searches the person's server first.
    await h.openScreen('Chat');
    scriptSearchTurn(h);
    await h.tapSend('search the web for the Off Grid AI release notes');
    await h.rtl.waitFor(() => expect(h.view!.getByText(REPLY)).toBeTruthy());
    const chatSearch = search.asked[search.asked.length - 1]!;
    expect(chatSearch.url).toBe(`${SEARXNG}/search?q=Off%20Grid%20AI%20release%20notes&format=json`);

    h.rtl.fireEvent.press(h.view!.getByTestId('assistant-work-toggle'));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('tool-result-accordion-web_search')));
    // What the person reads in the turn's work: the server's result.
    await h.rtl.waitFor(() => expect(h.view!.getByText(/What shipped this week\./)).toBeTruthy());
  });

  it('a Tavily key is kept on the device, a refused key says why, and the key can be removed', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'android' });
    search = installWebSearchFake(200);
    search.serve(TAVILY, 401, '{"detail":"Unauthorized"}');
    h.render();

    const app = await openWebSearchSettings(h);
    h.rtl.fireEvent.press(app.getByTestId('web-search-provider-tavily'));

    // Test with nothing typed says what is missing.
    h.rtl.fireEvent.press(app.getByTestId('web-search-test'));
    await h.rtl.waitFor(() => expect(app.getByTestId('web-search-result')).toHaveTextContent(/Add\ your\ key\ first\./));

    // A key Tavily refuses: the reason, and the key is still kept to replace.
    h.rtl.fireEvent.changeText(app.getByTestId('web-search-key'), 'tvly-wrong');
    h.rtl.fireEvent.press(app.getByTestId('web-search-test'));
    await h.rtl.waitFor(() =>
      expect(app.getByTestId('web-search-result')).toHaveTextContent(/Did not answer.*the key or server refused the request/),
    );
    expect(search.asked[0]!.headers.Authorization).toBe('Bearer tvly-wrong');
    expect(app.getByTestId('web-search-key-saved')).toBeTruthy();
    expect(app.queryByTestId('web-search-key')).toBeNull();

    // Replace it with a working key.
    search.serve(TAVILY, 200, TAVILY_ANSWER);
    h.rtl.fireEvent.press(app.getByTestId('web-search-replace-key'));
    h.rtl.fireEvent.changeText(app.getByTestId('web-search-key'), 'tvly-good');
    h.rtl.fireEvent.press(app.getByTestId('web-search-test'));
    await h.rtl.waitFor(() => expect(app.getByTestId('web-search-result')).toHaveTextContent(/Works/));
    expect(search.asked[search.asked.length - 1]!.headers.Authorization).toBe('Bearer tvly-good');

    // Leaving and coming back finds the key still saved on the device.
    h.rtl.fireEvent.press(app.getByTestId('web-search-back'));
    await h.rtl.waitFor(() => expect(app.getByTestId('tool-picker-web-search-provider')).toHaveTextContent(/Tavily/));
    h.rtl.fireEvent.press(app.getByTestId('tool-picker-open-web_search'));
    await h.rtl.waitFor(() => expect(app.getByTestId('web-search-key-saved')).toBeTruthy());

    // Remove: the field comes back, and a search falls back to the built-in providers.
    h.rtl.fireEvent.press(app.getByTestId('web-search-remove-key'));
    await h.rtl.waitFor(() => expect(app.getByTestId('web-search-key')).toBeTruthy());
    h.rtl.fireEvent.press(app.getByTestId('web-search-test'));
    await h.rtl.waitFor(() => expect(app.getByTestId('web-search-result')).toHaveTextContent(/Add\ your\ key\ first\./));
  });
});
