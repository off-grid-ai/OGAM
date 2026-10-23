/**
 * The in-chat model sheet shows the same speed badges as the Models screen: MTP for a downloaded model
 * the engine can draft with, and MoE with its active size.
 *
 * SPEC (the user's view): in a chat I open the model sheet. A Gemma 4 E4B file (a published MTP head
 * exists for it) carries the MTP badge; an LFM2.5 8B A1B file carries "MoE 1B"; a plain model carries
 * neither. A screen reader focusing a row hears the same descriptions.
 *
 * Real Home picker, real ChatScreen, real model sheet (ModelSelectorModal → TextTab). Only native leaves
 * are faked.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('chat model sheet speed badges', () => {
  it('marks the MTP model and the MoE model, and not the plain one', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      extraModels: [
        { id: 'gemma', name: 'Gemma 4 E4B', fileName: 'gemma-4-E4B-it-Q4_K_M.gguf', fileSizeBytes: 1 * GB },
        { id: 'lfm', name: 'LFM2.5-8B-A1B', fileName: 'LFM2.5-8B-A1B-Q4_K_M.gguf', fileSizeBytes: 1 * GB },
      ],
    });
    const { rtl } = h;
    h.render();
    const view = () => h.view!;

    // GESTURE: open the model sheet from the chat.
    rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('model-selector')));
    rtl.fireEvent.press(await rtl.waitFor(() => view().getByTestId('models-row-text')));
    const gemma = await rtl.waitFor(() => view().getByTestId('text-model-row-gemma'));
    const lfm = view().getByTestId('text-model-row-lfm');

    await rtl.waitFor(() => expect(rtl.within(gemma).queryByLabelText('MTP: replies faster')).not.toBeNull());
    expect(gemma.props.accessibilityHint).toContain('MTP: replies faster');
    expect(rtl.within(lfm).getByLabelText('Mixture of experts: runs like a 1B model')).toBeTruthy();
    expect(rtl.within(lfm).queryByLabelText('MTP: replies faster')).toBeNull();

    const plain = view().getAllByTestId(/^text-model-row-/).find(row => !['text-model-row-gemma', 'text-model-row-lfm'].includes(row.props.testID));
    expect(plain).toBeTruthy();
    expect(rtl.within(plain!).queryByLabelText(/MTP|Mixture of experts/)).toBeNull();
  });
});
