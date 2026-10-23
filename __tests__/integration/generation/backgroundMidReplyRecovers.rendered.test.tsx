/**
 * DEVICE (iPhone, build fd73fdfbb, Qwen3.5 2B on llama.rn Metal) — switching apps during a reply.
 *
 * 1. Send "Why do leaves change colour in autumn?", put the app in background 2 s in, come back after 4 s:
 *    the reply stopped mid-word ("…between sunlight and chlor") and was saved as a normal finished reply.
 * 2. Same chat: "What is 2 plus 2?" → the red "No response" card. Retry, and a new chat on the same model,
 *    gave the same card. Only Eject + reload brought answers back.
 *
 * Why: iOS refuses Metal command buffers in background. ggml-metal sets has_error on the context and
 * rn-completion ends the completion quietly (no EOS, no stop word, no cap, not interrupted). That error
 * sticks to the context, so every later completion on it is empty.
 *
 * Product spec: a reply that ends early says so ("Reply stopped early"), and the next send answers — the
 * model reloads by itself; the user never has to find Eject. A normal reply, a Stop, and an 'inactive'
 * blip (a banner, Control Centre) stay as they were.
 *
 * Real ChatScreen + real generation/llm/residency stack on iOS (Metal); the fake is ONLY llama.rn, with
 * the device's sticky backend-error behaviour (nativeBoundary osAppStateChanged).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const STOPPED_EARLY = /Reply stopped early\. Retry to continue\./;
const NO_RESPONSE = /The model returned nothing/;

describe('switching apps during a reply (iOS Metal, rendered)', () => {
  it('marks the cut reply as stopped early, and the next send answers in this chat and a new one', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    h.render();
    const { rtl } = h;
    const llama = h.boundary.llama!;
    const loadsBefore = llama.calls.initLlama.length;
    expect(loadsBefore).toBeGreaterThan(0);
    // The model really runs on Metal — the backend the device finding used.
    expect(Number(llama.calls.initLlama[loadsBefore - 1].n_gpu_layers)).toBeGreaterThan(0);

    // The reply streams and is mid-word when the person leaves the app.
    await h.send('Why do leaves change colour in autumn?', {
      text: 'It is the balance between sunlight and chlorophyll in the leaf.',
      pauseAfter: 'sunlight and chlor',
    } as never);
    await rtl.waitFor(() => { expect(h.view!.queryByText(/sunlight and chlor/)).not.toBeNull(); }, { timeout: 4000 });
    expect(h.view!.queryByTestId('message-cutoff-indicator')).toBeNull();

    // Background (the GPU refuses the next decode), then back to the app.
    await rtl.act(async () => { h.boundary.emitAppStateChange('background'); });
    await rtl.act(async () => { h.boundary.emitAppStateChange('active'); });

    // The cut reply keeps what streamed and says it stopped early — not a finished reply.
    await rtl.waitFor(() => { expect(h.view!.queryByTestId('message-cutoff-indicator')).not.toBeNull(); }, { timeout: 4000 });
    expect(h.view!.queryByText(STOPPED_EARLY)).not.toBeNull();
    expect(h.view!.queryByText(/sunlight and chlor/)).not.toBeNull();
    expect(h.view!.queryByText(/chlorophyll in the leaf/)).toBeNull();
    expect(h.view!.queryByTestId('stop-button')).toBeNull();

    // Same chat, no Eject: the next question is answered (the model reloaded on its own).
    await h.send('What is 2 plus 2?', { text: '2 plus 2 is 4.' });
    await rtl.waitFor(() => { expect(h.view!.queryByText(/2 plus 2 is 4\./)).not.toBeNull(); }, { timeout: 6000 });
    expect(h.view!.queryByText(NO_RESPONSE)).toBeNull();
    // Boundary record: a fresh native context was made for that answer.
    expect(llama.calls.initLlama.length).toBeGreaterThan(loadsBefore);
    const loadsAfterRecovery = llama.calls.initLlama.length;

    // A new chat on the same model answers too, with no further reload.
    await h.newChatViaHome();
    await h.send('Name a colour.', { text: 'Blue is a colour.' });
    await rtl.waitFor(() => { expect(h.view!.queryByText(/Blue is a colour\./)).not.toBeNull(); }, { timeout: 6000 });
    expect(h.view!.queryByText(NO_RESPONSE)).toBeNull();
    expect(h.view!.queryByTestId('message-cutoff-indicator')).toBeNull();
    expect(llama.calls.initLlama.length).toBe(loadsAfterRecovery);
  });

  it('a normal reply, an inactive blip, and a Stop are unchanged (no note, no reload)', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    h.render();
    const { rtl } = h;
    const llama = h.boundary.llama!;
    const loads = llama.calls.initLlama.length;

    // A banner / Control Centre makes the app 'inactive' mid-reply: the GPU keeps working, the reply finishes.
    await h.send('Say hello', { text: 'Hello there, nice to meet you.', pauseAfter: 'Hello there' } as never);
    await rtl.waitFor(() => { expect(h.view!.queryByText(/Hello there/)).not.toBeNull(); }, { timeout: 4000 });
    await rtl.act(async () => { h.boundary.emitAppStateChange('inactive'); });
    await rtl.act(async () => { h.boundary.emitAppStateChange('active'); });
    await rtl.act(async () => { llama.releaseStream(); });
    await rtl.waitFor(() => { expect(h.view!.queryByText(/nice to meet you\./)).not.toBeNull(); }, { timeout: 4000 });
    await rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    expect(h.view!.queryByTestId('message-cutoff-indicator')).toBeNull();

    // The person taps Stop mid-reply: the partial stays, with no cut-off note and no error card.
    await h.send('Tell me a story', { text: 'Once upon a time there was a fox who', pauseAfter: 'Once upon a time' } as never);
    await rtl.waitFor(() => { expect(h.view!.queryByText(/Once upon a time/)).not.toBeNull(); }, { timeout: 4000 });
    await rtl.act(async () => { rtl.fireEvent.press(h.view!.getByTestId('stop-button')); });
    await rtl.waitFor(() => { expect(h.view!.queryByTestId('stop-button')).toBeNull(); }, { timeout: 4000 });
    await h.settle(100);
    expect(h.view!.queryByText(/Once upon a time/)).not.toBeNull();
    expect(h.view!.queryByText(/a fox who/)).toBeNull();
    expect(h.view!.queryByTestId('message-cutoff-indicator')).toBeNull();
    expect(h.view!.queryByText(NO_RESPONSE)).toBeNull();

    // The next send answers on the same context — a Stop never forces a reload.
    await h.send('What is 2 plus 2?', { text: '2 plus 2 is 4.' });
    await rtl.waitFor(() => { expect(h.view!.queryByText(/2 plus 2 is 4\./)).not.toBeNull(); }, { timeout: 4000 });
    expect(llama.calls.initLlama.length).toBe(loads);
  });
});
