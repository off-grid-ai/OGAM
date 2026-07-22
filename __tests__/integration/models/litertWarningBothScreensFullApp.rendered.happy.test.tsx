/** P1 #188 — high-RAM devices download E4B without a false warning on both entry screens. */
import { renderFreshApp, renderMainApp } from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const WARNING = /may exceed your device's memory/i;

describe('P1 #188 LiteRT warning parity through the real App', () => {
  it('downloads directly from onboarding on a high-RAM Android device', async () => {
    const { rtl, view } = await renderFreshApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 9 * GB },
      },
    });

    rtl.fireEvent.press(view.getByTestId('onboarding-skip'));
    await rtl.waitFor(() =>
      expect(view.getByText('Set Up Your AI')).toBeTruthy(),
    );
    await rtl.waitFor(() => expect(view.getByText('Gemma 4 E4B')).toBeTruthy());
    rtl.fireEvent.press(view.getByTestId('litert-model-1-download'));
    await rtl.waitFor(() => expect(view.queryByText(WARNING)).toBeNull());
    expect(view.queryByText('Download anyway')).toBeNull();

    view.unmount();
  }, 30000);

  it('downloads directly from the Models tab on the same high-RAM profile', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: {
        download: true,
        ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 9 * GB },
      },
    });

    rtl.fireEvent.press(view.getByTestId('models-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('models-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Gemma 4 LiteRT')),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('model-detail-screen')).toBeTruthy(),
    );
    rtl.fireEvent.press(view.getByTestId('file-card-1-download'));
    await rtl.waitFor(() => expect(view.queryByText(WARNING)).toBeNull());
    expect(view.queryByText('Download anyway')).toBeNull();

    view.unmount();
  }, 30000);
});
