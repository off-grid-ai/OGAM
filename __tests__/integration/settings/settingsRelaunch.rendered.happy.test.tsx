/** P1 #166 — representative generation settings survive a full App relaunch. */
import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';

async function openModelSettings(
  journey: Awaited<ReturnType<typeof renderMainApp>>,
) {
  const { rtl, view } = journey;
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByText('Model Settings')),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('text-generation-accordion')),
  );
}

describe('P1 settings relaunch journey', () => {
  it('keeps generation controls and the default system prompt', async () => {
    const firstLaunch = await renderMainApp({
      persistedAppState: {
        activeModelId: 'test/journey-model/journey-model-Q4_K_M.gguf',
      },
    });
    await openModelSettings(firstLaunch);

    firstLaunch.rtl.fireEvent.press(
      firstLaunch.view.getByTestId('llama-temperature-value-button'),
    );
    const temperatureInput = firstLaunch.view.getByTestId(
      'llama-temperature-input',
    );
    firstLaunch.rtl.fireEvent.changeText(temperatureInput, '0.35');
    firstLaunch.rtl.fireEvent(temperatureInput, 'submitEditing');
    await firstLaunch.rtl.waitFor(() =>
      expect(
        firstLaunch.view.getByTestId('llama-temperature-value').props.children,
      ).toBe('0.35'),
    );

    firstLaunch.rtl.fireEvent.press(
      firstLaunch.view.getByTestId('system-prompt-accordion'),
    );
    const promptInput = await firstLaunch.rtl.waitFor(() =>
      firstLaunch.view.getByPlaceholderText('Enter system prompt...'),
    );
    firstLaunch.rtl.fireEvent.changeText(
      promptInput,
      'Answer as a concise offline assistant.',
    );
    await firstLaunch.rtl.waitFor(() =>
      expect(promptInput.props.value).toBe(
        'Answer as a concise offline assistant.',
      ),
    );
    firstLaunch.view.unmount();

    const relaunched = await relaunchMainApp();
    await openModelSettings(relaunched);
    await relaunched.rtl.waitFor(() =>
      expect(
        relaunched.view.getByTestId('llama-temperature-value').props.children,
      ).toBe('0.35'),
    );

    relaunched.rtl.fireEvent.press(
      relaunched.view.getByTestId('system-prompt-accordion'),
    );
    await relaunched.rtl.waitFor(() =>
      expect(
        relaunched.view.getByDisplayValue(
          'Answer as a concise offline assistant.',
        ),
      ).toBeTruthy(),
    );
    relaunched.view.unmount();
  });
});
