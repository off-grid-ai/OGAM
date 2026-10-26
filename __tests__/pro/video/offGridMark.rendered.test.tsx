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

type Node = { parent: Node | null };

/** The model card around a name: six levels up from the name is its card, one card and no more. */
function cardOf(current: AnalyticsApp, name: string): Node {
  const { view, rtl } = current;
  let node = view.getByText(name) as unknown as Node;
  for (let depth = 0; depth < 6 && node.parent; depth += 1) node = node.parent;
  return rtl.within(node as never) as unknown as Node;
}

it('Off Grid AI builds carry the Off Grid AI mark on Models, Video; other uploads do not', async () => {
  app = await launchApp({ release: false });
  const { view, rtl } = app;
  await passOnboarding(app, false);
  await require('../../harness/proHarness').installPro();
  rtl.fireEvent.press(await view.findByTestId('models-tab'));
  await view.findByTestId('models-screen');
  expect(view.queryByTestId('made-by-off-grid')).toBeNull();
  rtl.fireEvent.press(view.getByText('Video'));
  const light = await view.findByText('Wan 2.2 (5B), Light', {}, { timeout: 10_000 });
  expect(light).toBeTruthy();
  const marks = await view.findAllByLabelText('Made by Off Grid AI');
  expect(marks.length).toBeGreaterThan(0);
  const within = cardOf(app, 'Wan 2.2 (5B), Light') as unknown as ReturnType<typeof rtl.within>;
  expect(within.getByTestId('made-by-off-grid')).toBeTruthy();
  // The row says nothing more: the mark is the only sign of who made it.
  expect(view.queryByText('Off Grid AI')).toBeNull();
  const other = cardOf(app, 'Wan 2.2 (5B), Q5_K_M') as unknown as ReturnType<typeof rtl.within>;
  expect(other.queryByTestId('made-by-off-grid')).toBeNull();
}, 60_000);
