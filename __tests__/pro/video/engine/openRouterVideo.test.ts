/**
 * Video made on OpenRouter, below the UI.
 *
 * SPEC (OGAM): I add OpenRouter with my key. Its video models list under Video and its chat models
 * under Text. With an OpenRouter video model picked, a clip I ask for in a chat is made there: sent
 * once, silent, at a length the model offers; the phone waits for it, saves the MP4 and shows it in
 * the chat. The phone's own engine does nothing. Stop ends it quietly and the next clip works. A clip
 * OpenRouter could not make says why, and Retry makes it. A start picture goes as the first frame; a
 * model that cannot start from a picture is refused by name before anything is sent. A film is made
 * there shot by shot, in storyboard order, and the phone joins the shots into one saved film; it says
 * where it is made: "On OpenRouter".
 *
 * Real: the server discovery, the remote server manager and stores, the video seam and services, the
 * film renderer, Pro activation. Device boundary only: OpenRouter at fetch and the RNFS download, the
 * Keychain, the native video engine and film composer, the disk, the RAM sensor.
 */
import { bootPhoneVideo, closePhoneVideo, until, type PhoneVideo } from '../../../harness/phoneVideoServices';
import {
  OPENROUTER_ASPECTS,
  OPENROUTER_DURATIONS,
  OPENROUTER_ENDPOINT,
  OPENROUTER_KEY,
  OPENROUTER_TEXT_MODEL,
  OPENROUTER_VIDEO_MODEL,
  OPENROUTER_WORDS_ONLY_VIDEO_MODEL,
  serveOpenRouterVideo,
  type OpenRouterVideoJobs,
} from '../../../harness/openRouterVideoServer';

jest.mock('react-native-keychain', () => require('../../../harness/keyedRemoteServer').keychainModule());

// OpenRouter is polled every 3 s (its own pace), so each clip takes at least one real poll.
jest.setTimeout(90_000);

let openRouter: OpenRouterVideoJobs | undefined;

