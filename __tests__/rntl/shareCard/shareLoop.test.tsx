/**
 * The share loop: an image or a reply goes to the system share sheet as a picture with the Off Grid AI
 * mark, and the plain download link in the text.
 *
 * Boundaries: the native capture (react-native-view-shot), the OS share sheet (Share on iOS,
 * MediaShareModule on Android) and the disk (RNFS). The service, the host that draws the card and the
 * message menu run for real.
 */
import React from 'react';
import { Image, NativeModules, Platform, Share } from 'react-native';
import RNFS from 'react-native-fs';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ShareCardHost } from '../../../src/components/ShareCard/ShareCardHost';
import { ChatMessage } from '../../../src/components/ChatMessage';
import * as shareCard from '../../../src/services/shareCard';
import { createAssistantMessage, createUserMessage } from '../../utils/factories';

const mockCapture = jest.fn(async () => 'file:///tmp/ReactNative/capture.png');
jest.mock('react-native-view-shot', () => {
  const ReactLib = require('react');
  const ViewShot = ReactLib.forwardRef(({ children }: { children: React.ReactNode }, ref: React.Ref<unknown>) => {
    ReactLib.useImperativeHandle(ref, () => ({ capture: mockCapture }));
    return children;
  });
  return { __esModule: true, default: ViewShot };
});

const setOS = (os: 'ios' | 'android') => { Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true }); };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  NativeModules.MediaShareModule = { shareFile: jest.fn(), shareFileWithText: jest.fn(async () => true) };
  jest.spyOn(Image, 'getSize').mockImplementation((_uri, ok) => ok(1024, 768));
  setOS('ios');
});

/** The host draws the card; a reply card captures on layout, an image card once its image loads. */
async function drawn(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(() => expect(view.getByTestId('share-card', { includeHiddenElements: true })).toBeTruthy());
  const image = view.queryByTestId('share-card-image', { includeHiddenElements: true });
  const reply = view.queryByTestId('share-card-reply', { includeHiddenElements: true });
  await act(async () => {
    if (image) fireEvent(image, 'load');
    else if (reply) fireEvent(view.getByTestId('share-card-reply-box', { includeHiddenElements: true }), 'layout', { nativeEvent: { layout: { width: 360, height: 200 } } });
    await new Promise(resolve => setTimeout(resolve, 30));
  });
}

describe('share text', () => {
  it('is the mark, then the plain download link: no tags, no tracking', () => {
    expect(shareCard.shareText()).toBe('Made offline on my phone · Off Grid AI\nhttps://getoffgridai.co/download');
    expect(shareCard.shareText()).not.toMatch(/utm_|\?/);
  });

  it('a long reply ends with an ellipsis at a word; a short one stays whole', () => {
    expect(shareCard.replyCardText('  Hello there  ')).toBe('Hello there');
    const long = 'word '.repeat(300);
    const card = shareCard.replyCardText(long);
    expect(card.length).toBeLessThanOrEqual(shareCard.REPLY_CARD_MAX_CHARS + 1);
    expect(card.endsWith('word…')).toBe(true);
    const noSpaces = 'x'.repeat(900);
    expect(shareCard.replyCardText(noSpaces)).toBe(`${'x'.repeat(shareCard.REPLY_CARD_MAX_CHARS)}…`);
  });

  it('before the host is on screen, sharing says it is not ready', async () => {
    shareCard.registerShareCardRenderer(null);
    await expect(shareCard.shareReplyCard('hi')).rejects.toThrow('not ready');
  });
});

