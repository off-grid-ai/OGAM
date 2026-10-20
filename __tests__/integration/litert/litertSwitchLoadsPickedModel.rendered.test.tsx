/**
 * UI integration — picking another LiteRT model in the chat loads it, and it is the one that answers.
 *
 * Real Home picker, real ChatScreen, real model sheet (ModelSelectorModal → TextTab), real
 * useChatModelActions, real activeModelService + residency gate, real liteRTService + engines readiness,
 * real stores. Faked only at the device line: the LiteRT native module, the disk, the RAM sensor
 * (12 GB Android phone, 8 GB free).
 *
 * The journey: Model A (LiteRT) is picked on Home and answers the first message. In the chat the person
 * opens the model sheet, picks Model B (also LiteRT, also downloaded), and sends. The native engine is
 * handed Model B's file, Model B answers, and the sheet names Model B as loaded.
 *
 * Before the fix, readiness for LiteRT meant "some LiteRT model is loaded", so the send skipped the
 * load and Model A answered while the chat said Model B.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('LiteRT A → LiteRT B from the chat model sheet', () => {
  it('loads Model B on the next send and Model B answers', async () => {
    const h = await setupChatScreen({
      engine: 'litert',
      platform: 'android',
      deferInitialLoad: true,
      modelName: 'Model A',
      modelFileSizeBytes: 1 * GB,
      extraModels: [{ id: 'b', name: 'Model B', fileName: 'model-b.litertlm', fileSizeBytes: 1 * GB, engine: 'litert' }],
    });
    const { rtl } = h;
    const litert = h.boundary.litert;
    h.render();
    const view = () => h.view!;
    const loadedPaths = () => litert.calls.loadModel.map(args => String(args[0]));
    const openModelSheet = async () => {
      rtl.fireEvent.press(view().getByTestId('model-selector'));
      rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
      return rtl.waitFor(() => view().getByTestId('text-model-row-b'));
    };

    await rtl.waitFor(() => expect(view().queryByText(/chatting with Model A/)).not.toBeNull());

    // GESTURE: the first message loads Model A and it answers.
    await h.send('Hi', { content: 'Hello from A.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello from A.')).not.toBeNull(), { timeout: 8000 });
    expect(loadedPaths()).toEqual([expect.stringMatching(/gemma\.litertlm$/)]);

    // GESTURE: open the model sheet and pick Model B.
    rtl.fireEvent.press(await openModelSheet());
    await rtl.waitFor(() => expect(view().queryByTestId('text-model-row-b')).toBeNull());

    // BEFORE: Model B has not been handed to the engine.
    expect(loadedPaths().some(p => p.endsWith('model-b.litertlm'))).toBe(false);

    // GESTURE: send — Model B loads and answers.
    await h.send('Who are you?', { content: 'Hello from B.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello from B.')).not.toBeNull(), { timeout: 10000 });
    expect(loadedPaths()[loadedPaths().length - 1]).toMatch(/model-b\.litertlm$/);
    // Model A's reply to the first message is still there; nothing else claims to be from A.
    expect(view().queryAllByText('Hello from A.')).toHaveLength(1);

    // The model sheet names Model B as loaded.
    await openModelSheet();
    await rtl.waitFor(() =>
      expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Model B'),
    );
  }, 45000);
});
