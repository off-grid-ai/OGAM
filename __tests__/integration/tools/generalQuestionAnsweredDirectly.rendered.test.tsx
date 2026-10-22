/**
 * A general question with tools on goes to the model with guidance to answer it from what it knows.
 *
 * DEVICE GROUND TRUTH (2026-10-22, Android, Qwen3.5 0.8B, default tools on): "Name two rivers." got "I
 * don't have access to a tool that can list specific river names"; "Explain how cheese is made." called
 * the knowledge-base search, found nothing, then refused. The tool guidance told the model to use a tool
 * when unsure and never to refuse "when a tool is available", which a small model read as "only answer
 * through a tool". Real chat and tool loop; llama.rn faked at the native boundary only.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('a general question with tools on', () => {
  it('reaches the model with guidance to answer directly, and the answer shows', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    h.boundary.llama!.scriptCompletion({ text: 'The Nile and the Amazon.' });
    await h.tapSend('Name two rivers.');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/The Nile and the Amazon\./)).not.toBeNull();
    }, { timeout: 8000 });

    const sentToModel = JSON.stringify(h.boundary.llama!.calls.completion[0]);
    expect(sentToModel).toContain('Answer general-knowledge questions directly from what you know');
    expect(sentToModel).toContain('never refuse a question just because no tool fits it');
    expect(sentToModel).not.toContain('Never refuse or say you cannot help when a tool is available');
  }, 30000);
});
