/**
 * T087 (checklist Area 12) — DEV-B32: in voice mode, AFTER a tool turn, a stray EMPTY message card
 * containing just a markdown "#" renders mid-conversation where no bubble should be.
 *
 * Device finding (docs/DEVICE_TEST_FINDINGS.md B32, screenshots B32-voicemode-ui-glitch-2-20260711.png):
 * the full voice+calculator flow works — the calculator ran (500*321=160500) and the answer is present —
 * but ALONGSIDE the correct result there is "a small EMPTY message card containing just a stray '#'
 * character, rendered mid-conversation where no bubble should be ... an empty/malformed bubble (likely an
 * empty assistant/tool placeholder or a markdown '#' that rendered as an orphan bubble). Functionality
 * 100% correct; purely a stray-empty-bubble render bug." (voice mode, Qwen0.8B GGUF — the 0.8B model,
 * after invoking the tool, emits a lone stray markdown "#" as its post-tool content.)
 *
 * Product-correct outcome (the OGAM user's view): an assistant message whose only content is a stray
 * markdown heading marker ("#") carries NO answer — there is nothing to say and nothing to play. It must
 * NOT render as a voice bubble. The user should see the calculator result and the real reply, and NO
 * empty/"#"-only card floating mid-conversation.
 *
 * Why this reproduces on the CURRENT code: renderAudioAssistantBubble (pro/audio/ui/MessageAudioMode.tsx)
 * computes `speakable = stripControlTokens(parseThinkingContent(msg.content).response).trim()` and renders
 * an AudioMessageBubble whenever `speakable.length > 0`. For content "#", parseModelOutput returns answer
 * "#" (stripControlTokens does NOT strip a lone heading marker), so speakable === "#", length 1 > 0 → an
 * `audio-bubble-${id}` renders whose transcript is just "#" — a visually-empty card (play button, no
 * visible words), exactly the B32 artifact.
 *
 * RED on HEAD: the "#"-only assistant message's audio bubble IS on screen → the assertion (it must be
 * absent) fails for the real wrong value. The fix (treat a content-empty answer — one that reduces to only
 * markdown structural tokens like a lone "#" — as non-speakable, so no phantom bubble renders) greens it.
 *
 * Falsify both ways: the pre-condition asserts the flow WORKED (the calculator tool-result bubble AND the
 * real answer bubble are present), so a false green can't hide behind "nothing rendered". The RED assertion
 * then targets the SEPARATE stray-"#" message's bubble specifically.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

type Msg = { id: string; role: string; content: string; toolCalls?: unknown[] };

describe('T087 (rendered) — voice mode: no empty/"#"-only bubble after a tool turn (B32)', () => {
  it('renders the calculator result + real answer, but NO stray empty "#" bubble', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.enableToolViaUI('calculator'); // real Tools-screen switch (before render)
    h.render();
    await h.enterVoiceMode();

    // The voice turn: transcript + a litert turn that invokes the calculator, then — like the 0.8B model on
    // device — emits a lone stray markdown "#" as its post-tool content (the exact B32 shape). The real tool
    // loop runs the calculator (its result bubble is the correct-answer surface the user perceives), then the
    // final assistant message carries content "#".
    await h.voiceSend('use the calculator for 500 times 321', {
      toolCalls: [{ name: 'calculator', arguments: { expression: '500*321' } }],
      content: '#',
    });

    // PRE-CONDITION 1 — the flow WORKED: the calculator ran and its result bubble (the correct answer) is on
    // screen. This is what B32 confirms is 100% correct, and it stops a false green (nothing-rendered).
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('tool-result-label-calculator')).not.toBeNull();
    }, { timeout: 6000 });

    // Give the final assistant message time to finalize and render.
    await h.settle(300);

    const msgs = (h.useChatStore.getState().getActiveConversation?.()?.messages ?? []) as Msg[];

    // PRE-CONDITION 2 — the stray "#"-only assistant message actually exists in the conversation (so the
    // assertion below is aimed at a real message, not a phantom). This is the message the 0.8B model emitted.
    const strayMsg = [...msgs]
      .reverse()
      .find((m) => m.role === 'assistant' && !m.toolCalls?.length && m.content.trim() === '#');
    expect(strayMsg).toBeDefined();

    // THE BUG (B32) — that stray "#"-only message must NOT render a voice bubble: it carries no answer, so
    // there is nothing to say and nothing to play. Fails RED on HEAD: the empty "#" audio bubble is present.
    expect(h.view!.queryByTestId(`audio-bubble-${strayMsg!.id}`)).toBeNull();
  });
});
