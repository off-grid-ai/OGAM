/** P1 #83 — LiteRT vision attachment stays available across a real chat lifecycle. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const QUESTION = 'Describe this photo briefly';
const ANSWER = 'The photo shows a quiet mountain lake.';

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

describe('P1 full-App LiteRT vision affordance journey', () => {
  it('keeps Photo available before, during, after, and after revisiting a turn', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [visionModel],
    });
    const { act, fireEvent, waitFor, within } = rtl;
    const ReactNative =
      require('react-native') as typeof import('react-native');

    const openPhotoAffordance = async () => {
      fireEvent.press(view.getByTestId('attach-button'));
      const photo = await waitFor(() => view.getByTestId('attach-photo'));
      expect(photo).toBeTruthy();
      expect(within(photo).getByText('Photo')).toBeTruthy();
    };
    const dismissPhotoAffordance = async () => {
      const attachModal = view
        .UNSAFE_getAllByType(ReactNative.Modal)
        .find(
          modal =>
            modal.props.visible &&
            within(modal).queryByTestId('attach-photo') !== null,
        );
      expect(attachModal).toBeTruthy();
      await act(async () => {
        fireEvent(attachModal!, 'requestClose');
      });
      await waitFor(() =>
        expect(view.queryByTestId('attach-photo')).toBeNull(),
      );
    };

    await openChatWithJourneyModel(rtl, view);

    await openPhotoAffordance();
    await dismissPhotoAffordance();

    boundary.litert.scriptTurn({ content: 'Vision model is ready.' });
    fireEvent.changeText(
      view.getByTestId('chat-input'),
      'Get ready for a photo',
    );
    fireEvent.press(await waitFor(() => view.getByTestId('send-button')));
    await waitFor(
      () => expect(view.getByText('Vision model is ready.')).toBeTruthy(),
      { timeout: 8000 },
    );

    await openPhotoAffordance();
    fireEvent.press(view.getByTestId('attach-photo'));
    fireEvent.press(await waitFor(() => view.getByText('Photo Library')));
    await waitFor(() =>
      expect(view.getByTestId(/^attachment-image-/)).toBeTruthy(),
    );

    boundary.litert.scriptHang();
    fireEvent.changeText(view.getByTestId('chat-input'), QUESTION);
    fireEvent.press(await waitFor(() => view.getByTestId('send-button')));
    try {
      await waitFor(() => {
        expect(view.getByTestId('stop-button')).toBeTruthy();
        expect(view.getByTestId('message-image-0')).toBeTruthy();
        expect(view.queryByText(ANSWER)).toBeNull();
      });

      await openPhotoAffordance();
      await dismissPhotoAffordance();
    } finally {
      await act(async () => {
        boundary.litertEvents.emit('litert_token', ANSWER);
        boundary.litertEvents.emit('litert_complete', '{}');
      });
    }
    await waitFor(() => {
      expect(view.getByText(ANSWER)).toBeTruthy();
      expect(view.queryByTestId('stop-button')).toBeNull();
      expect(view.getByTestId('attach-button')).toBeTruthy();
    });

    await openPhotoAffordance();
    await dismissPhotoAffordance();

    fireEvent.press(view.getByTestId('chat-back-button'));
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy());
    fireEvent.press(
      await waitFor(() => view.getByTestId('conversation-item-0')),
    );
    await waitFor(() => {
      expect(view.getByTestId('chat-screen')).toBeTruthy();
      expect(view.getByText(ANSWER)).toBeTruthy();
      expect(view.getByTestId('message-image-0')).toBeTruthy();
    });

    await openPhotoAffordance();
    await dismissPhotoAffordance();

    view.unmount();
  }, 30000);
});
