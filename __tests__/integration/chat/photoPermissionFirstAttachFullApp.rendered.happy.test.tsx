/** P2 #78 — first photo attachment crosses the OS permission prompt successfully. */
import type { DownloadedModel } from '../../../src/types';
import {
  openChatWithJourneyModel,
  renderMainApp,
} from '../../harness/appJourney';

const PHOTO_URI = 'file:///photos/first-attachment.jpg';

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

describe('P2 first-attach photo permission journey', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('presents native photo permission and attaches the selected image after Allow', async () => {
    const { boundary, rtl, view } = await renderMainApp({
      downloadedModels: [visionModel],
    });
    boundary.fs!.seedFile('/photos/first-attachment.jpg', 1024);
    const { act, fireEvent, waitFor } = rtl;
    await openChatWithJourneyModel(rtl, view);

    const ReactNative =
      require('react-native') as typeof import('react-native');
    const imagePicker = require('react-native-image-picker') as {
      launchImageLibrary: jest.Mock;
    };
    const permissionPrompt = jest.spyOn(ReactNative.Alert, 'alert');
    imagePicker.launchImageLibrary.mockImplementation(
      () =>
        new Promise(resolve => {
          ReactNative.Alert.alert(
            'Allow Photo Access?',
            'Off Grid AI needs access to the photo you choose to attach.',
            [
              { text: "Don't Allow" },
              {
                text: 'Allow',
                onPress: () =>
                  resolve({
                    assets: [
                      {
                        uri: PHOTO_URI,
                        type: 'image/jpeg',
                        fileName: 'first-attachment.jpg',
                        width: 1200,
                        height: 800,
                      },
                    ],
                  }),
              },
            ],
          );
        }),
    );

    fireEvent.press(view.getByTestId('attach-button'));
    fireEvent.press(await waitFor(() => view.getByTestId('attach-photo')));
    await waitFor(() => expect(view.getByText('Add Image')).toBeTruthy());
    expect(view.getByText('Choose image source')).toBeTruthy();
    fireEvent.press(view.getByText('Photo Library'));

    await waitFor(() =>
      expect(permissionPrompt).toHaveBeenCalledWith(
        'Allow Photo Access?',
        'Off Grid AI needs access to the photo you choose to attach.',
        expect.any(Array),
      ),
    );
    const nativeButtons = permissionPrompt.mock.calls.at(-1)?.[2] as
      | Array<{ text?: string; onPress?: () => void }>
      | undefined;
    const allowButton = nativeButtons?.find(button => button.text === 'Allow');
    expect(allowButton).toBeTruthy();
    await act(async () => {
      allowButton!.onPress?.();
    });

    const attachedImage = await waitFor(() =>
      view.getByTestId(/^attachment-image-/),
    );
    expect(view.getByTestId('attachments-container')).toBeTruthy();
    const preview = attachedImage.findByType(ReactNative.Image);
    expect(preview.props.source.uri).toMatch(
      /^\/docs\/attachments\/images\/\d+-\d+\.jpg$/,
    );
    expect(preview.props.source.uri).not.toBe(PHOTO_URI);

    view.unmount();
  }, 30000);
});
