/**
 * Streaming-TTS playback FLOW integration tests.
 *
 * These drive the real streaming-speech coordinator through a full, multi-step sequence against
 * the real Kokoro engine, whose audio takes as long to play as the test lets it — so a queue of
 * sentences builds up, exactly like on-device. They reproduce the two faults the [TTS-SM] device
 * trace surfaced:
 *   1. "streaming works, but once the full answer is prepared it stops speaking" — a hard abort
 *      dropped the still-queued sentences of the CURRENT answer.
 *   2. the natural end of a turn must speak EVERY queued sentence + the trailing partial, through
 *      to idle — never abandon the backlog.
 *
 * Ours runs for real (store, coordinator, playback machine, Kokoro engine + bridge, residency).
 * Faked (harness/speechDevice): the executorch speech runtime, the audio output and its clock.
 */
import { launchSpeech, type SpeechApp } from '../../harness/speechDevice';

let app: SpeechApp;

beforeEach(async () => {
  app = await launchSpeech();
  // Voice mode: replies are spoken as they stream.
  await app.rtl.act(async () => { app.store().updateSettings({ interfaceMode: 'audio' }); });
});

afterEach(async () => {
  await app.close();
});

/** Tokens arrive (cumulative content, as in real streaming). */
async function feed(content: string) {
  await app.rtl.act(async () => { app.streaming.feedStreamingText(content); });
  await app.settle();
}

/** The sentence playing now finishes, and the coordinator moves on. */
async function finishSentence() {
  await app.play(1);
}

describe('streaming TTS — full answer is spoken to the end', () => {
  it('drains the entire backlog: every queued sentence + the trailing partial is spoken in order', async () => {
    // Tokens arrive faster than the audio plays → a backlog builds behind the sentence in flight.
    await feed('One. ');
    await feed('One. Two. ');
    await feed('One. Two. Three. ');
    expect(app.streaming.isStreamingSpeechActive()).toBe(true);
    expect(app.said()).toEqual(['One.']); // "One." playing; Two./Three. queued

    // Generation ends with a trailing partial that has no terminal punctuation.
    await app.rtl.act(async () => { app.streaming.finishStreamingText('One. Two. Three. And finally four', 'assistant-1'); });

    for (let i = 0; i < 8 && app.streaming.isStreamingSpeechActive(); i++) await finishSentence();

    expect(app.said()).toEqual(['One.', 'Two.', 'Three.', 'And finally four']);
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);
    expect(app.output.sounding()).toEqual([]);
    expect(app.store().playbackStatus).toBe('idle'); // settled, not stuck mid-playback
  });

  it('hands playback off to the real message id when the turn finalizes', async () => {
    await feed('Hello world. ');
    await app.rtl.act(async () => { app.streaming.finishStreamingText('Hello world. Second part', 'assistant-42'); });
    await app.settle();
    expect(app.store().currentMessageId).toBe('assistant-42');
    await finishSentence();
    expect(app.store().currentMessageId).toBe('assistant-42'); // "Second part" still playing
    expect(app.said()).toEqual(['Hello world.', 'Second part']);
  });
});

describe('streaming TTS — interruption semantics', () => {
  it('a NEW stream supersedes the old one cleanly (a new turn is allowed to interrupt)', async () => {
    await feed('Old one. ');
    await finishSentence();

    // A new generation begins: core resets the coordinator, then the new tokens arrive.
    await app.rtl.act(async () => { app.streaming.resetStreamingSpeech(); });
    await feed('New answer here.');
    await finishSentence();

    expect(app.said()).toEqual(['Old one.', 'New answer here.']);
    expect(app.streaming.isStreamingSpeechActive()).toBe(true);
  });

  it('REGRESSION: a hung runtime does not permanently wedge the coordinator', async () => {
    // The on-device fault: the Kokoro runtime died mid-stream so the sentence never finished, the
    // drain's await hung, and every later stream hit "drain: already draining".
    app.runtime.reply('hang');
    await feed('Stuck sentence. ');
    expect(app.said()).toEqual(['Stuck sentence.']); // reached the runtime, never answered

    // The recovery core runs on stop / a new turn / a mode switch: the store's stop, which aborts
    // the coordinator and stops the engine.
    await app.rtl.act(async () => { app.store().stop(); });
    expect(app.streaming.isStreamingSpeechActive()).toBe(false);

    // A brand-new stream engages and is actually spoken — the lock was cleared.
    await feed('Recovered and speaking.');
    expect(app.said()).toEqual(['Stuck sentence.', 'Recovered and speaking.']);
    expect(app.output.sounding()).toHaveLength(1);
  });
});
