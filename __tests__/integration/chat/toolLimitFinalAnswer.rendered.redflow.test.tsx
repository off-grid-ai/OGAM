import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const STATIC_LIMIT_NOTICE = /This response reached the 1-step tool limit/i;
const FINAL_ANSWER = /The completed calculation result is 4\./i;

describe('tool-call limit final answer', () => {
  it('shows the llama model answer after the last allowed tool result', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    h.enableToolViaUI('calculator');
    h.setTextSettingViaUI('maxToolCalls', 1);
    h.render();
    h.boundary.llama!.scriptCompletions([
      {
        text: '',
        toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }],
      },
      {
        text: 'The completed calculation result is 4.',
        pauseAfter: 'The completed',
      },
    ]);

    const send = h.tapSend('calculate 2+2, then search for Off Grid AI');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/The completed/i)).not.toBeNull();
    });
    expect(h.view!.queryByText(FINAL_ANSWER)).toBeNull();

    h.boundary.llama!.releaseStream();
    await send;

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(FINAL_ANSWER)).not.toBeNull();
    });
    expect(h.view!.queryByText(STATIC_LIMIT_NOTICE)).toBeNull();
  });

  it('shows the LiteRT model answer after the last allowed tool result', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.enableToolViaUI('calculator');
    h.setTextSettingViaUI('maxToolCalls', 1);
    h.render();
    h.boundary.litert.scriptTurns([
      {
        content: '',
        toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }],
      },
      { content: 'The completed calculation result is 4.' },
    ]);

    await h.tapSend('calculate 2+2, then search for Off Grid AI');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(FINAL_ANSWER)).not.toBeNull();
    });
    await h.rtl.waitFor(() => {
      expect(
        h.view!.queryByTestId('tool-result-label-calculator'),
      ).not.toBeNull();
    });
    expect(h.view!.queryByText(STATIC_LIMIT_NOTICE)).toBeNull();
  });
});
