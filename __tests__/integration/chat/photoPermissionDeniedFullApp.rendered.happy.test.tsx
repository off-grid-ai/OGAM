/** P2 #79 - denied photo access explains recovery and leaves chat usable. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
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

describe('P2 denied photo permission journey', () => {
  it('shows a recovery action and sends a text message after dismissal', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [visionModel],
    });
    await openChatWithJourneyModel(rtl, view);

    const imagePicker = require('react-native-image-picker') as {
      launchImageLibrary: jest.Mock;
    };
    imagePicker.launchImageLibrary.mockResolvedValueOnce({
      errorCode: 'permission',
      errorMessage: 'Photo library permission denied',
    });

    rtl.fireEvent.press(view.getByTestId('attach-button'));
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByTestId('attach-photo')),
    );
    rtl.fireEvent.press(
      await rtl.waitFor(() => view.getByText('Photo Library')),
    );

    await rtl.waitFor(
      () => {
        expect(view.getByText('Photo Access Denied')).toBeTruthy();
        expect(
          view.getByText(
            'Allow photo access in your device settings, then try again.',
          ),
        ).toBeTruthy();
      },
      { timeout: 3000 },
    );
    expect(view.queryByTestId('attachments-container')).toBeNull();

    rtl.fireEvent.press(view.getByText('OK'));
    await rtl.waitFor(() =>
      expect(view.queryByText('Photo Access Denied')).toBeNull(),
    );

    boundary.litert.scriptTurn({ content: 'Chat still works.' });
    sendChatMessage(rtl, view, 'Continue without the photo');

    await rtl.waitFor(
      () => {
        expect(
          view.getAllByText('Continue without the photo').length,
        ).toBeGreaterThan(0);
        expect(view.getByText('Chat still works.')).toBeTruthy();
        expect(view.getByTestId('chat-input').props.value ?? '').toBe('');
      },
      { timeout: 6000 },
    );

    view.unmount();
  }, 30000);
});
