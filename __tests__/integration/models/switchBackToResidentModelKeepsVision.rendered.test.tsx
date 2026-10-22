/**
 * UI integration — switching back to the model that is still loaded selects it again.
 *
 * Device 2026-10-22 (iPhone, 890cf3f43): Qwen3.5 0.8B (vision) answered a message, so it was loaded. The
 * person picked 2B in the model sheet, then picked 0.8B again, attached a photo and sent. The app said
 * "Vision Not Supported": picking 2B only selected it (the load waits for the next message), so 0.8B
 * stayed loaded, and the sheet disabled the loaded model's row. The second tap did nothing and the chat
 * stayed on 2B, which has no vision file.
 *
 * Real Home picker, real ChatScreen, real model sheet, real activeModelService and stores. Faked only at
 * the device line: llama.rn (whose projector starts), the disk and the RAM sensor.
 *
 * Product rule: after A → B → A the chat is on A. The sheet highlights A, the header names A, and a photo
 * goes to A with no "Vision Not Supported" alert.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('model sheet: switching back to the loaded model', () => {
  it('A → B → A selects A again, and a photo goes to A', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'android',
      vision: true,
      deferInitialLoad: true,
      modelName: 'Qwen3.5 0.8B',
      extraModels: [{ id: 'b', name: 'Qwen3.5 2B', fileName: 'qwen-2b.gguf', fileSizeBytes: 2 * GB }],
    });
    const { rtl } = h;
    h.render();
    const view = () => h.view!;

    const openSheet = async () => {
      rtl.fireEvent.press(view().getByTestId('model-selector'));
      rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
      await rtl.waitFor(() => view().getByTestId('text-model-row-m'));
    };
    // Picking a row closes the sheet by itself; otherwise the close button does.
    const closeSheet = async () => {
      const close = view().queryByTestId('app-sheet-close');
      if (close) rtl.fireEvent.press(close);
      await rtl.waitFor(() => expect(view().queryByTestId('text-model-row-m')).toBeNull());
    };
    const rowState = (id: string) => view().getByTestId(`text-model-row-${id}`).props.accessibilityState;

    await rtl.waitFor(() => expect(view().queryByText(/chatting with Qwen3.5 0.8B/)).not.toBeNull());

    // GESTURE: the first message loads 0.8B and it answers.
    await h.send('Hi', { text: 'Hello from 0.8B.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello from 0.8B.')).not.toBeNull(), { timeout: 8000 });

    // GESTURE: pick 2B. Nothing loads yet; 0.8B stays in memory.
    await openSheet();
    rtl.fireEvent.press(view().getByTestId('text-model-row-b'));
    await closeSheet();

    // The sheet shows 2B as the choice and 0.8B as loaded — and 0.8B's row still takes a tap.
    await openSheet();
    expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Qwen3.5 0.8B');
    expect(rowState('b')).toEqual({ selected: true, disabled: true });
    expect(rowState('m')).toEqual({ selected: false, disabled: false });

    // GESTURE: pick 0.8B again — the model that is still loaded.
    rtl.fireEvent.press(view().getByTestId('text-model-row-m'));
    await closeSheet();

    // The chat is on 0.8B again.
    await openSheet();
    expect(rowState('m')).toEqual({ selected: true, disabled: true });
    expect(rowState('b')).toEqual({ selected: false, disabled: false });
    await closeSheet();

    // GESTURE: attach a photo and send. It goes to 0.8B, with no refusal.
    await h.attachImageViaUI();
    await h.send('What is in this photo?', { text: 'A cat on a sofa.' });
    await rtl.waitFor(() => expect(view().queryByText('A cat on a sofa.')).not.toBeNull(), { timeout: 8000 });
    expect(view().queryByText('Vision Not Supported')).toBeNull();
    expect(view().queryByText('Vision File Missing')).toBeNull();
  }, 45000);
});
