/**
 * A film made on the phone, below the UI.
 *
 * SPEC (OGAM): a film is its shots made one by one, in the storyboard's order, then joined into one
 * film that is saved on the phone and shown as a card in its chat. When my image model is drawing the
 * storyboard's stills and I tap Make it real, the film waits for the stills (they share the phone's one
 * engine) and is then made; it never fails with "already running". Stop during that wait stops the
 * film: no clip is made after it. While a film is made, a clip asked for in chat is refused with a reason.
 *
 * Real: the video seam, the film renderer, the video and image services, the stores, Pro activation.
 * Device boundary only: the native image-and-video engine and film composer, the disk, the RAM sensor,
 * the native downloads.
 */
import { GB } from '../../../harness/nativeBoundary';
import { bootPhoneVideo, closePhoneVideo, until, type PhoneVideo } from '../../../harness/phoneVideoServices';

let phone: PhoneVideo | undefined;

afterEach(async () => {
  await closePhoneVideo();
  phone = undefined;
});

const IMAGE_ID = 'phone-sd-pack';

/** An iPhone with Wan 2.1 downloaded and picked; with `stills`, an sd.cpp image pack picked too. */
async function ready(stills = false) {
  phone = await bootPhoneVideo({ ram: { platform: 'ios', totalBytes: 12 * GB, availBytes: 5.9 * GB } });
  await phone.installPack();
  if (stills) {
    // The disk a finished image download leaves: every file of an sd.cpp catalog pack, and its record.
    const { getSDImageModels } = require('../../../../src/services/huggingFaceModelBrowser');
    const { sdImagePackFor } = require('@offgrid/models');
    const template = getSDImageModels().find(
      (model: { fileName: string; huggingFaceFiles?: unknown[] }) => sdImagePackFor(model.fileName) && model.huggingFaceFiles?.length,
    );
    const directory = `${phone.boundary.fs!.DocumentDirectoryPath}/image_models/${IMAGE_ID}`;
    for (const file of template.huggingFaceFiles as Array<{ path: string }>) phone.boundary.fs!.seedFile(`${directory}/${file.path}`, 1024 * 1024);
    const { createONNXImageModel } = require('../../../utils/factories');
    const model = createONNXImageModel({ id: IMAGE_ID, name: 'Phone Image', modelPath: directory, backend: 'sd', size: GB });
    await require('@react-native-async-storage/async-storage').setItem('@local_llm/downloaded_image_models', JSON.stringify([model]));
    // What Home does: list the downloaded image models, then pick one.
    const { modelManager } = require('../../../../src/services/modelManager');
    phone.app().setDownloadedImageModels(await modelManager.getDownloadedImageModels());
    phone.app().setActiveImageModelId(IMAGE_ID);
  }
  const chat = phone.newChat();
  const story = await phone.films.createStory({ sentence: 'a cat chasing a butterfly through a garden', conversationId: chat });
  return { phone, chat, story };
}

const storyOf = (current: PhoneVideo, id: string) => current.studio().stories[id];

it('makes each shot in order, joins them into one saved film, and shows its card in the chat', async () => {
  const { phone, chat, story } = await ready();
  expect(story.shots.length).toBeGreaterThan(1);
  expect(phone.engine.generations).toHaveLength(0);

  await phone.films.startRender(story.id, 'now');
  await until(() => storyOf(phone, story.id)?.state === 'done', 20_000, 'the film');

  const done = storyOf(phone, story.id);
  // Each shot made once, in the storyboard's order.
  expect(phone.engine.generations.map(input => input.prompt)).toEqual(done.shots.map(item => item.prompt));
  const clips = done.shots.map(item => phone.video(item.clipId!)!);
  for (const clip of clips) expect(await phone.onDisk(clip.videoPath)).toBe(true);
  // Joined once, from those clips, in that order.
  expect(phone.engine.films).toHaveLength(1);
  expect(phone.engine.films[0].clips.map(item => item.path)).toEqual(clips.map(clip => clip.videoPath));
  // The film is saved and on the phone, and its card is in the chat.
  const film = phone.video(done.filmId!)!;
  expect(await phone.onDisk(film.videoPath)).toBe(true);
  expect(film.durationSeconds).toBeGreaterThan(0);
  expect(phone.messages(chat).filter(message => message.videoStoryId === story.id)).toHaveLength(1);
  expect(phone.seam.isBusy()).toBe(false);
});

it('Make it real while the stills are drawn waits for them, then makes the film', async () => {
  const { phone, story } = await ready(true);
  phone.engine.holdImages();
  phone.films.makeDraftStills(story.id).catch(() => undefined);
  await until(() => phone.engine.images.length > 0, 10_000, 'a still being drawn');

  await phone.films.startRender(story.id, 'now');
  // Waiting: the film is on its way, but no clip asks the busy engine.
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(storyOf(phone, story.id).state).toBe('rendering');
  expect(phone.seam.isBusy()).toBe(true);
  expect(phone.engine.generations).toHaveLength(0);

  phone.engine.releaseImages();
  await until(() => ['done', 'failed'].includes(storyOf(phone, story.id)?.state), 20_000, 'the film');
  const done = storyOf(phone, story.id);
  expect(done.error).toBeUndefined();
  expect(done.state).toBe('done');
  // Every still was drawn, then every shot made, then joined.
  expect(phone.engine.images).toHaveLength(done.shots.length);
  expect(phone.engine.generations).toHaveLength(done.shots.length);
  expect(phone.engine.films).toHaveLength(1);
});

describe.each([
  ["the chat's Stop", (current: PhoneVideo) => current.seam.cancel()],
  ["the film's own Stop", (current: PhoneVideo, storyId: string) => current.films.stopRender(storyId)],
])('%s while the film waits for its stills', (_name, stop) => {
  it('stops the film: no clip is made after it', async () => {
    const { phone, story } = await ready(true);
    phone.engine.holdImages();
    phone.films.makeDraftStills(story.id).catch(() => undefined);
    await until(() => phone.engine.images.length > 0, 10_000, 'a still being drawn');
    await phone.films.startRender(story.id, 'now');
    expect(storyOf(phone, story.id).state).toBe('rendering');

    await stop(phone, story.id);
    expect(storyOf(phone, story.id).state).toBe('draft');

    phone.engine.releaseImages();
    await until(() => storyOf(phone, story.id).shots.every(item => !!item.stillPath), 10_000, 'the stills to finish');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(phone.engine.generations).toHaveLength(0);
    expect(phone.engine.films).toHaveLength(0);
    expect(storyOf(phone, story.id).state).toBe('draft');
  });
});

it('a clip asked for in chat while a film is made is refused with a reason', async () => {
  const { phone, chat, story } = await ready();
  phone.engine.hold();
  await phone.films.startRender(story.id, 'now');
  await until(() => phone.engine.generations.length === 1, 10_000, 'the first shot');

  await expect(phone.seam.generate({ prompt: 'a dog on a skateboard', conversationId: chat })).rejects.toThrow(/film/i);
  expect(phone.engine.generations).toHaveLength(1);

  phone.engine.release();
  await until(() => storyOf(phone, story.id)?.state === 'done', 20_000, 'the film');
  expect(phone.engine.generations.map(input => input.prompt)).not.toContain('a dog on a skateboard');
});
