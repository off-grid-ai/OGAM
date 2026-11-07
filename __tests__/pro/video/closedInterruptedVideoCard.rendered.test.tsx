/**
 * Closing the card of a video cut off by an app restart lets that video go.
 *
 * SPEC (OGAM user's view): a clip the app was making when it closed shows "Video generation
 * interrupted" at the next launch. If I close that card, it does not come back at the next launch.
 * If I press Retry instead, the same clip is tried again. When the app itself clears the card (a new
 * clip starts), the interrupted clip is still kept.
 *
 * The real video service, the real failure store and the real ModelFailureCard run. Device boundaries
 * only: AsyncStorage (jest's in-memory store), the file system and the native video module (absent, as
 * in jest.setup).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CATALOG } from '@offgrid/models';
import { ModelFailureCard } from '../../../src/components/ModelFailureCard';
import { useModelFailureStore } from '../../../src/stores/modelFailureStore';
import { useAppStore } from '../../../src/stores';
import { clearModelFailure } from '../../../src/services/modelFailureHandler';
import { videoGenerationService } from '@offgrid/pro/video/videoGenerationService';

/** Where the video service keeps the clip it is making (videoGenerationService.ts). */
const JOURNAL_KEY = 'offgrid.video.active-job.v1';
const MODEL = CATALOG.find((model: { id: string }) => model.id === 'off-grid-ai/Wan2.1-T2V-1.3B-GGUF')!;

/** What the service left on disk when the app closed mid-clip, made on this phone. */
const interruptedJournal = () => ({
  input: { model: MODEL.id, prompt: 'a paper boat drifting on a pond' },
  id: 'clip-interrupted-1',
  messageId: 'message-interrupted-1',
  startedAt: Date.now() - 60_000,
});

const storedJournal = () => AsyncStorage.getItem(JOURNAL_KEY);

/** The app opens: the service restores what it left, and the card shows what it reports. */
async function launch() {
  await act(async () => { await videoGenerationService.restore(); });
  return render(<ModelFailureCard />);
}

beforeEach(async () => {
  await videoGenerationService.whenIdle();
  useModelFailureStore.getState().clear();
  useAppStore.setState({ downloadedVideoModels: [], generatedVideos: [] });
  await AsyncStorage.clear();
  await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(interruptedJournal()));
});

it('a closed card lets the interrupted clip go, so the next launch shows no card', async () => {
  const first = await launch();
  expect(first.getByText('Video generation interrupted')).toBeTruthy();
  expect(first.getByText('The app closed before the clip was done.')).toBeTruthy();

  fireEvent.press(first.getByTestId('model-failure-dismiss-video'));
  expect(first.queryByTestId('model-failure-video')).toBeNull();
  await waitFor(async () => expect(await storedJournal()).toBeNull());
  first.unmount();

  const next = await launch();
  expect(next.queryByTestId('model-failure-video')).toBeNull();
  expect(useModelFailureStore.getState().failures).toEqual([]);
});

it('Retry, with the card left open, tries the same clip again', async () => {
  // The clip's model is on this phone; its files are not, so the retry fails on the phone's own reason.
  useAppStore.setState({ downloadedVideoModels: [{ ...MODEL, kind: 'video' } as never] });
  const view = await launch();
  expect(view.getByText('The app closed before the clip was done.')).toBeTruthy();

  fireEvent.press(view.getByTestId('model-failure-retry-video'));
  await act(async () => { await videoGenerationService.whenIdle(); });

  // The same clip ran again on its model, and the card now says why that run stopped. The clip is kept
  // for another Retry.
  await waitFor(() =>
    expect(view.getByTestId('model-failure-video')).toHaveTextContent(/Video model file is incomplete: Wan2\.1-T2V-1\.3B-Q8_0\.gguf/),
  );
  expect(view.queryByText('The app closed before the clip was done.')).toBeNull();
  expect(JSON.parse((await storedJournal())!).id).toBe('clip-interrupted-1');
});

it('the app clearing the card keeps the interrupted clip, so it is reported again at launch', async () => {
  const first = await launch();
  expect(first.getByText('Video generation interrupted')).toBeTruthy();

  act(() => { clearModelFailure('video'); });
  expect(first.queryByTestId('model-failure-video')).toBeNull();
  expect(JSON.parse((await storedJournal())!).id).toBe('clip-interrupted-1');
  first.unmount();

  const next = await launch();
  expect(next.getByText('Video generation interrupted')).toBeTruthy();
});

it('closing the card while that clip is running again keeps the clip', async () => {
  useAppStore.setState({ downloadedVideoModels: [{ ...MODEL, kind: 'video' } as never] });
  const view = await launch();

  // The clip starts again (the chat's own retry) and the card is closed before the run clears it.
  let running!: Promise<unknown>;
  act(() => { running = videoGenerationService.retry().catch(() => undefined); });
  fireEvent.press(view.getByTestId('model-failure-dismiss-video'));
  await act(async () => { await running; });

  // The run went on with the same clip, and the clip is kept for Retry.
  await waitFor(() =>
    expect(view.getByTestId('model-failure-video')).toHaveTextContent(/Video model file is incomplete/),
  );
  expect(JSON.parse((await storedJournal())!).id).toBe('clip-interrupted-1');
});

it('a phone that cannot write its storage still closes the card', async () => {
  const view = await launch();
  const removeItem = jest.spyOn(AsyncStorage, 'removeItem').mockRejectedValueOnce(new Error('disk full'));

  fireEvent.press(view.getByTestId('model-failure-dismiss-video'));
  await act(async () => { await Promise.resolve(); });

  expect(view.queryByTestId('model-failure-video')).toBeNull();
  // The write failed, so the clip is still on disk: nothing was lost that the phone could not drop.
  expect(JSON.parse((await storedJournal())!).id).toBe('clip-interrupted-1');
  removeItem.mockRestore();
});
