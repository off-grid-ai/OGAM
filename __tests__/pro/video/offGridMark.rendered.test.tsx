/**
 * A model Off Grid AI made carries the app's mark beside its name.
 *
 * SPEC (OGAM user's view): on Models, Video, every build from Off Grid AI's own org shows the small
 * Off Grid AI logo ("Made by Off Grid AI" to a screen reader), with no words added to the row. A build
 * another uploader made does not show it.
 *
 * The real App runs. Device boundaries only: the llama.rn engine, the disk and the RAM sensor
 * (a 12 GB Android phone). The person opens Models and its Video tab.
 */
import { launchApp, passOnboarding, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';

let app: AnalyticsApp | undefined;

afterEach(() => {
  app?.view.unmount();
  app?.endpoint.restore();
  app = undefined;
  restoreBuildFlavor();
});

/** A model's card on Models, Video, by the model's id; its name is checked as what the card says. */
function cardOf(current: AnalyticsApp, id: string, name: string) {
  const { view, rtl } = current;
  const card = rtl.within(view.getByTestId(`video-model-card-${id}`));
  expect(card.getByText(name)).toBeTruthy();
  return card;
}

it('Off Grid AI builds carry the Off Grid AI mark on Models, Video; other uploads do not', async () => {
  app = await launchApp({ release: false });
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  await view.findByTestId('models-screen');
  expect(view.queryByTestId('made-by-off-grid')).toBeNull();
  rtl.fireEvent.press(view.getByTestId('video-models-tab'));
  const light = await view.findByText('Wan 2.2 (5B), Light', {}, { timeout: 10_000 });
  expect(light).toBeTruthy();
  const marks = await view.findAllByLabelText('Made by Off Grid AI');
  expect(marks.length).toBeGreaterThan(0);
  const within = cardOf(app, 'off-grid-ai/Wan2.2-TI2V-5B-GGUF-Q4', 'Wan 2.2 (5B), Light');
  expect(within.getByTestId('made-by-off-grid')).toBeTruthy();
  // The row says nothing more: the mark is the only sign of who made it.
  expect(view.queryByText('Off Grid AI')).toBeNull();
  const other = cardOf(app, 'QuantStack/Wan2.2-TI2V-5B-GGUF', 'Wan 2.2 (5B), Q5_K_M');
  expect(other.queryByTestId('made-by-off-grid')).toBeNull();
}, 60_000);
