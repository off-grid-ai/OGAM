/**
 * T084 (checklist Area 12) — full voice-mode journey: record "draw a dog" → STT transcript → the pattern
 * router sends it to the IMAGE pipeline → a generated image renders. Device WORKS (log part28/38: voice
 * "draw a dog" → ROUTE-SM → IMAGE → image).
 *
 * Real user behavior: whisper + an image model loaded, enter voice mode (real gesture), record a voice note
 * and release to send. The real STT transcribes, the real router routes to image, the diffusion boundary
 * renders the image. Assert the image gen ran AND the generated image renders on screen.
 *
 * Falsify: send a non-draw phrase ("what is the capital of France") → routes to TEXT → no generateImage → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T084 (rendered) — voice-mode image journey (STT → route → image renders)', () => {
  it('records "draw a dog", routes to the image pipeline, and renders the generated image', async () => {
    const h = await setupChatScreen({ engine: 'litert', platform: 'android', whisper: true, pro: true });
    await h.setupWhisperModel();
    h.render();
    // Place + load (activate) an image model via the real path — hasImageModel=true, imageMode stays 'auto'.
    await h.placeImageModel({ backend: 'mnn' });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { activeModelService } = require('../../../src/services/activeModelService');
    /* eslint-enable @typescript-eslint/no-var-requires */
    await activeModelService.loadImageModel('sd');

    // Voice mode, then voice-send "draw a dog" → the pattern router → IMAGE.
    await h.enterVoiceMode();
    await h.voiceSend('draw a dog');

    // The image generation ran...
    await h.rtl.waitFor(() => { expect(h.boundary.diffusion.calls.generateImage).toHaveLength(1); }, { timeout: 6000 });
    // ...and the generated image renders on screen (the terminal artifact the user sees).
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('generated-image')).not.toBeNull(); }, { timeout: 6000 });
  });
});
