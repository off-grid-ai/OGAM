import { setupChatScreen, usingLlama } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('voice model selection surfaces', () => {
  it('lists voice models without showing speaker choices in chat or Models', async () => {
    const h = await setupChatScreen(
      usingLlama({ platform: 'ios' }).usingTextToSpeech('kokoro'),
    );
    h.render();

    h.rtl.fireEvent.press(h.view!.getByTestId('model-selector'));
    h.rtl.fireEvent.press(
      await h.rtl.waitFor(() => h.view!.getByTestId('models-row-voice')),
    );

    await h.rtl.waitFor(() => {
      expect(h.view!.getByText('On-device models')).toBeVisible();
      expect(h.view!.getByText('Kokoro TTS')).toBeVisible();
    });
    h.rtl.fireEvent.press(
      h.view!.getByTestId(
        'voice-model-card-software-mansion/executorch-kokoro-download',
      ),
    );
    await h.rtl.waitFor(
      () => {
        expect(
          h.view!.getByTestId(
            'voice-model-card-software-mansion/executorch-kokoro-delete',
          ),
        ).toBeVisible();
        expect(h.view!.getByText('Kokoro TTS')).toBeVisible();
      },
      { timeout: 4000 },
    );
    expect(h.view!.queryByText('Heart')).toBeNull();
    expect(h.view!.queryByTestId('models-tts-language')).toBeNull();

    h.view!.unmount();
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    const models = h.rtl.render(h.React.createElement(ModelsScreen));
    h.rtl.fireEvent.press(models.getByTestId('voice-models-tab'));

    await h.rtl.waitFor(() => {
      expect(models.getByText('On-device models')).toBeVisible();
      expect(models.getByText('Kokoro TTS')).toBeVisible();
    });
    expect(models.queryByText('Heart')).toBeNull();
    expect(models.queryByTestId('models-tts-language')).toBeNull();
    models.unmount();
  });
});
