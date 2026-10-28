/**
 * A clip made on the phone, below the UI.
 *
 * SPEC (OGAM): I pick a downloaded video model, describe a clip in a chat and Send. The phone's engine
 * makes it with progress I can see, the clip is saved on the phone at the size and frame rate it was
 * made with, and it lands in the chat as a playable clip. Stop ends it quietly and the phone can make
 * the next one at once. A second clip asked for while one is made is refused with a reason, never
 * dropped. A clip the engine could not make stays failed, says why, and Retry makes it.
 *
 * Real: the video seam, the video services, the residency manager, the stores, Pro activation.
 * Device boundary only: the native video engine, the disk, the RAM sensor, the native downloads.
 */
import { bootPhoneVideo, closePhoneVideo, until, type PhoneVideo } from '../../../harness/phoneVideoServices';

let phone: PhoneVideo | undefined;

afterEach(async () => {
  await closePhoneVideo();
  phone = undefined;
});

async function ready(): Promise<{ phone: PhoneVideo; chat: string }> {
  phone = await bootPhoneVideo();
  await phone.installPack();
  return { phone, chat: phone.newChat() };
}

it('a clip runs with progress, is saved with its frames and rate, and lands in the chat playable', async () => {
  const { phone, chat } = await ready();
  phone.engine.hold();
  const making = phone.seam.generate({ prompt: 'a hummingbird over a red flower', conversationId: chat });

  // In flight: the engine is on its first sampling step, and nothing is saved yet.
  await until(() => phone.service.getState().progress?.step === 1, 10_000, 'the first step');
  const running = phone.service.getState();
  expect(running.phase).toBe('running');
  expect(running.progress!.total).toBeGreaterThan(1);
  expect(phone.seam.isBusy()).toBe(true);
  expect(phone.app().generatedVideos).toHaveLength(0);
  expect(phone.messages(chat).some(message => message.attachments?.some(item => item.type === 'video'))).toBe(false);

  phone.engine.release();
  const clip = (await making) as { id: string };

  // Saved: the file on the phone, its frame rate and frame count as the engine was asked to make them.
  const saved = phone.video(clip.id)!;
  expect(saved).toBeDefined();
  expect(await phone.onDisk(saved.videoPath)).toBe(true);
  const asked = phone.engine.generations[0];
  expect(saved.fps).toBe(asked.fps);
  expect(saved.frames).toBe(asked.frames);
  expect(saved.fps).toBeGreaterThan(0);
  expect(saved.durationSeconds).toBeCloseTo(saved.frames / saved.fps);
  expect(asked.outputPath).toBe(saved.videoPath);

  // In the chat: one message that plays that file.
  const withClip = phone.messages(chat).filter(message => message.attachments?.some(item => item.id === saved.id));
  expect(withClip).toHaveLength(1);
  expect(withClip[0].attachments![0]).toMatchObject({ type: 'video', uri: `file://${saved.videoPath}` });

  // Done: the engine is free and nothing is reported as failed.
  expect(phone.service.getState().phase).toBe('succeeded');
  expect(phone.seam.isBusy()).toBe(false);
  expect(phone.failure()).toBeUndefined();
});

it('Stop mid-render ends the clip with no error, keeps nothing, and the next clip runs', async () => {
  const { phone, chat } = await ready();
  phone.engine.hold();
  const making = phone.seam.generate({ prompt: 'waves rolling onto a beach', conversationId: chat });
  await until(() => phone.service.getState().progress?.step === 1, 10_000, 'the first step');
  const output = String(phone.engine.generations[0].outputPath);
  expect(phone.seam.isBusy()).toBe(true);

  await phone.seam.cancel();

  // Stopped, not failed: the promise settles without an error, and no card says it failed.
  await expect(making).resolves.toBeUndefined();
  expect(phone.service.getState().phase).toBe('cancelled');
  expect(phone.failure()).toBeUndefined();
  expect(phone.app().generatedVideos).toHaveLength(0);
  expect(await phone.onDisk(output)).toBe(false);
  expect(phone.seam.isBusy()).toBe(false);

  // The engine is free for the next clip.
  const next = (await phone.seam.generate({ prompt: 'a lighthouse at dusk', conversationId: chat })) as { id: string };
  expect(phone.video(next.id)).toBeDefined();
  expect(phone.engine.generations).toHaveLength(2);
});

it('a second clip asked for while one is made is refused with a reason; the first still lands', async () => {
  const { phone, chat } = await ready();
  phone.engine.hold();
  const first = phone.seam.generate({ prompt: 'a red kite in the wind', conversationId: chat });
  await until(() => phone.service.getState().progress?.step === 1, 10_000, 'the first step');

  await expect(phone.seam.generate({ prompt: 'a blue kite in the wind', conversationId: chat })).rejects.toThrow(
    /already running/i,
  );
  // Refused before it reached the engine; the first clip is untouched.
  expect(phone.engine.generations).toHaveLength(1);
  expect(phone.service.getState().phase).toBe('running');

  phone.engine.release();
  const clip = (await first) as { id: string };
  expect(phone.video(clip.id)?.prompt).toBe('a red kite in the wind');
  expect(phone.app().generatedVideos).toHaveLength(1);
});

describe.each([
  ['the engine runs out of memory', 'The video engine ran out of memory.'],
  ['the encoder writes no frames', 'Video encoder produced no file.'],
])('when %s', (_case, reason) => {
  it('the clip stays failed with the reason, and Retry makes it', async () => {
    const { phone, chat } = await ready();
    phone.engine.failNext(reason);

    await expect(phone.seam.generate({ prompt: 'a fox in the snow', conversationId: chat })).rejects.toThrow(reason);
    expect(phone.service.getState()).toMatchObject({ phase: 'failed', error: reason });
    expect(phone.app().generatedVideos).toHaveLength(0);
    expect(phone.seam.isBusy()).toBe(false);
    // The failure card says why and offers Retry.
    const card = phone.failure()!;
    expect(card.message).toContain(reason);
    expect(card.onRetry).toEqual(expect.any(Function));

    // Still failed a moment later: nothing quietly clears it.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(phone.service.getState().phase).toBe('failed');

    card.onRetry!();
    await until(() => phone.service.getState().phase === 'succeeded', 10_000, 'the retried clip');
    expect(phone.engine.generations).toHaveLength(2);
    expect(phone.engine.generations[1].prompt).toBe('a fox in the snow');
    const [clip] = phone.app().generatedVideos;
    expect(await phone.onDisk(clip.videoPath)).toBe(true);
    expect(phone.messages(chat).some(message => message.attachments?.some(item => item.id === clip.id))).toBe(true);
    expect(phone.failure()).toBeUndefined();
  });
});
