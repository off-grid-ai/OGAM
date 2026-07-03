/**
 * Unit tests for computeFooterPaddingBottom — the bottom safe-area padding under
 * the chat input row. The regression this guards: on a device with an opaque
 * 3-button navigation bar (a tall bottom inset), the old 4px cap left the input
 * controls rendered UNDERNEATH the nav buttons. A thin iOS home-indicator /
 * gesture-nav overlay inset must still be capped so it doesn't look like a dead
 * band. The keyboard-open case collapses to 0.
 */
import { computeFooterPaddingBottom } from '../../../../src/screens/ChatScreen/ChatMessageArea';

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