describe('ShareCardHost', () => {
  it('iOS: a reply becomes a card with the mark, shared with the link', async () => {
    const view = render(<ShareCardHost />);
    const shared = shareCard.shareReplyCard('The capital of France is Paris.');
    // The card holds the reply and the mark.
    await waitFor(() => expect(view.getByText('The capital of France is Paris.', { includeHiddenElements: true })).toBeTruthy());
    expect(view.getByText('Made offline on my phone · Off Grid AI', { includeHiddenElements: true })).toBeTruthy();
    await drawn(view);
    await shared;
    expect(Share.share).toHaveBeenCalledWith({
      url: expect.stringMatching(/^file:\/\/.*\/share-cards\/off-grid-ai-\d+\.png$/),
      message: 'Made offline on my phone · Off Grid AI\nhttps://getoffgridai.co/download',
    });
    expect(RNFS.moveFile).toHaveBeenCalledWith('/tmp/ReactNative/capture.png', expect.stringContaining('/share-cards/'));
    expect(view.queryByTestId('share-card', { includeHiddenElements: true })).toBeNull();
  });

  it('Android: an image you made goes through the app share module with the link beside it', async () => {
    setOS('android');
    const view = render(<ShareCardHost />);
    const shared = shareCard.shareMarkedImage('/mock/documents/generated_images/fox.png');
    await drawn(view);
    await shared;
    expect(NativeModules.MediaShareModule.shareFileWithText).toHaveBeenCalledWith(
      expect.stringContaining('/share-cards/'), 'image/png', shareCard.shareText());
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('an image it cannot read fails the share instead of hanging', async () => {
    (Image.getSize as jest.Mock).mockImplementation((_uri, _ok, fail) => fail(new Error('gone')));
    render(<ShareCardHost />);
    await expect(shareCard.shareMarkedImage('/mock/documents/missing.png')).rejects.toThrow('could not be read');
  });

  it('a capture that fails fails the share', async () => {
    mockCapture.mockRejectedValueOnce(new Error('no surface'));
    const view = render(<ShareCardHost />);
    const failed = expect(shareCard.shareReplyCard('hi')).rejects.toThrow('no surface');
    await drawn(view);
    await failed;
  });

  it('a capture that fails with a bare reason still fails the share with that reason', async () => {
    mockCapture.mockRejectedValueOnce('busy');
    const view = render(<ShareCardHost />);
    const failed = expect(shareCard.shareReplyCard('hi')).rejects.toThrow('busy');
    await drawn(view);
    await failed;
  });

  it('the first share makes the folder (no old folder to clear)', async () => {
    (RNFS.unlink as jest.Mock).mockRejectedValueOnce(new Error('no such folder'));
    const view = render(<ShareCardHost />);
    const shared = shareCard.shareReplyCard('hi');
    await drawn(view);
    await shared;
    expect(RNFS.mkdir).toHaveBeenCalledWith(expect.stringContaining('/share-cards'));
  });

  it('unmounting it stops sharing (no card can be drawn)', async () => {
    const view = render(<ShareCardHost />);
    view.unmount();
    await expect(shareCard.shareReplyCard('hi')).rejects.toThrow('not ready');
  });
});

describe('Share as card in the message menu', () => {
  it('an assistant reply offers it, and it shares that reply as a card; Copy stays', async () => {
    const view = render(<><ShareCardHost /><ChatMessage message={createAssistantMessage('A clear answer.')} /></>);
    fireEvent(view.getByTestId('assistant-message'), 'longPress');
    expect(view.getByTestId('action-copy')).toBeTruthy();
    fireEvent.press(view.getByTestId('action-share-card'));
    await waitFor(() => expect(view.getByTestId('share-card-reply', { includeHiddenElements: true })).toHaveTextContent('A clear answer.'));
    await drawn(view);
    await waitFor(() => expect(Share.share).toHaveBeenCalledWith({
      url: expect.stringMatching(/\/share-cards\/off-grid-ai-\d+\.png$/),
      message: shareCard.shareText(),
    }));
  });

  it('a failed card says so, and points at Copy', async () => {
    mockCapture.mockRejectedValueOnce(new Error('no surface'));
    const view = render(<><ShareCardHost /><ChatMessage message={createAssistantMessage('Answer.')} /></>);
    fireEvent(view.getByTestId('assistant-message'), 'longPress');
    fireEvent.press(view.getByTestId('action-share-card'));
    await drawn(view);
    await waitFor(() => expect(view.getByText('The card could not be made. Copy still works.')).toBeTruthy());
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('your own message does not offer it', () => {
    const view = render(<ChatMessage message={createUserMessage('my question')} />);
    fireEvent(view.getByTestId('user-message'), 'longPress');
    expect(view.queryByTestId('action-share-card')).toBeNull();
  });
});
