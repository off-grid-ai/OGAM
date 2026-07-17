/** Regression — explicit maximum output and KV-cache settings survive hydration and relaunch. */
import {
  relaunchMainApp,
  renderMainApp,
  type RenderedAppJourney,
} from '../../harness/appJourney';

async function expectMaximumLlamaSettings({
  rtl,
  view,
}: Pick<RenderedAppJourney, 'rtl' | 'view'>): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('settings-tab'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByText('Model Settings')),
  );
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('text-generation-accordion')),
  );

  await rtl.waitFor(() => {
    expect(view.getByText('Max Tokens')).toBeTruthy();
    expect(view.getByTestId('llama-max-tokens-value')).toHaveTextContent(
      '8.0K',
    );
    expect(
      view.getByText('KV cache size — larger uses more RAM (requires reload)'),
    ).toBeTruthy();
    expect(view.getByTestId('llama-context-length-value')).toHaveTextContent(
      '32K',
    );
  });
}

describe('maximum text settings persistence regression', () => {
  it('keeps the configured maxima visible across migration and another app launch', async () => {
    const firstLaunch = await renderMainApp({
      persistedAppState: {
        settings: {
          maxTokens: 8192,
          contextLength: 32768,
        },
      },
    });

    await expectMaximumLlamaSettings(firstLaunch);
    firstLaunch.view.unmount();

    const secondLaunch = await relaunchMainApp();
    await expectMaximumLlamaSettings(secondLaunch);
    secondLaunch.view.unmount();
  }, 30000);
});
