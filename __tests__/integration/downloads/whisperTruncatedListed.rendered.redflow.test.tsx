/** P1 #19 — truncated Whisper files never surface as ready in the real App. */
import { renderMainApp } from '../../harness/appJourney';

describe('P1 truncated Whisper-file journey', () => {
  it('lists a valid positive control but hides the truncated model', async () => {
    const { rtl, view } = await renderMainApp({
      boundary: { download: true },
      beforeRender: ({ boundary }) => {
        const dir = `${boundary.fs!.DocumentDirectoryPath}/whisper-models`;
        boundary.fs!.seedFile(`${dir}/ggml-tiny.en.bin`, 75 * 1024 * 1024);
        boundary.fs!.seedFile(`${dir}/ggml-base.en.bin`, 5 * 1024 * 1024);
      },
    });
    const { fireEvent, waitFor } = rtl;

    fireEvent.press(view.getByTestId('models-tab'));
    await waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
    fireEvent.press(view.getByTestId('downloads-icon'));
    await waitFor(() =>
      expect(view.getByTestId('downloaded-models-screen')).toBeTruthy(),
    );
    fireEvent.press(view.getByText('Voice Models'));

    await waitFor(() =>
      expect(view.getByText('ggml-tiny.en.bin')).toBeTruthy(),
    );
    expect(view.queryByText('ggml-base.en.bin')).toBeNull();
    view.unmount();
  });
});
