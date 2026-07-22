/** P2 #111 — Device Information reports the native memory snapshot. */
import { GB } from '../../harness/nativeBoundary';
import { renderMainApp } from '../../harness/appJourney';

describe('P2 Device Information memory journey', () => {
  it('shows total and currently available memory from the device boundary', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: {
        ram: {
          platform: 'ios',
          totalBytes: 10 * GB,
          availBytes: 6 * GB,
        },
      },
    });

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Device Information')),
    );

    await rtl.waitFor(() => {
      expect(view.getByText('Total RAM')).toBeTruthy();
      expect(view.getAllByText('10.0 GB')).toHaveLength(2);
      expect(view.getByText('Available Now')).toBeTruthy();
      expect(view.getByText('6.0 GB')).toBeTruthy();
      expect(view.queryByText('…')).toBeNull();
    });

    view.unmount();
  });
});
