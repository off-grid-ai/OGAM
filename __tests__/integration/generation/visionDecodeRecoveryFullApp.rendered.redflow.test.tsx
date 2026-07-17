/** P1 #82 — a fatal GGUF vision decode error is visible and a later vision turn succeeds. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
  sendChatMessage,
} from '../../harness/appJourney';
import { GB } from '../../harness/nativeBoundary';

const MODEL_PATH = '/docs/models/journey-vision-Q4_K_M.gguf';
const MMPROJ_PATH = '/docs/models/mmproj-journey-vision-f16.gguf';
const visionModel: DownloadedModel = {
  id: 'test/journey-vision/journey-vision-Q4_K_M.gguf',
  name: 'Journey Vision',
  author: 'test',
  fileName: 'journey-vision-Q4_K_M.gguf',
  filePath: MODEL_PATH,
  fileSize: 4 * GB,
  quantization: 'Q4_K_M',
  downloadedAt: '2026-07-17T00:00:00.000Z',
  engine: 'llama',
  isVisionModel: true,
  mmProjFileName: 'mmproj-journey-vision-f16.gguf',
  mmProjPath: MMPROJ_PATH,
};

async function attachPhoto(
  rtl: Awaited<ReturnType<typeof renderMainApp>>['rtl'],
  view: Awaited<ReturnType<typeof renderMainApp>>['view'],
): Promise<void> {
  rtl.fireEvent.press(view.getByTestId('attach-button'));
  rtl.fireEvent.press(
    await rtl.waitFor(() => view.getByTestId('attach-photo')),
  );
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByText('Photo Library')));
  await rtl.waitFor(() =>
    expect(view.getByTestId(/^attachment-image-/)).toBeTruthy(),
  );
}

describe('P1 fatal vision decode recovery full-App journey', () => {
  it('keeps partial output, reports the failure, returns idle, and answers a retried vision request', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      boundary: {
        llama: true,
        llamaVision: true,
        ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 9 * GB },
      },
      downloadedModels: [visionModel],
      beforeRender: ({ boundary: native }) => {
        native.fs!.seedFile(MMPROJ_PATH, 256 * 1024 * 1024);
      },
    });
    await openChatWithJourneyModel(rtl, view);
    await attachPhoto(rtl, view);

    boundary.llama!.scriptCompletion({
      text: 'I can see part of the scene',
      throwAfter: 'llama_decode: failed to decode, ret = -1',
    });
    sendChatMessage(rtl, view, 'Describe this large image.');

    await rtl.waitFor(
      () => {
        expect(view.getByText('I can see part of the scene')).toBeTruthy();
        expect(
          view.getByText(/llama_decode: failed to decode, ret = -1/i),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
        expect(view.getByTestId('chat-input').props.editable).not.toBe(false);
      },
      { timeout: 10000 },
    );

    rtl.fireEvent.press(view.getByText('OK'));
    await attachPhoto(rtl, view);
    boundary.llama!.scriptCompletion({
      text: 'The retried image shows a mountain beneath a clear sky.',
    });
    sendChatMessage(rtl, view, 'Please inspect the image again.');

    await rtl.waitFor(
      () => {
        expect(
          view.getByText(
            'The retried image shows a mountain beneath a clear sky.',
          ),
        ).toBeTruthy();
        expect(view.queryByTestId('stop-button')).toBeNull();
      },
      { timeout: 10000 },
    );

    view.unmount();
  }, 40000);
});
