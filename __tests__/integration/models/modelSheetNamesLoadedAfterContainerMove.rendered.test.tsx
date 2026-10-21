/**
 * UI integration — the model sheet names the loaded model after iOS moves the app's folder.
 *
 * iOS gives the app a new data-container folder on reinstall and update and moves Documents into it. A
 * model record saved before that names the OLD absolute path; the file now sits under the new one. The
 * model still loads (the engine opens the file where it is now), and the chat's model sheet must name it
 * under "Currently Loaded" — not "Unknown".
 *
 * Real Home picker, real ChatScreen, real model sheet (ModelSelectorModal → TextTab), real
 * activeModelService / llmService, real stores. Faked only at the device line: llama.rn, the disk (the
 * file lives under the current Documents folder), the RAM sensor.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

/** Where the record was saved, before iOS moved the app's folder. */
const OLD_CONTAINER_PATH =
  '/var/mobile/Containers/Data/Application/0B5E2C1A-OLD0-4F00-9C00-000000000000/Documents/models/qwen-small.gguf';

describe('model sheet after iOS moves the app folder', () => {
  it('names the loaded model under Currently Loaded, not "Unknown"', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'ios',
      deferInitialLoad: true,
      modelName: 'Qwen Small',
      modelFileName: 'qwen-small.gguf',
      storedModelFilePath: OLD_CONTAINER_PATH,
    });
    const { rtl } = h;
    h.render();
    const view = () => h.view!;
    const openModelSheet = async () => {
      rtl.fireEvent.press(view().getByTestId('model-selector'));
      rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
      await rtl.waitFor(() => expect(view().queryAllByTestId(/^text-model-row-/).length).toBeGreaterThan(0));
    };

    // BEFORE: selected but not loaded — the sheet has no Currently Loaded card.
    await openModelSheet();
    expect(view().queryByTestId('currently-loaded-model-name')).toBeNull();
    rtl.fireEvent.press(view().getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view().queryAllByTestId(/^text-model-row-/)).toHaveLength(0));

    // GESTURE: the first message loads the model from the folder it is in now, and it answers.
    await h.send('Hi', { text: 'Hello.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello.')).not.toBeNull(), { timeout: 8000 });

    // The sheet names the loaded model.
    await openModelSheet();
    await rtl.waitFor(() => expect(view().queryByTestId('currently-loaded-model-name')).not.toBeNull());
    expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Qwen Small');
    expect(view().queryByText('Unknown')).toBeNull();
  }, 30000);
});
