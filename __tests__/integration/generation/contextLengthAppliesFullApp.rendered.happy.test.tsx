/** P1 #33 — rendered context-length changes reach native model reloads. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

type Journey = Awaited<ReturnType<typeof renderMainApp>>;

async function setInitialContextInModelSettings(
  journey: Journey,
  value: string,
): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByText('Model Settings')),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('text-generation-accordion')),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() =>
      view.getByTestId('llama-context-length-value-button'),
    ),
  );
  const input = view.getByTestId('llama-context-length-input');
  rtl.fireEvent.changeText(input, value);
  rtl.fireEvent(input, 'submitEditing');
  await rtl.waitFor(() =>
    expect(view.getByTestId('llama-context-length-value')).toHaveTextContent(
      '2K',
    ),
  );

  rtl.fireEvent.press(view.getByTestId('back-button'));
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('home-tab')));
  await rtl.waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
}

async function setContextInChat(
  journey: Journey,
  value: string,
): Promise<void> {
  const { rtl, view } = journey;

  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  await rtl.waitFor(() => expect(view.getByText('Chat Settings')).toBeTruthy());
  rtl.fireEvent.press(view.getByText('TEXT GENERATION'));
  rtl.fireEvent.press(
    await rtl.waitFor(() =>
      view.getByTestId('setting-contextLength-value-button'),
    ),
  );
  const input = view.getByTestId('setting-contextLength-input');
  rtl.fireEvent.changeText(input, value);
  rtl.fireEvent(input, 'submitEditing');
  await rtl.waitFor(() =>
    expect(view.getByTestId('setting-contextLength-value')).toHaveTextContent(
      '6K',
    ),
  );
  rtl.fireEvent.press(view.getByText('Done'));
  await rtl.waitFor(
    () => expect(view.queryByText('Chat Settings')).toBeNull(),
    { timeout: 4000 },
  );
}

function textInitRequests(journey: Journey): Array<Record<string, unknown>> {
  return journey.boundary
    .llama!.module.initLlama.mock.calls.map(
      call => call[0] as Record<string, unknown>,
    )
    .filter(request => typeof request.n_ctx === 'number' && !request.embedding);
}

describe('P1 full-app context-length setting journey', () => {
  it('loads and reloads the selected native context without a stale snapshot', async () => {
    const journey = await renderMainApp({
      boundary: { llama: true },
    });
    const { boundary, rtl, view } = journey;

    await setInitialContextInModelSettings(journey, '2048');
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'The first context was applied.',
    });
    sendChatMessage(rtl, view, 'Use the initial context');
    await rtl.waitFor(
      () => {
        expect(view.getByText('The first context was applied.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 8000 },
    );

    const firstLoads = textInitRequests(journey);
    expect(firstLoads.at(-1)).toEqual(expect.objectContaining({ n_ctx: 2048 }));
    const loadsAfterFirstTurn = firstLoads.length;

    // Context length is a load-time setting. Changing it in the live Chat must
    // expose the reload action and initialize a fresh native context with 6144.
    await setContextInChat(journey, '6144');
    const reloadBanner = await rtl.waitFor(() =>
      view.getByTestId('reload-model-banner'),
    );
    rtl.fireEvent.press(reloadBanner);
    await rtl.waitFor(
      () => expect(view.queryByTestId('reload-model-banner')).toBeNull(),
      { timeout: 10000 },
    );

    const reloadedRequests = textInitRequests(journey);
    expect(reloadedRequests.length).toBeGreaterThan(loadsAfterFirstTurn);
    expect(reloadedRequests.at(-1)).toEqual(
      expect.objectContaining({ n_ctx: 6144 }),
    );
    expect(reloadedRequests.at(-1)?.n_ctx).not.toBe(firstLoads.at(-1)?.n_ctx);

    boundary.llama!.scriptCompletion({
      text: 'The reloaded context answered successfully.',
    });
    sendChatMessage(rtl, view, 'Use the reloaded context');
    await rtl.waitFor(
      () => {
        expect(
          view.getByText('The reloaded context answered successfully.'),
        ).toBeTruthy();
        expect(view.getByText('The first context was applied.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value).toBe('');
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.queryByTestId('reload-model-banner')).toBeNull();
      },
      { timeout: 8000 },
    );

    view.unmount();
  }, 30000);
});
