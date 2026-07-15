/**
 * T018 / DEV-B23 — LiteRT on a CPU backend errors with "Status 13 Failed to invoke the compiled model".
 *
 * Device (B23 wire capture, part21): a .litertlm model (compiled GPU/backend-specific artifact) invoked on
 * the CPU backend throws Status 13 on both generateRaw AND sendMessage, reproducibly. The app OFFERS a CPU
 * backend option that then fails — so a user who picks it sends a message and gets an error, no answer.
 *
 * User behavior, real gestures: litert model active, send a message. The native runtime is modeled emitting
 * the device-shaped Status-13 error (what CPU invocation of a GPU-compiled model does). We assert the JS
 * error path renders the failure, and that NO answer reached the user (the spec outcome — a working backend
 * should produce an answer, or CPU shouldn't be offered for a GPU-compiled model).
 *
 * NATIVE step a human verifies manually: that the CPU backend ACTUALLY throws Status 13 on device for a
 * .litertlm model (the fake models that failure; the JS-decided part — surfacing it, not answering — is here).
 *
 * RED on HEAD: no assistant answer renders (the Status-13 error alert shows instead). Falsify: a normal
 * scripted turn renders an answer.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T018 (rendered) — LiteRT CPU invoke error surfaces, no answer (DEV-B23)', () => {
  it('renders no assistant answer when the litert runtime fails to invoke (Status 13)', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android' });
    h.render();

    // The native runtime fails to invoke the compiled model on this backend (device-shaped B23 error).
    h.boundary.litert.scriptError('Status Code: 13. Message: ERROR: Failed to invoke the compiled model');
    await h.tapSend('what is the capital of France');

    // Red-for-the-right-reason: the exact device error reached the user (proves we're on the B23 path).
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByText(/Failed to invoke the compiled model/)).not.toBeNull();
    }, { timeout: 4000 });

    // SPEC: the user should still get an answer (working backend) — RED (B23): none renders, only the error.
    expect(h.view!.queryAllByTestId('assistant-message').length).toBeGreaterThan(0);
  });
});
