/**
 * GUARD (UI, BEHAVIORAL) — N3 revisited: a draw request with NO image model is handled safely; the internal
 * "[User wanted an image…]" marker is NEVER leaked into the text model's prompt.
 *
 * What UI-driven testing revealed: the original N3 red drove dispatchGenerationFn directly with
 * imageMode:'force' + no image model — but that state is UNREACHABLE through the real UI on two fronts:
 *   1. shouldRouteToImageGenerationFn (useChatGenerationActions.ts:159) returns FALSE in auto mode when no
 *      image model is selected — it skips the classifier entirely, so shouldGenerateImage is never true and
 *      the marker branch (:447) never runs.
 *   2. the ChatInput image-mode toggle alerts "No Image Model" and REFUSES to enter 'force' when none is
 *      downloaded (ChatInput/index.tsx:197-202).
 * So the marker-leak "bug" cannot happen to a user. This is the GREEN guard that locks that safety: on the
 * real ChatScreen, a "draw …" send with no image model routes cleanly to text and no marker reaches the
 * engine. Only the native LiteRT leaf is faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('N3 (guard) — draw request with no image model routes safely', () => {
  it('does not leak the internal image marker into the text model prompt', async () => {
    const h = await setupChatScreen({ engine: 'litert' });
    h.useAppStore.getState().updateSettings({ autoDetectMethod: 'pattern', imageGenerationMode: 'auto' });
    h.render();

    await h.send('draw a dragon', { content: 'A dragon is a large mythical reptile.' });
    await h.rtl.waitFor(() => { expect(h.view!.queryByText(/A dragon is a large mythical reptile\./)).not.toBeNull(); });

    // Clean routing: no "[User wanted an image…]" marker reached the engine.
    const sentTexts = h.boundary.litert.calls.generateRaw.map((c: unknown[]) => String(c[0]));
    expect(sentTexts.some((t: string) => /User wanted an image/i.test(t))).toBe(false);
  });
});
