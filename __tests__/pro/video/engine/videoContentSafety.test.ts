/**
 * Video content safety on the phone (Google Play AI-Generated Content policy), the same rules as images.
 *
 * SPEC (OGAM): a clip described with sexual or nude words is refused before any model runs, and says
 * why. Every finished clip is checked on the phone, frame by frame, before it reaches the chat or the
 * library; a clip the check marks is deleted and the card says it was not made, with no Retry. A safe
 * clip lands as before.
 *
 * Real: the video seam, the video services, the content safety service, the stores, Pro activation.
 * Device boundary only: the native video engine and film composer, the disk, the RAM sensor, the
 * native downloads, and the executorch classifier (jest.setup, scored via globalThis.__nsfwClassifier).
 */
import { bootPhoneVideo, closePhoneVideo, type PhoneVideo } from '../../../harness/phoneVideoServices';
import { BLOCKED_VIDEO_MESSAGE, BLOCKED_VIDEO_PROMPT_MESSAGE } from '../../../../src/services/contentSafety';

type Classifier = { nsfw?: number; classified: string[]; loadedFrom: string[] };

afterEach(() => {
  delete (globalThis as { __nsfwClassifier?: Classifier }).__nsfwClassifier;
  return closePhoneVideo();
});

async function ready(nsfw: number): Promise<{ phone: PhoneVideo; chat: string; classifier: Classifier }> {
  const classifier: Classifier = { nsfw, classified: [], loadedFrom: [] };
  (globalThis as { __nsfwClassifier?: Classifier }).__nsfwClassifier = classifier;
  const phone = await bootPhoneVideo();
  await phone.installPack();
  return { phone, chat: phone.newChat(), classifier };
}

it('refuses a sexual description before the video model runs', async () => {
  const { phone, chat } = await ready(0);
  await expect(phone.seam.generate({ prompt: 'a n4ked woman dancing', conversationId: chat })).rejects.toThrow(
    BLOCKED_VIDEO_PROMPT_MESSAGE,
  );
  expect(phone.engine.generations).toHaveLength(0);
  expect(phone.app().generatedVideos).toHaveLength(0);
});

it('refuses when the style words add a blocked word, before the engine runs', async () => {
  const { phone, chat } = await ready(0);
  await expect(
    phone.service.generate({ prompt: 'a portrait', styleWords: 'nsfw, detailed', conversationId: chat }),
  ).rejects.toThrow(BLOCKED_VIDEO_PROMPT_MESSAGE);
  expect(phone.engine.generations).toHaveLength(0);
  expect(phone.failure()).toMatchObject({ title: 'Video not made' });
  expect(phone.failure()!.onRetry).toBeUndefined();
});

it('deletes a clip the classifier marks, publishes nothing, and offers no Retry', async () => {
  const { phone, chat, classifier } = await ready(0.92);
  await expect(phone.seam.generate({ prompt: 'a person on a beach', conversationId: chat })).rejects.toThrow(
    BLOCKED_VIDEO_MESSAGE,
  );
  const output = String(phone.engine.generations[0].outputPath);
  expect(classifier.classified.length).toBeGreaterThanOrEqual(1);
  expect(await phone.onDisk(output)).toBe(false);
  expect(phone.app().generatedVideos).toHaveLength(0);
  expect(phone.messages(chat).some(message => message.attachments?.some(item => item.type === 'video'))).toBe(false);
  expect(phone.failure()).toMatchObject({ title: 'Video not made', message: BLOCKED_VIDEO_MESSAGE });
  expect(phone.failure()!.onRetry).toBeUndefined();
});

it('checks the start, middle and end of a safe clip, then publishes it as before', async () => {
  const { phone, chat, classifier } = await ready(0.03);
  const clip = (await phone.seam.generate({ prompt: 'a hummingbird over a red flower', conversationId: chat })) as { id: string };
  const saved = phone.video(clip.id)!;
  expect(phone.engine.frameReads).toEqual([
    { videoPath: saved.videoPath, fraction: 0.1 },
    { videoPath: saved.videoPath, fraction: 0.5 },
    { videoPath: saved.videoPath, fraction: 0.9 },
  ]);
  expect(classifier.classified).toHaveLength(3);
  expect(await phone.onDisk(saved.videoPath)).toBe(true);
  expect(phone.failure()).toBeUndefined();
});

it('blocks the clip when a frame cannot be read', async () => {
  const { phone, chat } = await ready(0.03);
  const RN = require('react-native');
  RN.NativeModules.OffgridFilm.frameAt = async () => {
    throw Object.assign(new Error('The operation could not be completed.'), { code: 'FILM_FRAME' });
  };
  await expect(phone.seam.generate({ prompt: 'a lighthouse at dusk', conversationId: chat })).rejects.toThrow(
    BLOCKED_VIDEO_MESSAGE,
  );
  expect(phone.app().generatedVideos).toHaveLength(0);
});
