/**
 * Keeping a person in every shot, and deleting what was made, below the UI.
 *
 * SPEC (OGAM): a person kept in a film needs my yes that the photos are of me or of people who agreed;
 * without it the film does not start and I am told why, and nothing is made. With it, every shot of a
 * film made on the phone describes that person (the phone's model starts from words, so the person's
 * name and look go into each shot; the computer gets their photos, covered by the rendered test).
 * A photo a clip starts from needs the same yes.
 *
 * Deleting a clip removes its file and takes it out of its chat. Deleting a film removes the film, its
 * shots' clips, its working files and its card in the chat, and stops it first if it is being made.
 * Cancelling a video model download removes every file it put on the phone; while the first file is
 * still downloading, its bytes are already counted (so Cancel asks first, see the rendered test).
 *
 * Real: the video seam, the film renderer, the video services, the download provider, the stores.
 * Device boundary only: the native video engine and film composer, the disk, the RAM sensor, the
 * native downloads.
 */
import { bootPhoneVideo, closePhoneVideo, until, WAN, type PhoneVideo } from '../../../harness/phoneVideoServices';

let phone: PhoneVideo | undefined;

afterEach(async () => {
  await closePhoneVideo();
  phone = undefined;
});

async function ready() {
  phone = await bootPhoneVideo();
  await phone.installPack();
  const chat = phone.newChat();
  return { phone, chat };
}

/** A person kept in the story, as the character screen saves one: a name, a look, a photo on the phone. */
function keepPerson(current: PhoneVideo, storyId: string, consent: boolean) {
  const photo = `${current.boundary.fs!.DocumentDirectoryPath}/video-studio/people/mia.jpg`;
  current.boundary.fs!.seedFile(photo, 2048);
  current.studio().putCharacter({
    id: 'mia',
    name: 'Mia',
    look: 'a girl in a yellow raincoat',
    photoPaths: [photo],
    ...(consent ? { consentAt: Date.now() } : {}),
    createdAt: Date.now(),
  });
  current.studio().patchStory(storyId, { characterId: 'mia' });
}

describe('a person in every shot', () => {
  it('without the yes for their photos, the film does not start, says why, and nothing is made', async () => {
    const { phone, chat } = await ready();
    const story = await phone.films.createStory({ sentence: 'a girl flying a kite on a windy beach', conversationId: chat });
    keepPerson(phone, story.id, false);

    await expect(phone.films.startRender(story.id, 'now')).rejects.toThrow(/consent|permission|agree/i);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(phone.engine.generations).toHaveLength(0);
    expect(phone.studio().stories[story.id].state).toBe('draft');
    expect(phone.seam.isBusy()).toBe(false);
  });

  it('with the yes, every shot made on the phone describes that person', async () => {
    const { phone, chat } = await ready();
    const story = await phone.films.createStory({ sentence: 'a girl flying a kite on a windy beach', conversationId: chat });
    keepPerson(phone, story.id, true);

    await phone.films.startRender(story.id, 'now');
    await until(() => phone.studio().stories[story.id]?.state === 'done', 20_000, 'the film');
    expect(phone.engine.generations).toHaveLength(story.shots.length);
    for (const input of phone.engine.generations) {
      expect(input.prompt).toContain('Mia');
      expect(input.prompt).toContain('a girl in a yellow raincoat');
    }
  });

  it('a clip that starts from a person\'s photo without their yes is refused, and nothing is made', async () => {
    const { phone, chat } = await ready();
    const { startClip } = require('../../../../pro/video/studio/clips');
    const photo = `${phone.boundary.fs!.DocumentDirectoryPath}/photo.jpg`;
    phone.boundary.fs!.seedFile(photo, 2048);

    await expect(
      startClip({ prompt: 'she waves at the camera', conversationId: chat, initImagePath: photo, initImageSource: 'photo', initImageConsent: false }),
    ).rejects.toThrow();
    expect(phone.engine.generations).toHaveLength(0);
    // Nothing is left behind: no draft, no card in the chat.
    expect(Object.keys(phone.studio().stories)).toHaveLength(0);
    expect(phone.messages(chat)).toHaveLength(0);
  });
});

