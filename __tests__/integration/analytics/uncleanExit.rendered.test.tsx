/**
 * `unclean_exit` (docs/ANALYTICS.md, Crashes).
 *
 * SPEC (OGAM user's view, opted in): if the app dies in the foreground while a model is loading,
 * the next launch of the same version reports one `unclean_exit` with stage `load`. If it was in
 * the background when it died (the OS reclaiming memory), nothing is reported.
 *
 * The death is the device boundary: the native load is held open (it never returns), the app is
 * torn down without any clean shutdown, and a new launch reads the same disk and storage.
 */
import {
  launchApp,
  passOnboarding,
  restoreBuildFlavor,
  sendToBackground,
  type AnalyticsApp,
} from '../../harness/analyticsApp';

jest.unmock('@react-navigation/native');

const launched: AnalyticsApp[] = [];

afterEach(async () => {
  for (const app of launched.reverse()) {
    app.view.unmount();
    // Let the client's last flush land on the fake endpoint before the endpoint goes away.
    await new Promise(resolve => setTimeout(resolve, 50));
    app.endpoint.restore();
  }
  launched.length = 0;
  restoreBuildFlavor();
});

/** Opt in at Auto Setup, then start a chat whose model load never finishes. */
async function dieWhileLoading(inBackground: boolean): Promise<void> {
  const app = await launchApp({ release: true });
  launched.push(app);
  const { view, rtl, boundary } = app;
  await passOnboarding(app, true);
  boundary.llama!.scriptMultimodalHold();
  rtl.fireEvent.press(view.getByTestId('browse-models-button'));
  rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
  rtl.fireEvent.press(await view.findByTestId('new-chat-button'));
  rtl.fireEvent.changeText(await view.findByTestId('chat-input'), 'hello');
  rtl.fireEvent.press(view.getByTestId('send-button'));
  await rtl.waitFor(() => expect(boundary.llama!.multimodalHoldActive()).toBe(true));
  expect(view.getByText(/Loading Test Model/)).toBeTruthy();
  if (inBackground) await sendToBackground(app);
  // The process dies here: no unmount clean-up runs before the next launch reads the disk.
}

async function relaunch(): Promise<AnalyticsApp> {
  const next = await launchApp({ release: true, relaunch: true });
  launched.push(next);
  await next.view.findByTestId('home-screen');
  await sendToBackground(next);
  // This launch's own first event: the earlier, dead launch never sends `app_opened` with a cold start.
  await next.rtl.waitFor(() =>
    expect(next.endpoint.named('app_opened').some(e => typeof e.properties.cold_start_ms === 'number')).toBe(true),
  );
  return next;
}

it('a foreground death during a model load is reported once on the next launch', async () => {
  await dieWhileLoading(false);
  const next = await relaunch();
  const reports = next.endpoint.named('unclean_exit');
  expect(reports).toHaveLength(1);
  expect(reports[0].properties).toMatchObject({
    stage: 'load',
    model: 'unsloth/Qwen3-0.6B-GGUF',
    engine: 'llama.cpp',
    backend: 'cpu',
  });
  expect(typeof reports[0].properties.elapsed_ms).toBe('number');
});

it('a death in the background is not reported', async () => {
  await dieWhileLoading(true);
  const next = await relaunch();
  expect(next.endpoint.named('unclean_exit')).toEqual([]);
});
