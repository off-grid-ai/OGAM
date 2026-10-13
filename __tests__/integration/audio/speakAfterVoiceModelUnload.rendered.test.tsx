/**
 * "Speak" stays in a reply's actions after the voice model is unloaded. Residency frees the voice
 * model to make room (here on the OS memory warning), but the model is still downloaded and Speak
 * loads it again on demand, so the person keeps the action. It must not vanish just because the
 * model is not in memory at this moment.
 *
 * Real journey: download the voice model on the real Models > Voice panel, chat on the real
 * ChatScreen, enter Voice mode with the real header toggle (which loads the voice model through
 * residency) and return to Text mode, then the OS raises a memory warning and the real residency
 * manager reclaims the idle voice model. The "In Memory" list of the real models sheet shows it
 * loaded, then gone. Fakes only at the device boundary: the LiteRT engine, the executorch TTS
 * runtime and its resource fetcher (jest.setup), the RAM sensor and the OS memory-warning event.
 */
import { launchVoiceApp } from '../../harness/proHarness';

jest.unmock('@react-navigation/native');

describe('Speak after the voice model unloads', () => {
  it('still offers Speak on a reply once residency has unloaded the downloaded voice model', async () => {
    const h = await launchVoiceApp();
    const { rtl, view } = h;
    await h.voicePanel();
    await h.downloadVoice();
    await h.chat();
    /** The chat header's Models sheet lists what is in memory: a loaded model's row carries a RAM chip. */
    const openModelsSheet = async () => {
      rtl.fireEvent.press(view.getByTestId('model-selector'));
      await rtl.waitFor(() => expect(view.getByTestId('models-row-text-ram')).toBeTruthy());
    };
    const closeModelsSheet = async () => {
      rtl.fireEvent.press(view.getByTestId('app-sheet-close'));
      await rtl.waitFor(() => expect(view.queryByTestId('models-row-text')).toBeNull(), { timeout: 4000 });
    };

    await h.send('what is the capital of France?', 'The capital of France is Paris.');
    await rtl.waitFor(() => expect(view.queryByText(/The capital of France is Paris\./)).not.toBeNull());
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull());

    // Before: with the voice model downloaded, the reply offers Speak. Close the menu again.
    await h.actions();
    expect(await view.findByTestId('action-speak')).toBeTruthy();
    rtl.fireEvent.press(view.getByTestId('action-copy'));
    await rtl.waitFor(() => expect(view.queryByTestId('action-menu')).toBeNull());

    // Voice mode loads the voice model through residency; the person then returns to Text mode.
    rtl.fireEvent.press(view.getByTestId('chat-mode-toggle'));
    await rtl.waitFor(() => expect(view.getByLabelText('Switch to Text mode')).toBeTruthy());
    await openModelsSheet();
    await rtl.waitFor(() => expect(view.getByTestId('models-row-voice-ram')).toBeTruthy(), { timeout: 6000 });
    await closeModelsSheet();
    rtl.fireEvent.press(view.getByTestId('chat-mode-toggle'));
    await rtl.waitFor(() => expect(view.getByLabelText('Switch to Voice mode')).toBeTruthy());

    // Back in Text mode the voice model is still in memory, until the OS warns about memory and
    // residency reclaims it (it is idle). The sheet stays open to watch it go.
    await openModelsSheet();
    expect(view.getByTestId('models-row-voice-ram')).toBeTruthy();
    await rtl.act(async () => { h.boundary.emitMemoryWarning(); await new Promise(resolve => setTimeout(resolve, 300)); });
    await rtl.waitFor(() => expect(view.queryByTestId('models-row-voice-ram')).toBeNull(), { timeout: 6000 });
    expect(view.getByTestId('models-row-text-ram')).toBeTruthy();
    await closeModelsSheet();

    // After: the reply still offers Speak.
    await h.actions();
    expect(await view.findByTestId('action-speak')).toBeTruthy();
    await h.close();
  });
});
