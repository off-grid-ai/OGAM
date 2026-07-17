import { relaunchMainApp, renderMainApp } from '../../harness/appJourney';

describe('experimental features settings journey', () => {
  it('opens the experimental screen and opts into Multi-Token Prediction', async () => {
    const { asyncStorage, rtl, view } = await renderMainApp();

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() =>
      expect(view.getByText('Experimental Features')).toBeTruthy(),
    );

    rtl.fireEvent.press(view.getByText('Experimental Features'));
    await rtl.waitFor(() =>
      expect(view.getByText('Multi-Token Prediction')).toBeTruthy(),
    );

    const toggle = view.getByTestId('experimental-mtp-toggle');
    expect(toggle.props.accessibilityState?.checked).toBe(false);
    rtl.fireEvent(toggle, 'valueChange', true);

    await rtl.waitFor(() =>
      expect(
        view.getByTestId('experimental-mtp-toggle').props.accessibilityState
          ?.checked,
      ).toBe(true),
    );
    expect(view.getByText('EXPERIMENTAL')).toBeTruthy();
    expect(
      view.getByText(/Reload the model after changing this setting/),
    ).toBeTruthy();

    await rtl.waitFor(async () => {
      const raw = await asyncStorage.getItem('local-llm-app-storage');
      expect(JSON.parse(raw ?? '{}').state?.settings?.experimentalMtp).toBe(
        true,
      );
    });

    view.unmount();
    const relaunched = await relaunchMainApp();
    relaunched.rtl.fireEvent.press(relaunched.view.getByTestId('settings-tab'));
    relaunched.rtl.fireEvent.press(
      await relaunched.rtl.waitFor(() =>
        relaunched.view.getByText('Experimental Features'),
      ),
    );
    await relaunched.rtl.waitFor(() => {
      expect(
        relaunched.view.getByTestId('experimental-mtp-toggle').props
          .accessibilityState?.checked,
      ).toBe(true);
    });
    relaunched.view.unmount();
  });
});
