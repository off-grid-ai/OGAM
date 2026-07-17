/** P2 #71 — a pending image opens and closes the shared fullscreen viewer. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const visionModel: DownloadedModel = {
  id: 'test/journey-vision/journey-vision.litertlm',
  name: 'Journey Model',
  author: 'test',
  filePath: '/docs/models/journey-vision.litertlm',
  fileName: 'journey-vision.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'INT4',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: true,
};

describe('P2 full-app pending attachment preview', () => {
  it('closes back to the composer without removing the attached image', async () => {
    const { rtl, view } = await renderMainApp({
      downloadedModels: [visionModel],
    });
    await openChatWithJourneyModel(rtl, view);

    rtl.fireEvent.press(view.getByTestId('attach-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('attach-photo')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Photo Library')),
    );
    const thumbnail = await rtl.waitFor(() =>
      view.getByTestId(/^attachment-image-/),
    );
    expect(view.queryByText('Close')).toBeNull();

    rtl.fireEvent.press(thumbnail);
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Close')));

    await rtl.waitFor(() => {
      expect(view.queryByText('Close')).toBeNull();
      expect(view.getByTestId('attachments-container')).toBeTruthy();
      expect(view.getByTestId(/^attachment-image-/)).toBeTruthy();
    });

    view.unmount();
  });
});
