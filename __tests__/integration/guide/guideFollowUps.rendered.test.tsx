/**
 * A flow's answer offers what usually comes next as chips, the branch for each of its conditions
 * first; a follow-up question about a condition is read against the flow just shown. All from the
 * guide itself, with no model, as on a phone with nothing downloaded.
 *
 * The real App on Home. The questions are Mac's own (18 Nov), which used to end at device Sync.
 */
import { launchApp, restoreBuildFlavor, type AnalyticsApp } from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

let app: AnalyticsApp | null = null;
afterEach(async () => {
  app?.view.unmount();
  app?.endpoint.restore();
  app = null;
  restoreBuildFlavor();
});

async function askAbout(question: string) {
  const { view, rtl } = app!;
  rtl.fireEvent.changeText(await view.findByTestId('guide-input'), question);
  rtl.fireEvent.press(view.getByTestId('guide-send'));
}

async function openScanFlow() {
  app = await launchApp({ release: true, returningUser: true });
  const { view, rtl } = app;
  rtl.fireEvent.press(await view.findByTestId('home-guide-button'));
  await askAbout('how do I use these models on my laptop without being on the same network?');
  rtl.fireEvent.press(await view.findByTestId('guide-pick-cross-phone-use-computer-models-scan', {}, { timeout: 3000 }));
}

it("the network scan's answer offers adding the computer by address when not on the same Wi-Fi", async () => {
  await openScanFlow();
  const { view, rtl } = app!;
  const chip = await view.findByTestId('guide-next-cross-phone-add-computer-manually', {}, { timeout: 3000 });
  expect(chip.props.accessibilityLabel).toMatch(/^Not both devices on the same Wi-Fi\? /);
  rtl.fireEvent.press(chip);
  expect(await view.findByText(/Add the computer as a server by address:/, {}, { timeout: 3000 })).toBeTruthy();
});

it('"what if we\'re not on the same wifi?" right after it answers with that flow, not Sync', async () => {
  await openScanFlow();
  const { view } = app!;
  await view.findByTestId('guide-next-cross-phone-add-computer-manually', {}, { timeout: 3000 });
  await askAbout("what if we're not on the same wifi? is there some setting for it?");
  expect(await view.findByText(/Add the computer as a server by address:/, {}, { timeout: 3000 })).toBeTruthy();
  expect(view.queryByText(/Device sync never goes/)).toBeNull();
});
