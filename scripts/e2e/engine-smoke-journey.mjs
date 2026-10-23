/**
 * Engine upgrade smoke, on a real phone: does the shipped engine still load, think, stream, see and
 * stop? (llama.rn 0.13.0-rc.7 everywhere, LiteRT-LM 0.18.x on Android.)
 *
 * jest proves the chat pipeline against a fake engine. Only a phone proves the native engine under it.
 *
 *   node scripts/e2e/engine-smoke-journey.mjs --platform ios|android|both
 *     [--gguf Qwen3.5-0.8B-Q4_K_M]          substring of the text-model row id (a small thinking GGUF)
 *     [--vision Qwen3.5-0.8B-Q4_K_M]        substring of a vision GGUF row id (needs its mmproj)
 *     [--stop-model <row>]                  GGUF for the Stop step (default: Mistral 7B on iOS, Qwen3.5 2B on Android)
 *     [--switch-model Qwen3.5-2B-Q4_K_M]    text-only GGUF vision-after-switch passes through
 *     [--litert <row substring>]            Android LiteRT model (default: first `.litertlm` row)
 *     [--expect-image "box|gift"]           regex the vision answer must match (what the newest photo shows)
 *     [--only thinking,stop,vision,litert]
 *
 * Steps, each with screenshots + accessibility tree before and after:
 *   thinking  new chat, small GGUF, Thinking ON, ask -> Stop shows (streaming), the answer GROWS
 *             between two reads, then settles with words in it and a thinking block on screen.
 *   stop      new chat, a long answer, Stop mid-stream -> the partial text stays, the composer
 *             is back, the app is still in front (no crash).
 *   vision    new chat, vision GGUF, attach the newest library photo, ask what it shows -> an answer
 *             with words (and matching --expect-image when given).
 *   vision-after-switch  vision GGUF -> text-only GGUF -> vision GGUF in one session, then send
 *             a photo -> an answer, not "Vision Not Supported".
 *   litert    (Android) new chat, a LiteRT model, ask -> an answer with words.
 *
 * Uses the models already on the phone; it never downloads one. A missing model fails its step with
 * the list of rows that ARE there, so the fix is obvious.
 */
import {
  APP_ID,
  flag,
  hasLabel,
  lastAssistantText,
  literalPattern,
  openNewChat,
  runJourney,
  selectTextModel,
  sendPrompt,
  sleep,
  waitSettled,
  waitForReply,
  waitStreaming,
} from './device-journey.mjs';

const gguf = flag('gguf', 'Qwen3.5-0.8B-Q4_K_M');
const vision = flag('vision', 'Qwen3.5-0.8B-Q4_K_M');
// Stop is tapped on first sight with one normal prompt, so any model that fits will do. The 2B on both
// platforms: Mistral 7B on iOS needs ~6.2GB and now raises Insufficient Memory with ~5.4GB free.
const stopModelFor = () => flag('stop-model', 'Qwen3.5-2B-Q4_K_M');
// The text-only model vision-after-switch switches through.
const stopModel = flag('switch-model', 'Qwen3.5-2B-Q4_K_M');
const expectImage = flag('expect-image');
const only = (flag('only', 'thinking,stop,vision,vision-after-switch,litert')).split(',');

/** Quick settings -> Thinking, set to `on`, read back from the toggle's own label. */
async function setThinking(phone, on) {
  const c = phone.client;
  await c.tapWhenReady('quick-settings-button', { timeoutMs: 15_000 });
  const toggle = await c.waitForLabel('quick-thinking-toggle', {
    label: 'the Thinking toggle (only shown for a thinking-capable model)',
    timeoutMs: 15_000,
  });
  const read = async () => {
    const labels = await c.labels();
    return labels.find((l) => /Thinking, (ON|OFF)/.test(l)) ?? (await c.findByLabel('quick-thinking-toggle'))?.label;
  };
  let state = await read();
  if (phone.platform === 'android') {
    // Android keeps the badge as its own text node rather than merging it into the row.
    const labels = await c.labels();
    const at = labels.indexOf('Thinking');
    state = `Thinking, ${labels.slice(at, at + 4).find((l) => /^(ON|OFF)$/.test(l)) ?? '?'}`;
  }
  if (!state.includes(on ? 'ON' : 'OFF')) {
    await c.tap(toggle.center.x, toggle.center.y);
    await sleep(800);
    // Read the toggle back: a tap that missed must not pass as "Thinking ON".
    // No blind retry: a tap that does not flip it is a candidate app bug, and the step's FAILED
    // snapshot keeps the popover on screen as evidence.
    const final = (await c.labels()).find((l) => /Thinking, (ON|OFF)/.test(l)) ?? '';
    if (!final.includes(on ? 'ON' : 'OFF')) {
      throw new Error(`CANDIDATE APP BUG: tapping the Thinking toggle did not set it ${on ? 'ON' : 'OFF'} (reads "${final.trim() || '?'}")`);
    }
    state = `${state} -> ${final.trim() || '?'}`;
  }
  // Close the popover by tapping the empty transcript, away from every control.
  const { width, height } = await c.windowSize();
  await c.tap(Math.round(width / 2), Math.round(height * 0.3));
  await c.waitForGone('quick-thinking-toggle', { timeoutMs: 8_000 }).catch(() => undefined);
  return state;
}

