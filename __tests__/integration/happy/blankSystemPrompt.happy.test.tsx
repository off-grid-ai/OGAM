/**
 * A blank default prompt ("\n", saved by an older build or synced from another device) is no prompt:
 * chat sends the built-in one, never an empty instruction. Real ChatScreen and generation pipeline;
 * native LiteRT faked at the boundary (records resetConversation's system prompt).
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { APP_CONFIG } from '../../../src/constants';
import { useAppStore } from '../../../src/stores/appStore';

jest.unmock('@react-navigation/native');

describe('happy — a blank default prompt sends the built-in prompt', () => {
  it.each([['\n'], ['   ']])('sends APP_CONFIG.defaultSystemPrompt when the saved prompt is %p', async blank => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    useAppStore.getState().updateSettings({ systemPrompt: blank });
    h.render();

    await h.send('hello', { content: 'Hi.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/Hi\./)).not.toBeNull(); });

    // resetConversation(systemPrompt, temperature, topK, topP, toolsJson, historyJson)
    const calls = h.boundary.litert.calls.resetConversation;
    const sent = String(calls[calls.length - 1][0]);
    expect(sent).toContain(APP_CONFIG.defaultSystemPrompt);
    expect(sent.trim()).not.toBe('');
  });
});
