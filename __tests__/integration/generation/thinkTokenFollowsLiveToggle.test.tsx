/**
 * DEVICE 2026-07-14 — toggling thinking was off-by-one: the <|think|> activation decision followed a
 * STALE render snapshot (genDeps.settings) threaded into wantsLeadingThinkToken, so a toggle only took
 * effect on the turn AFTER. Fix: wantsLeadingThinkToken reads the thinking setting LIVE from the store.
 *
 * This drives the REAL wantsLeadingThinkToken with a REAL LiteRT model loaded (the engine that lagged —
 * its branch used the passed-in value) over the store, and asserts the decision follows the CURRENT
 * toggle immediately — no stale value can change it, because the function no longer accepts one.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('thinking toggle applies to the next turn (no off-by-one) — device 2026-07-14', () => {
  it('the <|think|> activation follows the LIVE thinking setting, not a stale snapshot (LiteRT loaded)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' }); // litert model 'm' loaded
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { wantsLeadingThinkToken } = require('../../../src/services/engines');
    /* eslint-enable @typescript-eslint/no-var-requires */
    const model = h.useAppStore.getState().downloadedModels.find((m: { id: string }) => m.id === 'm');

    // Toggle OFF → the decision is OFF on the very next read (no one-turn lag).
    h.useAppStore.getState().updateSettings({ thinkingEnabled: false });
    expect(wantsLeadingThinkToken(model, { isRemote: false })).toBe(false);

    // Toggle ON → the decision is ON immediately, from the live store value.
    h.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    expect(wantsLeadingThinkToken(model, { isRemote: false })).toBe(true);

    // And OFF again immediately — the toggle is never a turn behind.
    h.useAppStore.getState().updateSettings({ thinkingEnabled: false });
    expect(wantsLeadingThinkToken(model, { isRemote: false })).toBe(false);
  });
});
