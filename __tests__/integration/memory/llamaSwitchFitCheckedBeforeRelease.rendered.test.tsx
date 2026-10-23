/**
 * UI integration — a llama → llama switch checks the new model fits BEFORE the current one is released,
 * counting the current model's memory as coming back.
 *
 * Real Home picker, real ChatScreen, real model sheet, real useChatModelActions, real activeModelService +
 * residency gate, real llmService (its own pre-load memory check), real stores. Faked only at the device
 * line: llama.rn, the disk, the RAM sensor. iPhone with 16 GB and 3.5 GB free: on iOS the engine's
 * memory check reads real free RAM, so it is the check that decides here (the residency gate's physical
 * budget lets both switches through).
 *
 * Model A (llama, 2 GB file) is picked on Home and loads on the first message. The person then picks
 * Model B in the chat's model sheet and sends.
 *
 * 1. Model B (11 GB) does not fit even with Model A's 2 GB given back (past the iPhone fit rule on 16 GB) → "Insufficient Memory"; Model A's
 *    context is not released, Cancel leaves the chat on Model A, and A answers the next message without
 *    a reload. Before the fix, Model A was released first, then the check refused B: nothing was loaded.
 * 2. Model B (2.5 GB) needs more than the free 3.5 GB, but fits once Model A's 2 GB comes back → it loads
 *    and answers, with no alert.
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

async function chatOnModelA(modelBBytes: number) {
  const h = await setupChatScreen({
    engine: 'llama',
    platform: 'ios',
    ram: { platform: 'ios', totalBytes: 16 * GB, availBytes: 3.5 * GB },
    deferInitialLoad: true,
    modelName: 'Model A',
    extraModels: [{ id: 'b', name: 'Model B', fileName: 'model-b.gguf', fileSizeBytes: modelBBytes, engine: 'llama' }],
  });
  const { rtl } = h;
  // BOUNDARY: each model file on disk is its real size (the harness places small placeholders).
  h.boundary.fs!.seedFile('/docs/models/ggml-small.gguf', 2 * GB);
  h.boundary.fs!.seedFile('/docs/models/model-b.gguf', modelBBytes);
  h.render();
  const view = () => h.view!;
  const llama = h.boundary.llama!;
  const initsFor = (file: string) => llama.calls.initLlama.filter(p => String(p.model).endsWith(file)).length;
  const openModelSheet = async () => {
    rtl.fireEvent.press(view().getByTestId('model-selector'));
    rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
    return rtl.waitFor(() => view().getByTestId('text-model-row-b'));
  };

  await rtl.waitFor(() => expect(view().queryByText(/chatting with Model A/)).not.toBeNull());
  // GESTURE: the first message loads Model A and it answers.
  await h.send('Hi', { text: 'Hello from A.' });
  await rtl.waitFor(() => expect(view().queryByText('Hello from A.')).not.toBeNull(), { timeout: 8000 });
  expect(initsFor('ggml-small.gguf')).toBe(1);
  const contextA = (await llama.module.initLlama.mock.results[0].value) as { release: jest.Mock };

  // GESTURE: open the model sheet and pick Model B.
  rtl.fireEvent.press(await openModelSheet());
  await rtl.waitFor(() => expect(view().queryByTestId('text-model-row-b')).toBeNull());
  return { h, rtl, view, llama, initsFor, openModelSheet, contextA };
}

describe('llama → llama switch: the fit is checked before Model A is released', () => {
  it('Model B too big even with A given back: alert, A stays loaded, Cancel → A answers', async () => {
    const { h, rtl, view, initsFor, openModelSheet, contextA } = await chatOnModelA(11 * GB);

    // BEFORE: no memory alert.
    expect(view().queryByText('Insufficient Memory')).toBeNull();

    // GESTURE: send — Model B does not fit.
    await h.tapSend('Use B');
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).not.toBeNull(), { timeout: 10000 });
    // Model A is still in memory; Model B never reached the engine.
    expect(contextA.release).not.toHaveBeenCalled();
    expect(initsFor('model-b.gguf')).toBe(0);

    // GESTURE: Cancel.
    await rtl.act(async () => {
      let n: Node | null = view().getByText('Cancel') as unknown as Node;
      while (n && typeof n.props.onPress !== 'function') n = n.parent;
      (n!.props.onPress as () => void)();
    });
    await rtl.waitFor(() => expect(view().queryByText('Insufficient Memory')).toBeNull());

    // The model sheet names Model A as loaded.
    await openModelSheet();
    await rtl.waitFor(() =>
      expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Model A'),
    );
    rtl.fireEvent.press(view().getByTestId('app-sheet-close'));
    await rtl.waitFor(() => expect(view().queryByTestId('currently-loaded-model-name')).toBeNull());

    // GESTURE: the next message is answered by Model A, no alert, no reload.
    await h.send('And now?', { text: 'Still A here.' });
    await rtl.waitFor(() => expect(view().queryByText('Still A here.')).not.toBeNull(), { timeout: 8000 });
    expect(view().queryByText('Insufficient Memory')).toBeNull();
    expect(initsFor('ggml-small.gguf')).toBe(1);
    expect(contextA.release).not.toHaveBeenCalled();
  }, 45000);

  it('Model B fits once A is given back: it loads and answers, with no alert', async () => {
    const { h, rtl, view, initsFor, openModelSheet } = await chatOnModelA(2.5 * GB);

    // BEFORE: Model B has not been loaded and no alert shows.
    expect(initsFor('model-b.gguf')).toBe(0);
    expect(view().queryByText('Insufficient Memory')).toBeNull();

    // GESTURE: send — Model B replaces Model A and answers.
    await h.send('Use B', { text: 'Hello from B.' });
    await rtl.waitFor(() => expect(view().queryByText('Hello from B.')).not.toBeNull(), { timeout: 10000 });
    expect(view().queryByText('Insufficient Memory')).toBeNull();
    expect(initsFor('model-b.gguf')).toBe(1);

    // The model sheet names Model B as loaded.
    await openModelSheet();
    await rtl.waitFor(() =>
      expect(String(view().getByTestId('currently-loaded-model-name').props.children)).toContain('Model B'),
    );
  }, 45000);
});