afterEach(async () => {
  await closePhoneVideo();
  openRouter?.restore();
  openRouter = undefined;
  require('../../../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
});

type Server = { id: string; name: string; modelCatalog?: Record<string, Array<{ id: string }>> };

/** What the server editor does: test the address with the key, save the server, check it once more. */
async function addOpenRouter(): Promise<Server> {
  const { remoteServerManager } = require('../../../../src/services/remoteServerManager');
  const { useRemoteServerStore } = require('../../../../src/stores/remoteServerStore');
  const found = await remoteServerManager.testConnectionByEndpoint(OPENROUTER_ENDPOINT, OPENROUTER_KEY);
  expect(found.success).toBe(true);
  const server = await remoteServerManager.addServer({
    name: 'OpenRouter',
    endpoint: OPENROUTER_ENDPOINT,
    providerType: 'openai-compatible',
    apiKey: OPENROUTER_KEY,
    mediaModels: {},
    modelCatalog: found.modelCatalog,
  });
  useRemoteServerStore.getState().setDiscoveredModels(
    server.id,
    (found.models ?? []).map((model: { id: string }) => ({ ...model, serverId: server.id })),
  );
  await remoteServerManager.testConnection(server.id).catch(() => undefined);
  return useRemoteServerStore.getState().getServerById(server.id);
}

/** What the remote-model picker under Video does when a row is tapped. */
async function pickVideoModel(server: Server, modelId: string): Promise<void> {
  const { remoteServerManager } = require('../../../../src/services/remoteServerManager');
  await remoteServerManager.setActiveRemoteMediaModel(server.id, 'video', modelId);
}

async function ready(options: { localPack?: boolean } = {}): Promise<{ phone: PhoneVideo; server: Server; chat: string }> {
  const phone = await bootPhoneVideo();
  // A video model on the phone too, so the clip going to OpenRouter is the choice, not the only way.
  if (options.localPack) await phone.installPack();
  openRouter = serveOpenRouterVideo(phone.boundary.fs!);
  const server = await addOpenRouter();
  await pickVideoModel(server, OPENROUTER_VIDEO_MODEL.id);
  return { phone, server, chat: phone.newChat() };
}

const withClip = (phone: PhoneVideo, chat: string, id: string) =>
  phone.messages(chat).filter(message => message.attachments?.some(item => item.id === id));

it('adding OpenRouter lists its video models under video and its chat model under text', async () => {
  const phone = await bootPhoneVideo();
  openRouter = serveOpenRouterVideo(phone.boundary.fs!);
  const server = await addOpenRouter();

  expect(server.modelCatalog?.video?.map(model => model.id)).toEqual([
    OPENROUTER_VIDEO_MODEL.id,
    OPENROUTER_WORDS_ONLY_VIDEO_MODEL.id,
  ]);
  expect(server.modelCatalog?.text?.map(model => model.id)).toEqual([OPENROUTER_TEXT_MODEL.id]);
  // A video model is never offered as a chat model.
  const { useRemoteServerStore } = require('../../../../src/stores/remoteServerStore');
  const chatModels = useRemoteServerStore.getState().discoveredModels[server.id].map((model: { id: string }) => model.id);
  expect(chatModels).toEqual([OPENROUTER_TEXT_MODEL.id]);
});

it('a chat clip is made on OpenRouter: sent once, silent, at a length it offers, then saved and shown', async () => {
  const { phone, chat } = await ready({ localPack: true });

  const clip = (await phone.seam.generate({ prompt: 'a hummingbird over a red flower', conversationId: chat })) as { id: string };

  // Sent once, with the picked model, a length and shape the model offers, and no sound.
  expect(openRouter!.submissions).toHaveLength(1);
  const sent = openRouter!.submissions[0];
  expect(sent).toMatchObject({ model: OPENROUTER_VIDEO_MODEL.id, prompt: 'a hummingbird over a red flower', generate_audio: false });
  expect(OPENROUTER_DURATIONS).toContain(sent.duration);
  expect(OPENROUTER_ASPECTS).toContain(sent.aspect_ratio);
  expect(sent.frame_images).toBeUndefined();
  // The phone waited for the job to finish before it downloaded it.
  expect(openRouter!.polls.length).toBeGreaterThanOrEqual(1);

  // Saved: the downloaded MP4 is on the phone, with the length OpenRouter made.
  const saved = phone.video(clip.id)!;
  expect(saved).toBeDefined();
  expect(await phone.onDisk(saved.videoPath)).toBe(true);
  expect(await phone.boundary.fs!.readAscii(saved.videoPath, 9)).toBe('mp4-bytes');
  // The download carries the key: OpenRouter's content URL needs it.
  const download = phone.boundary.fs!.module.downloadFile.mock.calls.find(
    ([request]) => String((request as { toFile?: string })?.toFile) === saved.videoPath,
  )?.[0] as { headers?: Record<string, string> } | undefined;
  expect(download?.headers?.Authorization).toBe(`Bearer ${OPENROUTER_KEY}`);
  expect(saved.durationSeconds).toBe(sent.duration);

  // In the chat, once; the phone's own engine made nothing.
  expect(withClip(phone, chat, saved.id)).toHaveLength(1);
  expect(phone.engine.generations).toHaveLength(0);
  expect(phone.service.getState().phase).toBe('succeeded');
  expect(phone.seam.isBusy()).toBe(false);
  expect(phone.failure()).toBeUndefined();
});

it('Stop while OpenRouter makes the clip ends it with no clip and no error, and the next clip works', async () => {
  const { phone, chat } = await ready();
  openRouter!.hold();
  const making = phone.seam.generate({ prompt: 'waves rolling onto a beach', conversationId: chat });
  await until(() => openRouter!.submissions.length === 1 && phone.service.getState().stage === 'generating', 10_000, 'the job on OpenRouter');
  expect(phone.seam.isBusy()).toBe(true);

  await phone.seam.cancel();

  await expect(making).resolves.toBeUndefined();
  expect(phone.service.getState().phase).toBe('cancelled');
  expect(phone.failure()).toBeUndefined();
  expect(phone.app().generatedVideos).toHaveLength(0);
  expect(phone.messages(chat).some(message => message.attachments?.some(item => item.type === 'video'))).toBe(false);
  expect(phone.seam.isBusy()).toBe(false);

  openRouter!.release();
  const next = (await phone.seam.generate({ prompt: 'a lighthouse at dusk', conversationId: chat })) as { id: string };
  expect(phone.video(next.id)).toBeDefined();
  expect(openRouter!.submissions).toHaveLength(2);
  expect(withClip(phone, chat, next.id)).toHaveLength(1);
});

it('a clip OpenRouter could not make says why, and Retry makes it', async () => {
  const { phone, chat } = await ready();
  const reason = 'Content policy violation';
  openRouter!.hold();
  const making = phone.seam.generate({ prompt: 'a fox in the snow', conversationId: chat });
  await until(() => openRouter!.submissions.length === 1, 10_000, 'the job on OpenRouter');
  openRouter!.failRunning(reason);
  openRouter!.release();

  await expect(making).rejects.toThrow(reason);
  expect(phone.service.getState()).toMatchObject({ phase: 'failed', error: reason });
  expect(phone.app().generatedVideos).toHaveLength(0);
  expect(phone.seam.isBusy()).toBe(false);
  const card = phone.failure()!;
  expect(card.message).toContain(reason);
  expect(card.onRetry).toEqual(expect.any(Function));

  card.onRetry!();
  await until(() => phone.service.getState().phase === 'succeeded', 20_000, 'the retried clip');
  expect(openRouter!.submissions).toHaveLength(2);
  expect(openRouter!.submissions[1].prompt).toBe('a fox in the snow');
  const [clip] = phone.app().generatedVideos;
  expect(await phone.onDisk(clip.videoPath)).toBe(true);
  expect(withClip(phone, chat, clip.id)).toHaveLength(1);
  expect(phone.failure()).toBeUndefined();
});

describe('a start picture', () => {
  async function withPicture() {
    const setup = await ready();
    const picture = `${setup.phone.boundary.fs!.DocumentDirectoryPath}/generated-images/start.png`;
    setup.phone.boundary.fs!.seedTextFile(picture, 'png-bytes');
    return { ...setup, picture };
  }

  it('goes to OpenRouter as the first frame', async () => {
    const { phone, chat, picture } = await withPicture();

    const clip = (await phone.seam.generate({ prompt: 'the boat sails away', conversationId: chat, initImagePath: picture })) as { id: string };

    expect(openRouter!.submissions).toHaveLength(1);
    expect(openRouter!.submissions[0].frame_images).toEqual([
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}` },
        frame_type: 'first_frame',
      },
    ]);
    expect(phone.video(clip.id)).toBeDefined();
  });

  it('is refused by name on a model that cannot start from one, and nothing is sent', async () => {
    const { phone, server, chat, picture } = await withPicture();
    await pickVideoModel(server, OPENROUTER_WORDS_ONLY_VIDEO_MODEL.id);

    await expect(
      phone.seam.generate({ prompt: 'the boat sails away', conversationId: chat, initImagePath: picture }),
    ).rejects.toThrow(OPENROUTER_WORDS_ONLY_VIDEO_MODEL.id);

    expect(openRouter!.submissions).toHaveLength(0);
    expect(phone.app().generatedVideos).toHaveLength(0);
    expect(phone.failure()?.message).toContain(OPENROUTER_WORDS_ONLY_VIDEO_MODEL.id);
    expect(phone.seam.isBusy()).toBe(false);
  });
});

it('a film is made on OpenRouter shot by shot, joined once on the phone, saved, and says where', async () => {
  const { phone, chat } = await ready();
  const story = await phone.films.createStory({ sentence: 'a cat chasing a butterfly through a garden', conversationId: chat });
  expect(story.shots.length).toBeGreaterThan(1);

  await phone.films.startRender(story.id, 'now');
  expect(phone.studio().stories[story.id].target).toBe('computer');
  const { placeLabel } = require('../../../../pro/video/ui/studio/videoWords');
  expect(placeLabel(phone.studio().stories[story.id].target)).toBe('On OpenRouter');
  await until(() => ['done', 'failed'].includes(phone.studio().stories[story.id]?.state), 80_000, 'the film');

  const done = phone.studio().stories[story.id];
  expect(done.error).toBeUndefined();
  expect(done.state).toBe('done');
  // Each shot sent once, in storyboard order, to the picked model; the phone's engine made none.
  expect(openRouter!.submissions.map(body => body.prompt)).toEqual(done.shots.map(item => item.prompt));
  expect(openRouter!.submissions.every(body => body.model === OPENROUTER_VIDEO_MODEL.id)).toBe(true);
  expect(phone.engine.generations).toHaveLength(0);
  // Joined once on the phone, from those clips, in that order.
  const clips = done.shots.map(item => phone.video(item.clipId!)!);
  for (const clip of clips) expect(await phone.onDisk(clip.videoPath)).toBe(true);
  expect(phone.engine.films).toHaveLength(1);
  expect(phone.engine.films[0].clips.map(item => item.path)).toEqual(clips.map(clip => clip.videoPath));
  // Saved, and its card is in the chat.
  const film = phone.video(done.filmId!)!;
  expect(await phone.onDisk(film.videoPath)).toBe(true);
  expect(phone.messages(chat).filter(message => message.videoStoryId === story.id)).toHaveLength(1);
});
