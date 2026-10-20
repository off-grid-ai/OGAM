/**
 * UI integration — cancelling "Insufficient Memory" keeps the chat on the model that is still loaded.
 *
 * Real Home picker, real ChatScreen, real model sheet (ModelSelectorModal → TextTab), real
 * useChatModelActions, real activeModelService + residency gate, real stores. Faked only at the device
 * line: llama.rn, LiteRT, the disk, the RAM sensor (12 GB phone, 8 GB free).
 *
 * The journey: Model A (llama, 2 GB) is picked on Home and loads on the first message. In the chat the
 * person opens the model sheet and picks Model B (LiteRT, 20 GB — bigger than the whole phone), then
 * sends. The residency gate refuses B before anything is unloaded → "Insufficient Memory" with Cancel /
 * Load Anyway. They press Cancel.
 *
 * Why B is LiteRT: it is the switch on which the residency gate itself refuses while A stays loaded (B's
 * dirty footprint exceeds the dirty ceiling). A llama→llama switch never reaches that refusal today: the
 * shared planEviction charges a same-slot ("text") swap 0 MB, and llmService.loadModel releases A before
 * its own memory check refuses B, so nothing is left loaded to go back to (reported separately).
 *
 * Product rule: after Cancel the chat is on Model A again — the sheet names A as loaded and selected, the
 * next message gets a reply without the alert, and a new chat says it is chatting with Model A (never
 * "Unknown", never the model that did not fit). Before the fix the selection stayed on B, so every send
 * re-hit the gate.
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

describe('Insufficient Memory → Cancel keeps the chat on the loaded model', () => {
  it('after Cancel, the chat answers with Model A and names it, without re-hitting the gate', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      platform: 'android',
      deferInitialLoad: true,
      modelName: 'Model A',
      extraModels: [{ id: 'big', name: 'Model B', fileName: 'big.litertlm', fileSizeBytes: 20 * GB, engine: 'litert' }],
    });
    const { rtl } = h;
    // BOUNDARY: Model B's file on disk is its real 20 GB (the harness places a small placeholder).
    h.boundary.fs!.seedFile('/docs/models/big.litertlm', 20 * GB);
    h.render();
    const view = () => h.view!;

    /** Press an alert button by its label (the alert renders its buttons as plain text rows). */
    const pressAlertButton = async (label: string) => {
      await rtl.act(async () => {
        let n: Node | null = view().getByText(label) as unknown as Node;
        while (n && typeof n.props.onPress !== 'function') n = n.parent;
        expect(n).not.toBeNull();
        (n!.props.onPress as () => void)();
      });
    };
    /** Open the chat's model sheet on its text tab. */
    const openModelSheet = async () => {
      rtl.fireEvent.press(view().getByTestId('model-selector'));
      rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
      return rtl.waitFor(() => view().getByTestId('text-model-row-big'));
    };

    // The chat opens on Model A.
    await rtl.waitFor(() => expect(view().queryByText(/chatting with Model A/)).not.toBeNull());

    // GESTURE: the first message loads Model A and it answers.
    await h.send('Hi', { text: 'Hello from A.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello from A.')).not.toBeNull(), { timeout: 8000 });

    // GESTURE: open the model sheet and pick Model B.
    rtl.fireEvent.press(await openModelSheet());
    await rtl.waitFor(() => expect(h.useAppStore.getState().activeModelId).toBe('big'));

    // BEFORE: no memory alert yet.
    expect(view().queryByText('Insufficient Memory')).toBeNull();

    // GESTURE: send — B does not fit, so the gate refuses and offers the override.
    await h.tapSend('Use the big one');
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).not.toBeNull(), { timeout: 10000 });
    expect(view().queryByText('Load Anyway')).not.toBeNull();

    // GESTURE: Cancel.
    await pressAlertButton('Cancel');
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).toBeNull());

    // The model sheet names Model A as the loaded model again.
    await openModelSheet();
    await rtl.waitFor(() =>
      expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Model A'),
    );
    expect(view().queryByText('Unknown')).toBeNull();
    // GESTURE: close the sheet.
    rtl.fireEvent.press(view().getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view().queryByTestId('currently-loaded-model-name')).toBeNull());

    // GESTURE: the next message gets a reply from Model A, with no memory alert.
    await h.send('And now?', { text: 'Still A here.' });
    await rtl.waitFor(() => expect(view().queryByText('Still A here.')).not.toBeNull(), { timeout: 8000 });
    expect(view().queryByText('Insufficient Memory')).toBeNull();

    // A new chat says it is chatting with Model A — not "Unknown", not the model that did not fit.
    await h.newChatViaHome();
    await rtl.waitFor(() => expect(view().queryByText(/chatting with Model A/)).not.toBeNull());
    expect(view().queryByText(/chatting with Unknown/)).toBeNull();
    expect(view().queryByText(/chatting with Model B/)).toBeNull();
  }, 45000);
});
