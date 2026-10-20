/**
 * UI integration — switching from one llama model to a llama model too big for the phone keeps the first
 * model loaded.
 *
 * Real Home picker, real ChatScreen, real model sheet (ModelSelectorModal → TextTab), real
 * useChatModelActions, real activeModelService + residency gate (the shared @offgrid/models policy), real
 * llmService, real stores. Faked only at the device line: llama.rn, the disk, the RAM sensor (12 GB
 * Android phone, 8 GB free).
 *
 * The journey: Model A (llama, 2 GB) is picked on Home and loads on the first message. In the chat the
 * person opens the model sheet and picks Model B (llama, 30 GB — far bigger than the phone), then sends.
 * "Insufficient Memory" shows, and Model A is still in memory: its context was not released and B was
 * never handed to the engine. They press Cancel: the sheet names Model A, and the next message is
 * answered by Model A with no alert and no reload.
 *
 * Product rule: a model switch the phone refuses leaves the chat on the model it had. Before the fixes,
 * the shared residency policy counted any resident text model as "already loaded" (a 30 GB swap was
 * charged 0 MB and passed), and llmService.loadModel released Model A before its own memory check
 * refused Model B — so a refused switch left nothing loaded.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

type Node = { props: Record<string, unknown>; parent: Node | null };

describe('llama → llama switch to a model too big for the phone', () => {
  it('shows Insufficient Memory, keeps Model A loaded, and after Cancel Model A answers', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'android',
      deferInitialLoad: true,
      modelName: 'Model A',
      extraModels: [{ id: 'huge', name: 'Model B', fileName: 'huge.gguf', fileSizeBytes: 30 * GB, engine: 'llama' }],
    });
    const { rtl } = h;
    const llama = h.boundary.llama!;
    // BOUNDARY: each model file on disk is its real size (the harness places small placeholders).
    h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', 2 * GB);
    h.boundary.fs!.seedFile('/docs/models/huge.gguf', 30 * GB);
    h.render();
    const view = () => h.view!;

    const pressAlertButton = async (label: string) => {
      await rtl.act(async () => {
        let n: Node | null = view().getByText(label) as unknown as Node;
        while (n && typeof n.props.onPress !== 'function') n = n.parent;
        expect(n).not.toBeNull();
        (n!.props.onPress as () => void)();
      });
    };
    const openModelSheet = async () => {
      rtl.fireEvent.press(view().getByTestId('model-selector'));
      rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
      return rtl.waitFor(() => view().getByTestId('text-model-row-huge'));
    };
    const initsFor = (file: string) => llama.calls.initLlama.filter(p => String(p.model).endsWith(file)).length;

    await rtl.waitFor(() => expect(view().queryByText(/chatting with Model A/)).not.toBeNull());

    // GESTURE: the first message loads Model A and it answers.
    await h.send('Hi', { text: 'Hello from A.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello from A.')).not.toBeNull(), { timeout: 8000 });
    expect(initsFor('ggml-small.gguf')).toBe(1);
    // BOUNDARY: Model A's native context (initLlama resolves the context the engine holds).
    const contextA = (await llama.module.initLlama.mock.results[0].value) as { release: jest.Mock };
    expect(contextA.release).not.toHaveBeenCalled();

    // GESTURE: open the model sheet and pick Model B.
    rtl.fireEvent.press(await openModelSheet());
    await rtl.waitFor(() => expect(view().queryByTestId('text-model-row-huge')).toBeNull());

    // BEFORE: no memory alert yet.
    expect(view().queryByText('Insufficient Memory')).toBeNull();

    // GESTURE: send — Model B does not fit.
    await h.tapSend('Use the huge one');
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).not.toBeNull(), { timeout: 10000 });
    expect(view().queryByText('Load Anyway')).not.toBeNull();

    // Model A is still in memory: its context was never released and Model B never reached the engine.
    expect(contextA.release).not.toHaveBeenCalled();
    expect(initsFor('huge.gguf')).toBe(0);

    // GESTURE: Cancel.
    await pressAlertButton('Cancel');
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).toBeNull());

    // The model sheet names Model A as the loaded model.
    await openModelSheet();
    await rtl.waitFor(() =>
      expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Model A'),
    );
    rtl.fireEvent.press(view().getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view().queryByTestId('currently-loaded-model-name')).toBeNull());

    // GESTURE: the next message is answered by Model A, with no alert and without reloading it.
    await h.send('And now?', { text: 'Still A here.' });
    await rtl.waitFor(() => expect(view().queryByText('Still A here.')).not.toBeNull(), { timeout: 8000 });
    expect(view().queryByText('Insufficient Memory')).toBeNull();
    expect(initsFor('ggml-small.gguf')).toBe(1);
    expect(initsFor('huge.gguf')).toBe(0);
    expect(contextA.release).not.toHaveBeenCalled();
  }, 45000);
});