describe('delete', () => {
  it('deleting a clip removes its file and takes it out of its chat', async () => {
    const { phone, chat } = await ready();
    const clip = (await phone.seam.generate({ prompt: 'a red kite in the wind', conversationId: chat })) as { id: string; videoPath: string };
    expect(await phone.onDisk(clip.videoPath)).toBe(true);
    expect(phone.messages(chat).some(message => message.attachments?.some(item => item.id === clip.id))).toBe(true);

    const { deleteGeneratedVideo } = require('../../../../src/services/generatedVideoFiles');
    await deleteGeneratedVideo(clip.id);

    expect(await phone.onDisk(clip.videoPath)).toBe(false);
    expect(phone.video(clip.id)).toBeUndefined();
    expect(phone.messages(chat).some(message => message.attachments?.some(item => item.id === clip.id))).toBe(false);
  });

  it('deleting a film removes the film, its clips and its card in the chat', async () => {
    const { phone, chat } = await ready();
    const story = await phone.films.createStory({ sentence: 'a cat chasing a butterfly', conversationId: chat });
    await phone.films.startRender(story.id, 'now');
    await until(() => phone.studio().stories[story.id]?.state === 'done', 20_000, 'the film');
    const done = phone.studio().stories[story.id];
    const made = [...done.shots.map(item => phone.video(item.clipId!)!), phone.video(done.filmId!)!];
    for (const video of made) expect(await phone.onDisk(video.videoPath)).toBe(true);
    expect(phone.messages(chat).some(message => message.videoStoryId === story.id)).toBe(true);

    await phone.films.deleteFilm(story.id);

    for (const video of made) {
      expect(await phone.onDisk(video.videoPath)).toBe(false);
      expect(phone.video(video.id)).toBeUndefined();
    }
    expect(phone.messages(chat).some(message => message.videoStoryId === story.id)).toBe(false);
    expect(phone.studio().stories[story.id]).toBeUndefined();
  });

  it('deleting a film while it is made stops it first, and nothing of it is left', async () => {
    const { phone, chat } = await ready();
    const story = await phone.films.createStory({ sentence: 'a dog running on a beach', conversationId: chat });
    phone.engine.hold();
    await phone.films.startRender(story.id, 'now');
    await until(() => phone.engine.generations.length === 1, 10_000, 'the first shot');
    expect(phone.seam.isBusy()).toBe(true);

    await phone.films.deleteFilm(story.id);
    await phone.service.whenIdle();

    expect(phone.seam.isBusy()).toBe(false);
    expect(phone.studio().stories[story.id]).toBeUndefined();
    expect(phone.app().generatedVideos).toHaveLength(0);
    expect(phone.messages(chat).some(message => message.videoStoryId === story.id)).toBe(false);
    expect(phone.engine.films).toHaveLength(0);
  });

  it('cancelling a video model download removes every file it put on the phone', async () => {
    phone = await bootPhoneVideo();
    const current = phone;
    const { CATALOG } = require('@offgrid/models');
    const model = CATALOG.find((entry: { id: string }) => entry.id === WAN);
    const { videoModelDirectory } = require('../../../../src/services/videoModelFiles');
    const directory = videoModelDirectory(WAN);
    const { phoneDownloads } = require('../../../harness/nativeVideoEngine');
    const downloads = phoneDownloads(current.boundary, async (work: () => Promise<void>) => work());
    current.provider.start!({ modelType: 'video', model } as never).catch(() => undefined);

    // The first file is still downloading: its bytes so far already count, though the folder is empty.
    await until(() => current.boundary.download!.active().some(row => row.status === 'running'), 10_000, 'the first file to start');
    const row = current.boundary.download!.active().find(item => item.status === 'running')!;
    current.boundary.download!.events.emit('DownloadProgress', {
      downloadId: row.downloadId,
      bytesDownloaded: 278 * 1024 * 1024,
      totalBytes: model.files[0].sizeBytes,
      status: 'running',
    });
    await until(async () => ((await current.provider.list()).find(item => item.id === `video:${WAN}`)?.bytesDownloaded ?? 0) > 0, 5000, 'the bytes so far');

    // Then the first file lands, and the second is under way.
    await until(async () => (await downloads.finishRunning()) === 1, 10_000, 'the first file');
    await until(() => current.boundary.fs!.listFiles(directory).length > 0, 5000, 'the first file on the phone');

    await current.provider.cancel(`video:${WAN}`);

    expect(await current.onDisk(directory)).toBe(false);
    expect(current.app().downloadedVideoModels).toHaveLength(0);
    expect((await current.provider.list()).find(item => item.id === `video:${WAN}`)).toBeUndefined();
    // The file that was downloading is stopped on the phone too.
    expect(current.boundary.download!.active().some(item => item.modelKey?.endsWith(model.files[1].name))).toBe(false);
  });
});
