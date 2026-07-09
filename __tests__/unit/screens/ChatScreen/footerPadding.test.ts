/**
 * Unit tests for computeFooterPaddingBottom — the bottom safe-area padding under
 * the chat input row. The regression this guards: on a device with an opaque
 * 3-button navigation bar (a tall bottom inset), the old 4px cap left the input
 * controls rendered UNDERNEATH the nav buttons. A thin iOS home-indicator /
 * gesture-nav overlay inset must still be capped so it doesn't look like a dead
 * band. The keyboard-open case collapses to 0.
 */
import { computeFooterPaddingBottom, shouldShowEvictedBar } from '../../../../src/screens/ChatScreen/ChatMessageArea';

describe('computeFooterPaddingBottom', () => {
  it('collapses to 0 while the keyboard is visible, regardless of inset', () => {
    expect(computeFooterPaddingBottom(true, 0)).toBe(0);
    expect(computeFooterPaddingBottom(true, 24)).toBe(0);
    expect(computeFooterPaddingBottom(true, 48)).toBe(0);
  });

  it('caps a thin overlay inset (iOS home indicator / gesture nav) at 4', () => {
    expect(computeFooterPaddingBottom(false, 0)).toBe(0);
    expect(computeFooterPaddingBottom(false, 4)).toBe(4);
    expect(computeFooterPaddingBottom(false, 24)).toBe(4); // at the overlay ceiling
  });

  it('honors the full inset for an opaque 3-button nav bar (tall inset)', () => {
    // Regression: OnePlus/Oppo 3-button nav bar. Must NOT cap to 4 or the input
    // controls sit under the nav buttons.
    expect(computeFooterPaddingBottom(false, 48)).toBe(48);
    expect(computeFooterPaddingBottom(false, 36)).toBe(36);
    expect(computeFooterPaddingBottom(false, 25)).toBe(25); // just above the ceiling
  });
});

describe('shouldShowEvictedBar', () => {
  // Minimal chat shape — only the fields the helper reads. Cast through unknown so
  // the test isn't coupled to the full useChatScreen return type.
  const base = {
    textModelEvicted: true,
    isModelLoading: false,
    isCompacting: false,
    isGeneratingImage: false,
    activeModelId: 'org/model/file.gguf',
    activeModelInfo: { isRemote: false },
    displayMessages: [{ role: 'user' }],
  };
  const make = (over: Record<string, unknown>) =>
    shouldShowEvictedBar({ ...base, ...over } as unknown as Parameters<typeof shouldShowEvictedBar>[0]);

  it('shows when a text model was evicted and the last message is an unanswered user turn', () => {
    expect(make({})).toBe(true);
  });

  it('hides after a completed turn (last message is an assistant reply) — the misplaced-banner regression', () => {
    // Regression: an image turn evicts the text model, then completes. The last
    // message is the assistant image, so nothing text is pending — bar must hide.
    expect(make({ displayMessages: [{ role: 'user' }, { role: 'assistant' }] })).toBe(false);
  });

  it('hides while an image is generating even if the last message is the user request', () => {
    expect(make({ isGeneratingImage: true })).toBe(false);
  });

  it('hides when the model is (re)loading or compacting', () => {
    expect(make({ isModelLoading: true })).toBe(false);
    expect(make({ isCompacting: true })).toBe(false);
  });

  it('hides for a remote model or when nothing is selected', () => {
    expect(make({ activeModelInfo: { isRemote: true } })).toBe(false);
    expect(make({ activeModelId: null })).toBe(false);
  });

  it('hides when no text model was evicted', () => {
    expect(make({ textModelEvicted: false })).toBe(false);
  });

  it('hides on an empty conversation (no messages)', () => {
    expect(make({ displayMessages: [] })).toBe(false);
  });
});
