/**
 * P1 regression — Android Gemma LiteRT vision must recover when the native
 * runtime reports that the image/tool prompt no longer fits its effective
 * (possibly RAM-clamped) context window.
 */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const QUESTION = 'Describe the animal in this photo.';
const ANSWER = 'A tabby cat is resting beside a window.';

const visionModel: DownloadedModel = {
  id: 'test/gemma-vision-context/gemma-4-E2B-it.litertlm',
  name: 'Gemma 4 E2B',
  author: 'test',
  filePath: '/docs/models/gemma-4-E2B-it.litertlm',
  fileName: 'gemma-4-E2B-it.litertlm',
  fileSize: 2_588_147_712,
  quantization: 'LiteRT',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: true,
};

describe('P1 full-App LiteRT vision context recovery', () => {
  it('keeps the image and retries without optional tool context after native overflow', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [visionModel],
    });
    const { fireEvent, waitFor } = rtl;

    // Device boundary: Android may reduce the requested context after measuring
    // real free RAM. The app must use the native effective value and still make
    // the user's vision turn succeed.
    boundary.litert.module.loadModel.mockResolvedValue({
      backend: 'gpu',
      maxNumTokens: 880,
    });
    await openChatWithJourneyModel(rtl, view);

    // Complete one ordinary turn so the lazy model load and GPU warmup have
    // finished. The reported regression happens when adding an image to the
    // already-running Gemma conversation.
    boundary.litert.scriptTurn({ content: 'Ready for an image.' });
    fireEvent.changeText(view.getByTestId('chat-input'), 'Are you ready?');
    fireEvent.press(await waitFor(() => view.getByTestId('send-button')));
    await waitFor(() =>
      expect(view.getByText('Ready for an image.')).toBeTruthy(),
    );

    fireEvent.press(view.getByTestId('attach-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('attach-photo')));
    fireEvent.press(await waitFor(() => view.getByText('Photo Library')));
    const pendingPhoto = await waitFor(() =>
      view.getByTestId(/^attachment-image-/),
    );
    const photoUri = pendingPhoto.findByType(
      require('react-native').Image as typeof import('react-native').Image,
    ).props.source.uri as string;

    // First native attempt reproduces the Android LiteRT wording. The queued
    // completion is consumed only by the app's recovery attempt.
    boundary.litert.scriptError(
      'OUT_OF_RANGE: The input is out of context for this conversation',
    );
    boundary.litert.scriptTurn({ content: ANSWER });
    fireEvent.changeText(view.getByTestId('chat-input'), QUESTION);
    fireEvent.press(await waitFor(() => view.getByTestId('send-button')));

    await waitFor(() => expect(view.getByText(ANSWER)).toBeTruthy(), {
      timeout: 8000,
    });
    expect(view.queryByText('Generation Error')).toBeNull();
    expect(view.queryByText('Context window full')).toBeNull();
    expect(view.queryByTestId('stop-button')).toBeNull();
    expect(view.getByTestId('message-image-0').props.source.uri).toBe(photoUri);

    expect(boundary.litert.calls.sendMessageWithImages).toEqual([
      [QUESTION, [photoUri]],
      [QUESTION, [photoUri]],
    ]);
    const resetCalls = boundary.litert.calls.resetConversation;
    expect(resetCalls.length).toBeGreaterThanOrEqual(2);
    expect(resetCalls.at(-1)?.[4]).toBe('');

    view.unmount();
  }, 30000);
});
