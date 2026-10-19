/**
 * Model residency on the shared policy (@offgrid/models), the same rules Off Grid Desktop runs.
 *
 * Product spec, from the user's view:
 *  - picking a model does not load it; the first message loads it (lazy load on first send);
 *  - a text model and an image model stay loaded side by side when the phone has the memory;
 *  - when the image model does not fit beside the text model, the text model is unloaded for the
 *    image, and the next message loads text again and unloads the image (the lower-priority model).
 *
 * Real journey: Home picker → New Chat → send (ChatScreen) → image mode toggle → send an image prompt.
 * Fakes only at the device boundary: llama.rn, the diffusion native module, the disk, and the RAM sensor
 * (nativeBoundary RAM profiles). The resident set is read on the UI through ResidentsProbe.
 */
import { setupChatScreen } from '../../harness/chatHarness';
import { GB } from '../../harness/nativeBoundary';

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

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/** Mount the real ChatScreen with the residency probe beside it. */
function renderWithProbe(h: Harness) {
  const { ResidentsProbe } = require('../../harness/ResidentsProbe');
  h.view = h.rtl.render(
    h.React.createElement(
      h.React.Fragment,
      null,
      h.screenTree(),
      h.React.createElement(ResidentsProbe, {}),
    ),
  );
}

const residents = (h: Harness): string =>
  h.view!.getByTestId('probe-residents').props.children;

async function expectResidents(h: Harness, expected: string) {
  await h.rtl.waitFor(() => expect(residents(h)).toBe(expected), { timeout: 6000 });
}

async function sendAndSeeAnswer(h: Harness, prompt: string, answer: string) {
  await h.send(prompt, { text: answer });
  await h.rtl.waitFor(
    () => expect(h.view!.queryByText(new RegExp(answer.replace('.', '\\.')))).not.toBeNull(),
    { timeout: 6000 },
  );
}

jest.setTimeout(60_000);

describe('model residency on the shared policy', () => {
  it('loads the text model on the first message, not when it is picked', async () => {
    const h = await setupChatScreen({ engine: 'llama', deferInitialLoad: true });
    renderWithProbe(h);

    // Picked, but nothing is in memory yet.
    await expectResidents(h, '(none)');

    await sendAndSeeAnswer(h, 'say hello', 'Hello there.');
    await expectResidents(h, 'text');
  });

  it('keeps the text and image models loaded side by side when the phone has the memory', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      ram: { platform: 'ios', totalBytes: 16 * GB, availBytes: 12 * GB },
    });
    renderWithProbe(h);
    await sendAndSeeAnswer(h, 'say hello', 'Hello there.');
    await expectResidents(h, 'text');

    await h.generateImageViaUI({ backend: 'coreml' });
    await expectResidents(h, 'image,text');

    // A further message needs no reload and unloads nothing.
    await sendAndSeeAnswer(h, 'and again', 'Still here.');
    await expectResidents(h, 'image,text');
  });

  it('unloads the text model for an image that does not fit beside it, then swaps back on the next message', async () => {
    const h = await setupChatScreen({
      engine: 'llama',
      deferInitialLoad: true,
      ram: { platform: 'ios', totalBytes: 8 * GB, availBytes: 3 * GB },
    });
    renderWithProbe(h);
    await sendAndSeeAnswer(h, 'say hello', 'Hello there.');
    await expectResidents(h, 'text');

    await h.generateImageViaUI({ backend: 'coreml' });
    await expectResidents(h, 'image');

    // The next message loads text again; the image model is the one that goes.
    await sendAndSeeAnswer(h, 'and again', 'Back again.');
    await expectResidents(h, 'text');
  });
});
