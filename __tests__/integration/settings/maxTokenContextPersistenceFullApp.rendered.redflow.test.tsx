/**
 * GGUF regression — response tokens are bounded by the selected llama
 * context on both real settings surfaces and reach the native completion request.
 */
import {
  closeAppSheet,
  openChatWithJourneyModel,
  relaunchMainApp,
  renderMainApp,
  sendChatMessage,
  type RenderedAppJourney,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const LARGE_DEVICE = {
  platform: 'android' as const,
  totalBytes: 12 * GB,
  availBytes: 10 * GB,
};

async function openModelTextSettings(
  journey: Pick<RenderedAppJourney, 'rtl' | 'view'>,
): Promise<void> {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByText('Model Settings')),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('text-generation-accordion')),
  );
  await rtl.waitFor(() => expect(view.getByText('Max Tokens')).toBeTruthy());
}

async function enterValue(
  journey: Pick<RenderedAppJourney, 'rtl' | 'view'>,
  settingId: string,
  value: string,
): Promise<void> {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId(`${settingId}-value-button`));
  const input = view.getByTestId(`${settingId}-input`);
  rtl.fireEvent.changeText(input, value);
  rtl.fireEvent(input, 'submitEditing');
}

async function openChatTextSettings(
  journey: Pick<RenderedAppJourney, 'rtl' | 'view'>,
): Promise<void> {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId('chat-settings-icon'));
  await rtl.waitFor(() => expect(view.getByText('Chat Settings')).toBeTruthy());
  rtl.fireEvent.press(view.getByText('TEXT GENERATION'));
  await rtl.waitFor(() =>
    expect(view.getByTestId('setting-maxTokens-value')).toBeTruthy(),
  );
}

describe('GGUF max-output context contract', () => {
  it('clamps on context reduction, persists, and sends the selected n_predict through the real App', async () => {
    const firstLaunch = await renderMainApp({
      boundary: { ram: LARGE_DEVICE },
      persistedAppState: {
        settings: {
          maxTokens: 6144,
          contextLength: 8192,
        },
      },
    });

    await openModelTextSettings(firstLaunch);
    expect(
      firstLaunch.view.getByTestId('llama-max-tokens-value'),
    ).toHaveTextContent('6.0K');
    expect(
      firstLaunch.view.getByTestId('llama-context-length-value'),
    ).toHaveTextContent('8K');

    // Lowering the allocated context must atomically make the persisted output
    // budget valid; it cannot leave a hidden 6K n_predict behind a 2K context.
    await enterValue(firstLaunch, 'llama-context-length', '2048');
    await firstLaunch.rtl.waitFor(() => {
      expect(
        firstLaunch.view.getByTestId('llama-context-length-value'),
      ).toHaveTextContent('2K');
      expect(
        firstLaunch.view.getByTestId('llama-max-tokens-value'),
      ).toHaveTextContent('2.0K');
    });

    firstLaunch.view.unmount();

    const secondLaunch = await relaunchMainApp({
      boundary: { llama: true, ram: LARGE_DEVICE },
    });
    await openModelTextSettings(secondLaunch);
    await secondLaunch.rtl.waitFor(() => {
      expect(
        secondLaunch.view.getByTestId('llama-context-length-value'),
      ).toHaveTextContent('2K');
      expect(
        secondLaunch.view.getByTestId('llama-max-tokens-value'),
      ).toHaveTextContent('2.0K');
    });

    secondLaunch.rtl.fireEvent.press(
      secondLaunch.view.getByTestId('back-button'),
    );
    secondLaunch.rtl.fireEvent.press(
      await secondLaunch.rtl.waitFor(() =>
        secondLaunch.view.getByTestId('home-tab'),
      ),
    );
    await openChatWithJourneyModel(secondLaunch.rtl, secondLaunch.view);
    await openChatTextSettings(secondLaunch);

    // The in-chat surface uses the same limit owner and accepts an exact value
    // below the selected context.
    await enterValue(secondLaunch, 'setting-maxTokens', '1536');
    await secondLaunch.rtl.waitFor(() =>
      expect(
        secondLaunch.view.getByTestId('setting-maxTokens-value'),
      ).toHaveTextContent('1.5K'),
    );

    // Raising the selected context immediately raises the output ceiling. Both
    // values are persisted together and take effect on the next model reload.
    await enterValue(secondLaunch, 'setting-contextLength', '4096');
    await secondLaunch.rtl.waitFor(() =>
      expect(
        secondLaunch.view.getByTestId('setting-contextLength-value'),
      ).toHaveTextContent('4K'),
    );
    await enterValue(secondLaunch, 'setting-maxTokens', '4096');
    await secondLaunch.rtl.waitFor(() =>
      expect(
        secondLaunch.view.getByTestId('setting-maxTokens-value'),
      ).toHaveTextContent('4.0K'),
    );

    // Select the exact runtime budget whose native n_predict value is proven
    // below. This goes through the rendered slider instead of direct store state.
    await enterValue(secondLaunch, 'setting-maxTokens', '1536');
    await secondLaunch.rtl.waitFor(() =>
      expect(
        secondLaunch.view.getByTestId('setting-maxTokens-value'),
      ).toHaveTextContent('1.5K'),
    );
    await closeAppSheet(secondLaunch, 'Chat Settings');

    secondLaunch.boundary.llama!.scriptCompletion({
      text: 'The bounded response completed.',
    });
    sendChatMessage(secondLaunch.rtl, secondLaunch.view, 'Use my output limit');
    await secondLaunch.rtl.waitFor(() =>
      expect(
        secondLaunch.view.getByText('The bounded response completed.'),
      ).toBeTruthy(),
    );
    const completion = secondLaunch.boundary.llama!.calls.completion.at(
      -1,
    )?.[0] as { n_predict?: number } | undefined;
    expect(completion?.n_predict).toBe(1536);

    secondLaunch.view.unmount();
  }, 40000);
});
