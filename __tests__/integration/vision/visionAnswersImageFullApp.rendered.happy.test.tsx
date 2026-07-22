/** P1 #80 — a real vision chat sends its attached image to native inference. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const QUESTION = 'What animal is sitting by the window?';
const ANSWER = 'A tabby cat is sitting beside the window.';

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

describe('P1 full-App vision question journey', () => {
  it('keeps the photo in the conversation and renders the native vision answer', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [visionModel],
    });
    const { fireEvent, waitFor } = rtl;
    await openChatWithJourneyModel(rtl, view);

    fireEvent.press(view.getByTestId('attach-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('attach-photo')));
    fireEvent.press(await waitFor(() => view.getByText('Photo Library')));
    const pendingPhoto = await waitFor(() =>
      view.getByTestId(/^attachment-image-/),
    );
    const photoUri = pendingPhoto.findByType(
      require('react-native').Image as typeof import('react-native').Image,
    ).props.source.uri as string;
    expect(photoUri).toMatch(/^\/docs\/attachments\/images\//);

    boundary.litert.scriptTurn({ content: ANSWER });
    fireEvent.changeText(view.getByTestId('chat-input'), QUESTION);
    fireEvent.press(await waitFor(() => view.getByTestId('send-button')));

    await waitFor(
      () => {
        expect(view.getByText(ANSWER)).toBeTruthy();
        expect(view.getByTestId('message-attachment-0')).toBeTruthy();
        expect(view.getByTestId('message-image-0').props.source.uri).toBe(
          photoUri,
        );
      },
      { timeout: 8000 },
    );
    expect(
      rtl.within(view.getByTestId('user-message')).getByText(QUESTION),
    ).toBeTruthy();
    expect(view.queryByTestId('attachments-container')).toBeNull();

    expect(boundary.litert.calls.sendMessageWithImages).toHaveLength(1);
    expect(boundary.litert.calls.sendMessageWithImages[0]).toEqual([
      QUESTION,
      [photoUri],
    ]);
    expect(
      boundary.litert.calls.sendMessage.some(([text]) => text === QUESTION),
    ).toBe(false);

    view.unmount();
  }, 30000);
});
