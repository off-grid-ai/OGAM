/**
 * Stopping a reply has ONE owner, and it has to work for whichever engine is running.
 *
 * `generationService.stopGeneration()` is that owner: it stops every registered text engine, aborts a remote
 * request's connection, and keeps whatever had already streamed. Three call sites used to reach past it and
 * call `llmService.stopGeneration()` directly - and llmService is llama.cpp ONLY. So on a LiteRT model (or a
 * remote one) those paths stopped nothing at all, while the UI cleared the stream: tokens kept arriving for a
 * reply the user could no longer see, the NPU kept working, and a remote request kept billing.
 *
 * Asserted at the NATIVE engine, which is the only place the answer is unambiguous: our service believing it
 * stopped is the bug, not the proof. LiteRT is the engine under test precisely because it is the one the old
 * llama-only call could not reach.
 *
 * The unload-while-streaming path is NOT covered here, for two separate reasons found while writing it:
 * `handleUnloadModelFn` (the fixed site) is reached from ModelSelectorModal's "Unload", which chat's model
 * chip no longer opens - the chip opens ModelsManagerSheet, whose per-row eject goes through
 * `modelResidencyManager.evictByKey` instead and never touches the generation owner. Against a streaming
 * LiteRT reply that path calls native unloadModel and NEVER stopGeneration, which is a live bug recorded in
 * docs/GAPS_BACKLOG.md rather than papered over with a test written around it.
 *
 * Mid-turn cleanup now reaches every native conversation through the Shared text-engine control plane.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

/** A LiteRT reply that has streamed a partial and is still in flight - never completes on its own. */
async function streamingLiteRTReply(h: Awaited<ReturnType<typeof setupChatScreen>>) {
  h.render();
  h.boundary.litert.scriptPartialThenHang('Half a thought');
  await h.tapSend('tell me something');
  await h.rtl.waitFor(() => {
    expect(h.view!.queryByText(/Half a thought/)).not.toBeNull();
  });
  // Nothing has told the engine to stop yet - the baseline the assertions below move off.
  expect(h.boundary.litert.module.stopGeneration).not.toHaveBeenCalled();
}

describe('stopping a LiteRT reply that is still streaming', () => {
  it('deleting the conversation tells the LiteRT engine to stop', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    await streamingLiteRTReply(h);

    // Delete the conversation from the chat's own menu, confirming the alert - the real path.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('chat-settings-icon')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByText(/Delete Chat|Delete Conversation/)));
    const confirm = await h.rtl.waitFor(() => h.view!.getByText(/^Delete$/));
    h.rtl.fireEvent.press(confirm);

    // A stream left running writes tokens into a conversation that no longer exists.
    await h.rtl.waitFor(() => {
      expect(h.boundary.litert.module.stopGeneration).toHaveBeenCalled();
    });
  });
});
