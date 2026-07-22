/** P1 regression - a model's trained maximum must not replace the device-safe KV allocation limit. */
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';

async function openContextSetting(
  journey: Awaited<ReturnType<typeof renderMainApp>>,
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
}

async function enterContext(
  journey: Awaited<ReturnType<typeof renderMainApp>>,
  value: string,
): Promise<void> {
  const { rtl, view } = journey;
  const input = view.getByTestId('llama-context-length-input');
  rtl.fireEvent.changeText(input, value);
  rtl.fireEvent(input, 'submitEditing');
}

describe('P1 stable context allocation limit', () => {
  it('keeps a 256K-trained model at the same 8K device limit before and after load', async () => {
    const journey = await renderMainApp({ boundary: { llama: true } });
    const { boundary, rtl, view } = journey;
    boundary.llama!.setModelContextLength(262144);

    await openContextSetting(journey);
    await enterContext(journey, '262144');
    await rtl.waitFor(() =>
      expect(view.getByTestId('llama-context-length-value')).toHaveTextContent(
        '8K',
      ),
    );

    rtl.fireEvent.press(view.getByTestId('back-button'));
    rtl.fireEvent.press(view.getByTestId('home-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openChatWithJourneyModel(rtl, view);
    boundary.llama!.scriptCompletion({ text: 'Context limit applied.' });
    sendChatMessage(rtl, view, 'Load the model');
    await rtl.waitFor(() =>
      expect(view.getByText('Context limit applied.')).toBeTruthy(),
    );
    await rtl.waitFor(() => {
      const textLoads = boundary
        .llama!.module.initLlama.mock.calls.map(
          call => call[0] as Record<string, unknown>,
        )
        .filter(request => !request.embedding);
      expect(textLoads.at(-1)).toEqual(
        expect.objectContaining({ n_ctx: 8192 }),
      );
    });

    rtl.fireEvent.press(view.getByTestId('chat-back-button'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('home-screen')).toBeTruthy(),
    );
    await openContextSetting(journey);
    await enterContext(journey, '262144');
    await rtl.waitFor(() =>
      expect(view.getByTestId('llama-context-length-value')).toHaveTextContent(
        '8K',
      ),
    );

    view.unmount();
  }, 30000);
});
