/**
 * Whether the phone has the memory to make a clip, below the UI.
 *
 * SPEC (OGAM): before a clip starts, the phone checks it has the memory for it. On an iPhone the
 * model's weights are memory-mapped (clean pages, not counted against the app's limit), so only the
 * clip's own working set is checked: an iPhone 17 Pro Max with 5.9 GB free makes a clip without a
 * word about memory. An Android phone copies the weights, so they count there. A phone that is truly
 * short refuses before the engine starts, says it is memory, and offers Run anyway, which makes it.
 *
 * Real: the video seam, the video services, the residency manager and memory budget, the stores.
 * Device boundary only: the RAM sensor, the native video engine, the disk, the native downloads.
 */
import { GB } from '../../../harness/nativeBoundary';
import { bootPhoneVideo, closePhoneVideo, until, type PhoneVideo } from '../../../harness/phoneVideoServices';

let phone: PhoneVideo | undefined;

afterEach(async () => {
  await closePhoneVideo();
  phone = undefined;
});

async function phoneWith(platform: 'ios' | 'android', totalGb: number, freeGb: number) {
  phone = await bootPhoneVideo({ ram: { platform, totalBytes: totalGb * GB, availBytes: freeGb * GB } });
  await phone.installPack();
  return { phone, chat: phone.newChat() };
}

it('an iPhone 17 Pro Max with 5.9 GB free makes the clip without a memory refusal', async () => {
  const { phone, chat } = await phoneWith('ios', 12, 5.9);
  const clip = (await phone.seam.generate({ prompt: 'a paper boat on a pond', conversationId: chat })) as { id: string };
  expect(phone.video(clip.id)).toBeDefined();
  expect(phone.failure()).toBeUndefined();
});

it('counts only the working set on iOS: 3 GB free is enough there, but not on Android where the weights count', async () => {
  const ios = await phoneWith('ios', 12, 3);
  const clip = (await ios.phone.seam.generate({ prompt: 'a candle in the dark', conversationId: ios.chat })) as { id: string };
  expect(ios.phone.video(clip.id)).toBeDefined();
  expect(ios.phone.failure()).toBeUndefined();
  await closePhoneVideo();

  const android = await phoneWith('android', 12, 3);
  await expect(android.phone.seam.generate({ prompt: 'a candle in the dark', conversationId: android.chat })).rejects.toThrow(
    /memory/i,
  );
  expect(android.phone.engine.generations).toHaveLength(0);
});

it('a phone truly short of memory refuses before the engine starts, says why, and Run anyway makes the clip', async () => {
  const { phone, chat } = await phoneWith('ios', 6, 0.5);

  await expect(phone.seam.generate({ prompt: 'a fox in the snow', conversationId: chat })).rejects.toThrow(/memory/i);
  // Refused before the engine was asked: nothing started, nothing saved, nothing busy.
  expect(phone.engine.generations).toHaveLength(0);
  expect(phone.app().generatedVideos).toHaveLength(0);
  expect(phone.seam.isBusy()).toBe(false);
  expect(phone.service.getState().phase).toBe('failed');
  const card = phone.failure()!;
  expect(`${card.title} ${card.message}`).toMatch(/memory/i);
  expect(card.onLoadAnyway).toEqual(expect.any(Function));

  card.onLoadAnyway!();
  await until(() => phone.service.getState().phase === 'succeeded', 10_000, 'the clip run anyway');
  expect(phone.engine.generations).toHaveLength(1);
  expect(phone.engine.generations[0].prompt).toBe('a fox in the snow');
  const [clip] = phone.app().generatedVideos;
  expect(await phone.onDisk(clip.videoPath)).toBe(true);
  expect(phone.messages(chat).some(message => message.attachments?.some(item => item.id === clip.id))).toBe(true);
});