async function readsAnswer(phone, { minChars = 1 } = {}) {
  const text = await lastAssistantText(phone);
  if (text.replace(/[^a-z0-9]/gi, '').length < minChars) {
    throw new Error(`the assistant bubble has no words in it (read: "${text.slice(0, 200)}")`);
  }
  return text;
}

async function stillInFront(phone) {
  if (phone.platform === 'ios') return (await phone.client.appState(APP_ID)) === 4;
  return (await phone.client.focusedWindow()).includes(APP_ID);
}

await runJourney('engine-smoke', async (phone, run) => {
  const c = phone.client;

  if (only.includes('thinking')) {
    await run.step(phone, 'thinking-chat', async () => {
      await openNewChat(phone);
      await selectTextModel(phone, gguf);
      const before = await setThinking(phone, true);
      await sendPrompt(phone, 'Why is the sky blue? Answer in two sentences.');
      await waitStreaming(phone);
      // Tokens stream: what is on screen grows between two reads while Stop is still up.
      // Tokens stream: while Stop is up, what is on screen grows between reads. Thinking models show
      // nothing outside the Working accordion at first, so sample for a while, not twice.
      const lengths = [];
      for (let i = 0; i < 40 && (await hasLabel(phone, 'stop-button')); i += 1) {
        lengths.push((await lastAssistantText(phone)).length);
        if (lengths.length > 1 && lengths.at(-1) > lengths.at(-2) && lengths.at(-2) > 0) break;
        await sleep(800);
      }
      const streamed = lengths.some((n, i) => i > 0 && n > lengths[i - 1]);
      const first = lengths[0] ?? 0;
      const second = lengths.at(-1) ?? 0;
      await run.snap(phone, 'thinking-mid-stream');
      await waitSettled(phone);
      const answer = await readsAnswer(phone, { minChars: 20 });
      // The thinking block lives in the reply's "Work done" accordion; open it as a person would.
      // A reply taller than the screen leaves its "Work done" header above the fold: scroll up to it.
      const { width: w, height: h } = await c.windowSize();
      for (let i = 0; i < 4 && !(await c.findByLabel('thinking-block-title')) && !(await c.findByLabel('assistant-work-toggle')); i += 1) {
        await c.swipe(w / 2, h * 0.3, w / 2, h * 0.5);
        await sleep(700);
      }
      if (!(await c.findByLabel('thinking-block-title'))) {
        await c.tapLabel('assistant-work-toggle');
        await sleep(1_000);
      }
      const labels = await c.labels();
      const thinkingShown = labels.some((l) => /^(thinking-block-title|Thought process)$/.test(l.trim()));
      if (!thinkingShown) throw new Error(`no thinking block on screen after a Thinking-ON turn (toggle read "${before}")`);
      // A slow tree read (Android's uiautomator) may catch only one sample while Stop is up; then the
      // proof is that the text seen mid-stream was shorter than the settled reply.
      // (Android's dump may show the streaming bubble as just the cursor, so an empty first sample
      // taken while Stop was up still counts.)
      const grewToEnd = lengths.length > 0 && answer.length > lengths[0];
      // Android: one uiautomator dump takes seconds while tokens arrive, so a short reply can finish
      // inside one read. There Stop being seen (waitStreaming) is the streaming proof; growth is data.
      if (!streamed && !grewToEnd && phone.platform !== 'android') {
        throw new Error(`the reply did not grow while Stop was up (lengths read: ${lengths.join(', ')}; final ${answer.length})`);
      }
      return `thinking block shown; streamed ${first}->${second} chars; answer: ${answer.slice(0, 120)}`;
    }).catch(() => undefined);
  }

  if (only.includes('stop')) {
    await run.step(phone, 'stop-mid-stream', async () => {
      await openNewChat(phone);
      await selectTextModel(phone, stopModelFor(phone));
      // A model without thinking (Mistral 7B on iOS) has no Thinking toggle: nothing to turn off.
      // Close the quick-settings popover it left open by tapping the empty transcript.
      await setThinking(phone, false).catch(async () => {
        const { width, height } = await c.windowSize();
        if (await c.findByLabel('quick-settings-button')) await c.tap(Math.round(width / 2), Math.round(height * 0.3));
        await sleep(800);
      });
      // One normal prompt. Stop is tapped the moment it appears, from the SAME tree read that found
      // it: on Android a uiautomator dump takes seconds once tokens stream, so any re-read before
      // the tap lets a short reply finish first (that, not the prompt, is what failed before).
      await openNewChat(phone);
      const pidBefore = phone.platform === 'android' ? (await c.run(['shell', 'pidof', APP_ID]).catch(() => '')).trim() : '';
      await sendPrompt(phone, 'Explain how bread is made.');
      const stop = await c.waitFor(
        async () => {
          const el = await c.findByLabel('stop-button');
          return el && el.label === 'stop-button' ? el : null;
        },
        { label: 'the Stop control after Send', timeoutMs: 120_000, intervalMs: 100 },
      );
      await c.tap(stop.center.x, stop.center.y);
      const tappedAt = Date.now();
      await sleep(1_500);
      const recording = await c.findByLabel('Stop voice recording');
      if (recording) {
        await c.tap(recording.center.x, recording.center.y);
        await c.waitForGone('Transcribing...', { timeoutMs: 120_000 }).catch(() => undefined);
        throw new Error('tapped mic, not Stop: the reply ended as the tap landed and recording started');
      }
      // The input returns to idle: Stop gone, the composer and its mic back.
      await c.waitForGone('stop-button', { timeoutMs: 10_000 });
      const idleMs = Date.now() - tappedAt;
      await waitSettled(phone, 15_000);
      const idle = (await c.labels()).map((l) => l.trim());
      if (!idle.includes('chat-input') || !(idle.includes('voice-record-button') || idle.includes('Start voice recording'))) {
        throw new Error('the composer did not return to idle after Stop (no input / mic)');
      }
      // The reply stops growing: two reads 3 s apart are the same.
      const first = await lastAssistantText(phone);
      await sleep(3_000);
      const second = await lastAssistantText(phone);
      if (second.length > first.length) {
        throw new Error(`the reply kept growing after Stop (${first.length} -> ${second.length} chars)`);
      }
      if (!(await stillInFront(phone))) throw new Error('the app is no longer in front after Stop (crash?)');
      if (pidBefore) {
        const pidAfter = (await c.run(['shell', 'pidof', APP_ID]).catch(() => '')).trim();
        if (pidAfter !== pidBefore) throw new Error(`the app process changed across Stop: ${pidBefore} -> ${pidAfter || 'gone'}`);
      }
      return `Stop tapped on first sight; Stop gone + composer idle within ${idleMs} ms; reply steady at ${second.length} chars ("${second.slice(0, 80)}")${pidBefore ? `; same pid ${pidBefore}` : ''}`;
    }).catch(() => undefined);
  }

  if (only.includes('vision')) {
    await run.step(phone, 'vision-answer', async () => {
      // From a cold start, so this step measures the engine and the projector rather than the
      // in-session switch (vision-after-switch owns that).
      await phone.coldLaunch();
      await sleep(6_000);
      await openNewChat(phone);
      await selectTextModel(phone, vision);
      await setThinking(phone, false).catch(() => undefined);
      await attachNewestPhoto(phone);
      await run.snap(phone, 'vision-attached');
      await sendPrompt(phone, 'What is in this picture? Answer in one short sentence.');
      await waitForReply(phone, 300_000);
      const answer = await readsAnswer(phone, { minChars: 10 });
      if (expectImage && !literalPattern(expectImage).test(answer)) {
        throw new Error(`the answer does not name the picture (/${expectImage}/): ${answer}`);
      }
      return `answer: ${answer.slice(0, 160)}`;
    }).catch(() => undefined);
  }

  if (only.includes('vision-after-switch')) {
    // The person's path: pick the vision model, try a text-only one, come back, send a photo.
    // Found on iOS 2026-10-22: under deferred loading the text-only pick is SELECTED but the vision
    // model stays LOADED, so tapping the vision model again is a no-op, the composer still offers
    // Photo, and Send answers "Vision Not Supported".
    await run.step(phone, 'vision-after-switch', async () => {
      await openNewChat(phone);
      await selectTextModel(phone, vision);
      await selectTextModel(phone, stopModel);
      await selectTextModel(phone, vision);
      await sleep(1_500);
      await attachNewestPhoto(phone);
      await sendPrompt(phone, 'What is in this picture? Answer in one short sentence.');
      const refused = await c
        .waitForLabel('Vision Not Supported', { timeoutMs: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (refused) {
        const labels = await run.snap(phone, 'vision-refused');
        await c.tapLabel('OK').catch(() => undefined);
        const header = labels.find((l) => /begin chatting with/.test(l)) ?? '';
        throw new Error(
          `after ${vision} -> ${stopModel} -> ${vision}, sending a photo says "Vision Not Supported" ` +
            `(${header.trim()}). Selection and loaded model disagree.`,
        );
      }
      await waitForReply(phone, 300_000);
      const answer = await readsAnswer(phone, { minChars: 10 });
      return `answer after switching back: ${answer.slice(0, 120)}`;
    }).catch(() => undefined);
  }

  if (only.includes('litert')) {
    if (phone.platform !== 'android') {
      run.skip('litert-chat', 'LiteRT-LM is the Android engine; iOS has none');
    } else {
      await run.step(phone, 'litert-chat', async () => {
        await openNewChat(phone);
        const wanted = flag('litert', '.litertlm');
        await selectTextModel(phone, wanted);
        await sendPrompt(phone, 'Name three primary colours. One line.');
        // The memory gate may refuse a ~3.6 GB LiteRT load when other apps hold RAM. That refusal is
        // the gate working; this step tests the ENGINE, so it takes the person's own way past it
        // (Load Anyway) and says so in the result.
        let overridden = '';
        try {
          await waitForReply(phone, 300_000);
        } catch (error) {
          if (!/Insufficient Memory|Not enough/.test(error.message)) throw error;
          await run.snap(phone, 'litert-memory-refusal');
          await c.tapWhenReady('Load Anyway', { timeoutMs: 10_000 });
          overridden = ` (after "Load Anyway": the gate first said "${error.message.replace(/^.*?: /, '')}")`;
          await waitForReply(phone, 300_000);
        }
        const answer = await readsAnswer(phone, { minChars: 10 });
        return `answer: ${answer.slice(0, 120)}${overridden}`;
      }).catch(() => undefined);
    }
  }
});

/**
 * The composer's plus -> Photo -> Photo Library -> the newest photo, through the real system picker.
 *
 * iOS: the picker exposes no per-photo cells, only layout groups, so the first grid cell is tapped by
 * position (fractions of the screen, measured on device - see multi-attachment-sync.mjs). Android:
 * the photo picker names each item "Photo taken on ...", so the first one is addressable.
 */
async function attachNewestPhoto(phone) {
  const c = phone.client;
  await c.tapWhenReady('attach-button', { timeoutMs: 15_000 });
  await tapPhotoOption(c);
  await c.tapWhenReady('Photo Library', { timeoutMs: 15_000 });
  await sleep(3_000);
  if (phone.platform === 'ios') {
    const { width, height } = await c.windowSize();
    await c.tap(Math.round(width * 0.16), Math.round(height * 0.235));
  } else {
    await c.tapWhenReady('Photo taken on', { timeoutMs: 40_000 });
    await sleep(800);
    const done = await c.findByLabel('Done');
    if (done) await c.tap(done.center.x, done.center.y);
  }
  await c.waitFor(async () => (await c.labels()).some((l) => l.startsWith('attachment-preview-')), {
    label: 'the photo in the composer (attachment-preview-*)',
    timeoutMs: 30_000,
  });
}

/**
 * The attach menu's Photo row. Android exposes its testID (`attach-photo`); iOS merges the row into
 * one element read as "Photo", so it is found by the exact visible word.
 */
async function photoOption(c) {
  const labels = (await c.labels()).map((l) => l.trim());
  if (labels.includes('attach-photo')) return c.findByLabel('attach-photo');
  return labels.includes('Photo') ? c.findByLabel('Photo') : null;
}

async function tapPhotoOption(c) {
  const option = await c.waitFor(async () => photoOption(c), {
    label: 'the Photo option in the attach menu (only offered when the model can see)',
    timeoutMs: 10_000,
  });
  await c.tap(option.center.x, option.center.y);
}
