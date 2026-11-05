/**
 * RED-FLOW (rendered) — hand test 11 (2026-11-05): Stop pressed while "Loading <model>…" showed stopped
 * the reply, but left the question with no "Try again" under it (Resend in the menu was the only way).
 *
 * Real ChatScreen, real send, real model load held open in its load window, real Stop button.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

function pressByWalkingUp(node: unknown): void {
  type N = { props?: Record<string, unknown>; parent?: N | null } | null;
  let n = node as N;
  for (let d = 0; n && d < 12; d++) {
    const op = n.props?.onPress;
    if (typeof op === 'function') { (op as () => void)(); return; }
    n = n.parent ?? null;
  }
  throw new Error('no onPress found walking up from the node');
}

describe('Stop during a model load', () => {
  it('leaves Try again under the question, and no reply', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama', platform: 'ios', deferInitialLoad: true });
    h.boundary.llama!.scriptMultimodalHold();
    h.render();
    h.boundary.llama!.scriptCompletion({ text: 'This must not appear.' });
    await h.tapSend('[test] hi');

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Loading Test Model/)).not.toBeNull();
    });
    await h.rtl.act(async () => { pressByWalkingUp(h.view!.getByTestId('stop-button')); });
    h.boundary.llama!.releaseMultimodalHold();

    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('unanswered-retry')).not.toBeNull();
    }, { timeout: 5000 });
    expect(h.view!.queryByText('This must not appear.')).toBeNull();
  });
});
