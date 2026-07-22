/** APP-P1-009 — selected images become app-owned and missing files recover visibly. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  relaunchMainApp,
  renderMainApp,
} from '../../harness/appJourney';

const QUESTION = 'What is in this durable photo?';
const ANSWER = 'The photo shows a tabby cat.';

const visionModel: DownloadedModel = {
  id: 'test/durable-vision/durable-vision.litertlm',
  name: 'Durable Vision',
  author: 'test',
  filePath: '/docs/models/durable-vision.litertlm',
  fileName: 'durable-vision.litertlm',
  fileSize: 128 * 1024 * 1024,
  quantization: 'INT4',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'litert',
  liteRTVision: true,
};

describe('APP-P1-009 full-App image attachment durability', () => {
  it('copies a picked photo into app storage and shows a recovery state if it later disappears', async () => {
    const first = await renderMainApp({ downloadedModels: [visionModel] });
    await openChatWithJourneyModel(first.rtl, first.view);

    first.rtl.fireEvent.press(first.view.getByTestId('attach-button'));
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByTestId('attach-photo')),
    );
    first.rtl.fireEvent.press(
      await first.rtl.waitFor(() => first.view.getByText('Photo Library')),
    );
    const pendingPhoto = await first.rtl.waitFor(() =>
      first.view.getByTestId(/^attachment-image-/),
    );
    const durableUri = pendingPhoto.findByType(
      require('react-native').Image as typeof import('react-native').Image,
    ).props.source.uri as string;
    expect(durableUri).toMatch(/^\/docs\/attachments\/images\//);
    await expect(
      (first.boundary.fs!.module.exists as (path: string) => Promise<boolean>)(
        durableUri,
      ),
    ).resolves.toBe(true);

    first.boundary.litert.scriptTurn({ content: ANSWER });
    first.rtl.fireEvent.changeText(
      first.view.getByTestId('chat-input'),
      QUESTION,
    );
    first.rtl.fireEvent.press(first.view.getByTestId('send-button'));
    await first.rtl.waitFor(() => {
      expect(first.view.getByText(ANSWER)).toBeTruthy();
      expect(first.view.getByTestId('message-image-0').props.source.uri).toBe(
        durableUri,
      );
    });
    expect(first.boundary.litert.calls.sendMessageWithImages[0]).toEqual([
      QUESTION,
      [durableUri],
    ]);
    first.view.unmount();

    // A fresh device filesystem models an attachment removed outside the app.
    // The persisted conversation must remain usable and explain the missing file.
    const second = await relaunchMainApp();
    second.rtl.fireEvent.press(second.view.getByTestId('chats-tab'));
    second.rtl.fireEvent.press(
      await second.rtl.waitFor(() => second.view.getByText(QUESTION)),
    );
    await second.rtl.waitFor(() => {
      expect(second.view.getByText(ANSWER)).toBeTruthy();
      expect(second.view.getByText('Image unavailable')).toBeTruthy();
      expect(
        second.view.getByText('This image is no longer on this device.'),
      ).toBeTruthy();
      expect(second.view.queryByTestId('message-image-0')).toBeNull();
    });

    second.view.unmount();
  }, 30000);
});
