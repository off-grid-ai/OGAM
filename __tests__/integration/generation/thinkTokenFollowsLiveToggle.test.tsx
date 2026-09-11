/**
 * DEVICE 2026-07-14 — toggling thinking was off-by-one: the <|think|> activation decision followed a
 * STALE render snapshots once made the activation apply one turn late. The canonical GenerationRequest
 * now carries the current setting into Shared policy at the native boundary.
 *
 * This drives the real Chat screen, Shared generation service, Shared text-engine control plane,
 * and Mobile LiteRT port. Only the native LiteRT module is faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('thinking toggle applies to the next turn (no off-by-one) — device 2026-07-14', () => {
  it('the next native LiteRT prompt follows the current rendered Thinking toggle', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' }); // litert model 'm' loaded
    h.render();
    const baseline = h.boundary.litert!.calls.sendMessage.length;

    await h.send('first prompt', { content: 'First reply' });
    await h.rtl.waitFor(() => {
      expect(h.boundary.litert!.calls.sendMessage).toHaveLength(baseline + 1);
      expect(h.view!.queryByText('First reply')).not.toBeNull();
    });
    expect(h.boundary.litert!.calls.sendMessage[baseline][0]).toBe('first prompt');

    // Real gesture: quick settings -> Thinking. The next send must use this setting immediately.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-settings-button')));
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => h.view!.getByTestId('quick-thinking-toggle')));
    await h.send('second prompt', { content: 'Second reply' });
    await h.rtl.waitFor(() => {
      expect(h.boundary.litert!.calls.sendMessage).toHaveLength(baseline + 2);
      expect(h.view!.queryByText('Second reply')).not.toBeNull();
      expect(h.useChatStore.getState().isStreaming).toBe(false);
    });
    expect(h.boundary.litert!.calls.sendMessage[baseline + 1][0]).toBe('<|think|>\nsecond prompt');
  });
});
