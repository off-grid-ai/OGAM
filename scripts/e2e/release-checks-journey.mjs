/**
 * Release device checks D1-D7 for stable mobile, on a real phone, re-runnable step by step.
 *
 *   node scripts/e2e/release-checks-journey.mjs --platform ios|android|both [--only d1,d2,...]
 *     [--big Qwen3.5-2B-Q4_K_M] [--small Qwen3.5-0.8B-Q4_K_M] [--say "the quick brown fox"]
 *
 *   d1  Load params + auto threads: 2B, three turns; tok/s read from each reply's Generation details;
 *       app alive after. Android: the same again on NPU (Beta) when the phone offers it - Qwen only,
 *       never Gemma on HTP. The backend is put back to what it was afterwards.
 *   d2  KV save/restore: chat A two turns (turn 1 states a fact), chat B one turn, background and
 *       foreground, back to A, ask for the fact -> the reply has it; app alive.
 *   d3  Residency + switch fit: small -> big -> small, one message each; the chat header names the
 *       selected model before each send; on the small (vision) model a photo is answered, not
 *       "Vision Not Supported". Device check for the picker fix bcd2815f2.
 *   d4  Picks: a Fast (or Balanced) pick that is NOT downloaded: Download -> progress shows -> Cancel ->
 *       Download again -> wait to finish -> "Use <model>" opens a chat that answers. SKIPPED when every
 *       small pick is already on the phone (never deletes a model to make room for the test).
 *   d5  Check for new models, once: an answer (not "Couldn't check").
 *   d6  Image generation: one picture from a prompt with the phone's image model. The disk-full guard
 *       is SKIPPED unless the disk is nearly full.
 *   d8  Tools on vs off (data, not a verdict): 2B in a new chat, "Explain step by step how bread is
 *       made." once with the person's tools as they are, once with every switch on the Tools and Pro
 *       Tools screens OFF (reached from Quick settings, never the Assistant toggle). Both replies are
 *       recorded verbatim with the "Tools sent in request" line; the switches are put back after.
 *       A refusal with tools OFF throws (flag it); with tools ON it is recorded as data.
 *   d7  Live dictation: tap the mic, the Mac speaks a sentence, tap again -> the words are in the input.
 *       Needs the phone within earshot of the Mac and the mic already granted.
 */
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import {
  APP_ID,
  clearComposer,
  ejectAllModels,
  escapeRegExp,
  parseXml,
  walkXml,
  composerText,
  flag,
  lastAssistantText,
  openNewChat,
  runJourney,
  selectTextModel,
  sendPrompt,
  sleep,
  toHome,
  waitForReply,
} from './device-journey.mjs';

const exec = promisify(execFile);
const only = flag('only', 'd1,d2,d3,d4,d5,d6,d7,d8').split(',');
const big = flag('big', 'Qwen3.5-2B-Q4_K_M');
const small = flag('small', 'Qwen3.5-0.8B-Q4_K_M');
const sentence = flag('say', 'the quick brown fox jumps over the lazy dog');
// d8 in a project (its own system prompt) instead of the Default system prompt from settings.
const d8Project = flag('d8-project', '');

/** Is the app process still the one we started with, and in front? */
async function alive(phone, baseline) {
  if (phone.platform === 'ios') {
    const state = await phone.client.appState(APP_ID);
    if (state !== 4) throw new Error(`the app is not in the foreground (state ${state})`);
    return 'in foreground';
  }
  const pid = (await phone.client.run(['shell', 'pidof', APP_ID]).catch(() => '')).trim();
  if (!pid) throw new Error('the app process is gone');
  if (baseline && pid !== baseline) throw new Error(`the app restarted: pid ${baseline} -> ${pid}`);
  const crash = await phone.client.run(['logcat', '-b', 'crash', '-d']).catch(() => '');
  // The crash buffer is phone-wide (a shell `dmesg` killed by seccomp lands there too); only our app's
  // entries count.
  const ours = crash.split('\n').filter((l) => l.includes(APP_ID) && /FATAL|Fatal signal|OutOfMemory|>>> /.test(l));
  if (ours.length) throw new Error(`crash buffer: ${ours.slice(0, 3).join(' | ')}`);
  return `pid ${pid}, crash log clean`;
}

async function pidOf(phone) {
  return phone.platform === 'android' ? (await phone.client.run(['shell', 'pidof', APP_ID]).catch(() => '')).trim() : null;
}

/** Background the app and bring it back, as a person switching apps would. */
async function backgroundAndReturn(phone) {
  if (phone.platform === 'android') {
    await phone.client.run(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    await sleep(3_000);
    await phone.client.run(['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1']);
  } else {
    await phone.client.activate('com.apple.Preferences');
    await sleep(3_000);
    await phone.client.activate(APP_ID);
  }
  await sleep(2_500);
}

/**
 * The newest reply's Generation details, as the person reads them: expand the lowest "Generation
 * details" toggle, take the labels that appeared, collapse it again. Holds the model name and tok/s.
 */
async function newestDetails(phone) {
  const c = phone.client;
  let lowest = null;
  const walk = (n) => {
    if (!n) return;
    if ([n.label, n.name].includes('generation-details-toggle') && n.rect?.width > 0) {
      if (!lowest || n.rect.y > lowest.rect.y) lowest = n;
    }
    (n.children || []).forEach(walk);
  };
  walk(await c.source());
  if (!lowest) return { tps: null, lines: [] };
  const before = new Set(await c.labels());
  const at = { x: lowest.rect.x + lowest.rect.width / 2, y: lowest.rect.y + lowest.rect.height / 2 };
  await c.tap(at.x, at.y);
  await sleep(1_000);
  const lines = (await c.labels()).filter((l) => !before.has(l));
  await c.tap(at.x, at.y).catch(() => undefined);
  await sleep(500);
  const tps = lines.map((l) => l.match(/([\d.]+) tok\/s/)?.[1]).filter(Boolean);
  return { tps: tps.length ? Number(tps.at(-1)) : null, lines };
}

async function chatTurns(phone, prompts) {
  const rates = [];
  for (const prompt of prompts) {
    await sendPrompt(phone, prompt);
    await waitForReply(phone, 300_000);
    // The bubble fills a moment after Stop goes away; wait for its words, as a reader would.
    const reply = await phone.client
      .waitFor(async () => {
        const text = await lastAssistantText(phone);
        return text.replace(/[^a-z0-9]/gi, '').length >= 2 ? text : null;
      }, { label: `the reply to "${prompt}"`, timeoutMs: 20_000, intervalMs: 1_000 })
      .catch(() => '');
    if (!reply) throw new Error(`empty reply to "${prompt}"`);
    rates.push((await newestDetails(phone)).tps);
  }
  return rates;
}

/** Generation settings -> Advanced -> backend option by its visible label. Answers the label it was. */
async function setBackend(phone, label) {
  const c = phone.client;
  await c.tapWhenReady('chat-settings-icon', { timeoutMs: 10_000 });
  await sleep(1_200);
  await c.scrollAndTap('modal-text-advanced-toggle', { maxSwipes: 8 });
  await sleep(1_000);
  const option = await c.scrollToLabel(label, { maxSwipes: 8 }).catch(() => null);
  let before = null;
  for (const name of ['CPU', 'GPU', 'NPU (Beta)', 'Metal']) {
    const xml = await phone.sourceXml();
    if (new RegExp(`(text|label)="${escapeRegExp(name)}"[^>]*(checked|selected)="true"`).test(xml)) before = name;
  }
  if (option) await c.tap(option.center.x, option.center.y);
  await sleep(1_000);
  for (let i = 0; i < 4 && (await c.findByLabel('app-sheet-close')); i += 1) {
    await c.tapLabel('app-sheet-close');
    await sleep(700);
  }
  if (!(await c.findByLabel('chat-input'))) await c.back();
  return { found: Boolean(option), before };
}

async function attachNewestPhoto(phone) {
  const c = phone.client;
  await c.tapWhenReady('attach-button', { timeoutMs: 15_000 });
  const photo = await c.waitFor(
    async () => (await c.findByLabel('attach-photo')) ?? ((await c.labels()).includes('Photo') ? c.findByLabel('Photo') : null),
    { label: 'the Photo option', timeoutMs: 10_000 },
  );
  await c.tap(photo.center.x, photo.center.y);
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
    label: 'the photo in the composer',
    timeoutMs: 30_000,
  });
}


/**
 * Every switch on screen: { key, on, x, y }. The key is the nearest testID (the switch's own, or its
 * row's - Pro tool switches carry none of their own), so the same switch is found again after scrolling.
 */
async function readSwitches(phone) {
  const root = parseXml(await phone.sourceXml());
  const out = [];
  for (const node of walkXml(root)) {
    const a = node.attrs;
    const isSwitch = phone.platform === 'ios' ? node.tag === 'XCUIElementTypeSwitch' : a.class === 'android.widget.Switch';
    if (!isSwitch) continue;
    let key = phone.platform === 'ios' ? a.name || '' : (a['resource-id'] || '').replace(/^.*:id\//, '');
    for (let p = node.parent; !key && p && p.tag !== '#root'; p = p.parent) {
      key = phone.platform === 'ios' ? p.attrs.name || '' : (p.attrs['resource-id'] || '').replace(/^.*:id\//, '');
    }
    if (!key) key = a.label || a['content-desc'] || `switch-${out.length}`;
    let rect;
    if (phone.platform === 'ios') rect = { x: +a.x, y: +a.y, w: +a.width, h: +a.height };
    else {
      const m = a.bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
      rect = m ? { x: +m[1], y: +m[2], w: m[3] - m[1], h: m[4] - m[2] } : { x: 0, y: 0, w: 0, h: 0 };
    }
    const on = phone.platform === 'ios' ? a.value === '1' : a.checked === 'true';
    out.push({ key, on, x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, h: rect.h });
  }
  return out;
}

/**
 * Turn every switch on this screen to `want` (or only those in `keys`), scrolling through the list.
 * Answers the keys it flipped.
 */
async function flipSwitches(phone, want, keys = null) {
  const c = phone.client;
  const { width, height } = await c.windowSize();
  const flipped = [];
  for (let pass = 0; pass < 4; pass += 1) {
    for (const sw of await readSwitches(phone)) {
      if (sw.on === want || flipped.includes(sw.key) || (keys && !keys.includes(sw.key))) continue;
      if (sw.h <= 0 || sw.y < height * 0.12 || sw.y > height * 0.88) continue;
      await c.tap(sw.x, sw.y);
      await sleep(900);
      flipped.push(sw.key);
    }
    await c.swipe(width / 2, height * 0.75, width / 2, height * 0.35);
    await sleep(700);
  }
  return flipped;
}

/** Quick settings -> a row -> its screen; run `fn` there; come back to the chat. */
async function viaQuickSettings(phone, rowId, fn) {
  const c = phone.client;
  await c.tapWhenReady('quick-settings-button', { timeoutMs: 10_000 });
  await c.tapWhenReady(rowId, { timeoutMs: 10_000 });
  await sleep(2_000);
  const result = await fn();
  for (let i = 0; i < 3 && !(await c.findByLabel('chat-input')); i += 1) {
    const back = (await c.findByLabel('tools-back')) ?? (await c.findByLabel('pro-tools-back')) ?? (await c.findByLabel('Back'));
    if (back) await c.tap(back.center.x, back.center.y);
    else await c.back();
    await sleep(1_200);
  }
  return result;
}

/** The two quick-settings counts, e.g. "Tools 1 / Pro Tools 5", read from the popover. */
async function toolCounts(phone) {
  const c = phone.client;
  await c.tapWhenReady('quick-settings-button', { timeoutMs: 10_000 });
  await c.waitForLabel('quick-tools', { timeoutMs: 10_000 });
  const labels = await c.labels();
  const read = (name) => {
    const merged = labels.find((l) => new RegExp(`^.?, ${name}, `).test(l));
    if (merged) return merged.split(', ').at(-1);
    const at = labels.indexOf(name);
    return at >= 0 ? labels.slice(at + 1, at + 4).find((l) => /^(\d+|N\/A)$/.test(l)) ?? '?' : '?';
  };
  const counts = { tools: read('Tools'), pro: read('Pro Tools') };
  const { width, height } = await c.windowSize();
  await c.tap(Math.round(width / 2), Math.round(height * 0.3));
  await sleep(800);
  return counts;
}

async function breadTurn(phone, run, tag) {
  await openNewChat(phone);
  if (d8Project) {
    await phone.client.tapWhenReady('Project: Default', { timeoutMs: 10_000 });
    await phone.client.waitForLabel('Select Project', { timeoutMs: 10_000 });
    const row = await phone.client.waitForStable(`${d8Project}, `);
    await phone.client.tap(row.center.x, row.center.y);
    await sleep(1_500);
    if (await phone.client.findByLabel('app-sheet-close')) await phone.client.tapLabel('app-sheet-close');
    await phone.client.waitForLabel(`Project: ${d8Project}`, { timeoutMs: 10_000 });
  }
  await ejectAllModels(phone);
  await selectTextModel(phone, big);
  const counts = await toolCounts(phone);
  await sendPrompt(phone, 'Explain step by step how bread is made.');
  await waitForReply(phone, 300_000);
  await sleep(1_500);
  const reply = await lastAssistantText(phone);
  const sent = (await phone.client.labels()).filter((l) => /Tools sent in request/.test(l)).at(-1) ?? '(no "Tools sent in request" line)';
  await run.snap(phone, `d8-${tag}`);
  const refused = /cannot (fulfil|fulfill|help|write|provide)|can.t help|unable to|not able to|safety guidelines/i.test(reply);
  // A thinking model can spend every token in "Work done" and leave the answer empty.
  const empty = reply.replace(/^Work done(, )?/i, '').replace(/[^a-z0-9]/gi, '').length < 2;
  return { tag, counts, sent: sent.trim(), refused, empty, reply };
}

await runJourney('release-checks', async (phone, run) => {
  const c = phone.client;
  const baseline = await pidOf(phone);
  const step = (name, fn) => run.step(phone, name, fn).catch(() => undefined);

  if (only.includes('d1')) {
    await step('d1-load-params', async () => {
      await openNewChat(phone);
      await ejectAllModels(phone);
      await selectTextModel(phone, big);
      const rates = await chatTurns(phone, ['Say hello in five words.', 'Name two oceans.', 'What is 12 times 3?']);
      return `${big}: tok/s ${rates.map((r) => r ?? '?').join(', ')}; ${await alive(phone, baseline)}`;
    });
    if (phone.platform === 'android') {
      await step('d1-npu-htp', async () => {
        if (/gemma/i.test(big)) throw new Error('refusing: Gemma must never run on HTP');
        await openNewChat(phone);
        const { found, before } = await setBackend(phone, 'NPU (Beta)');
        if (!found) return 'SKIPPED: this phone does not offer NPU (Beta)';
        try {
          // The 2B is still resident from d1 on CPU; picking it again would keep that load. Eject so
          // it really reloads on the NPU backend.
          await ejectAllModels(phone);
          await selectTextModel(phone, big);
          const rates = await chatTurns(phone, ['Say hello in five words.', 'Name two oceans.', 'What is 12 times 3?']);
          return `${big} on NPU: tok/s ${rates.map((r) => r ?? '?').join(', ')}; ${await alive(phone, null)}`;
        } finally {
          await openNewChat(phone).catch(() => undefined);
          await setBackend(phone, before ?? 'CPU').catch(() => undefined);
        }
      });
    }
  }

  if (only.includes('d2')) {
    await step('d2-kv-restore', async () => {
      const marker = `kv${Date.now() % 100000}`;
      await openNewChat(phone);
      await ejectAllModels(phone);
      await selectTextModel(phone, big);
      await chatTurns(phone, [`${marker}: my favourite colour is teal. Just say OK.`, 'What is 7 plus 5?']);
      await openNewChat(phone);
      await chatTurns(phone, ['Say hi.']);
      await backgroundAndReturn(phone);
      await toHome(phone);
      await c.tapWhenReady('chats-tab', { timeoutMs: 15_000 });
      await sleep(1_500);
      await c.scrollToLabel(marker, { maxSwipes: 6 });
      for (let attempt = 0; attempt < 3 && !(await c.findByLabel('chat-input')); attempt += 1) {
        const row = await c.waitForStable(marker);
        await c.tap(row.center.x, row.center.y);
        await sleep(2_500);
      }
      await c.waitForLabel('chat-input', { label: `chat A (${marker}) to open`, timeoutMs: 20_000 });
      await sendPrompt(phone, 'What is my favourite colour? One word.');
      await waitForReply(phone, 300_000);
      const reply = await lastAssistantText(phone);
      if (!/teal/i.test(reply)) throw new Error(`chat A lost its context: asked for the colour, got "${reply.slice(0, 160)}"`);
      return `chat A remembered "teal" after B + background; ${await alive(phone, baseline)}`;
    });
  }

  if (only.includes('d3')) {
    await step('d3-switch-fit', async () => {
      const seen = [];
      await openNewChat(phone);
      await ejectAllModels(phone);
      for (const [rowNeedle, expect] of [[small, /0\.8B/i], [big, /\b2B\b/i], [small, /0\.8B/i]]) {
        await selectTextModel(phone, rowNeedle);
        await sendPrompt(phone, 'Reply with one word: ready.');
        await waitForReply(phone, 300_000);
        // The reply's own Generation details name the model that produced it.
        const { lines } = await newestDetails(phone);
        const named = lines.find((l) => /qwen|gguf|\dB\b/i.test(l)) ?? lines.join(' | ');
        seen.push(named);
        if (!expect.test(named)) throw new Error(`selected ${rowNeedle} but the reply's Generation details name "${named}"`);
      }
      await attachNewestPhoto(phone);
      await sendPrompt(phone, 'What is in this picture? One short sentence.');
      const refused = await c
        .waitForLabel('Vision Not Supported', { timeoutMs: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (refused) {
        await c.tapLabel('OK').catch(() => undefined);
        throw new Error('photo on the small model after the switch: "Vision Not Supported"');
      }
      await waitForReply(phone, 300_000);
      const answer = await lastAssistantText(phone);
      return `replies came from: ${seen.join(' -> ')}; photo answered: ${answer.slice(0, 100)}; ${await alive(phone, baseline)}`;
    });
  }

  if (only.includes('d4')) {
    await step('d4-picks', async () => {
      await toHome(phone);
      await c.tapWhenReady('models-tab', { timeoutMs: 15_000 });
      await sleep(1_500);
      const labels = await c.labels();
      const slot = ['pick-fast', 'pick-balanced'].find((s) => labels.includes(`${s}-download`));
      if (!slot) return 'SKIPPED: the Fast and Balanced picks are already on this phone (no model is deleted to test)';
      const progress = async () => (await c.labels()).some((l) => l === `${slot}-progress` || /^(Cancel download|Pause download)$/.test(l));
      await c.tapWhenReady(`${slot}-download`);
      await c.waitFor(progress, { label: 'the download to start', timeoutMs: 30_000 });
      await sleep(2_000);
      await c.tapWhenReady('Cancel download', { timeoutMs: 10_000 });
      await sleep(1_000);
      const confirm = await c.findByLabel('Cancel Download');
      if (confirm) await c.tap(confirm.center.x, confirm.center.y);
      await c.waitForLabel(`${slot}-download`, { label: 'Download back after Cancel', timeoutMs: 30_000 });
      await c.tapWhenReady(`${slot}-download`);
      await c.waitFor(progress, { label: 'the second download to start', timeoutMs: 30_000 });
      await c.waitForLabel(`${slot}-select`, { label: 'the download to finish ("Use <model>")', timeoutMs: 30 * 60_000, intervalMs: 5_000 });
      const use = await c.findByLabel(`${slot}-select`);
      await c.tap(use.center.x, use.center.y);
      await c.waitForLabel('chat-input', { timeoutMs: 60_000 });
      await sendPrompt(phone, 'Say hello.');
      await waitForReply(phone, 300_000);
      return `${slot}: download, cancel, download again, finished, chat answered: ${(await lastAssistantText(phone)).slice(0, 60)}`;
    });
  }

  if (only.includes('d5')) {
    await step('d5-check-new-models', async () => {
      await toHome(phone);
      await c.tapWhenReady('models-tab', { timeoutMs: 15_000 });
      await sleep(1_000);
      await c.tapWhenReady('check-new-models-button', { timeoutMs: 10_000 });
      const title = await c.waitFor(
        async () => (await c.labels()).map((l) => l.trim()).find((l) => /^(Up to date|\d+ new models?|Models updated|Couldn.t check for new models)$/i.test(l)),
        { label: 'the Check for new models answer', timeoutMs: 60_000, intervalMs: 1_000 },
      );
      await c.tapLabel('app-sheet-close').catch(() => undefined);
      if (/Couldn.t/.test(title)) throw new Error(`Check for new models: "${title}"`);
      return `answer: "${title}"`;
    });
  }

  if (only.includes('d6')) {
    await step('d6-image-generation', async () => {
      await openNewChat(phone);
      await c.tapWhenReady('model-selector', { timeoutMs: 10_000 });
      const imageRow = await c.waitForStable('models-row-image');
      const imageLabel = (await c.labels()).find((l) => /^, IMAGE,/.test(l)) ?? '';
      if (/IMAGE, —/.test(imageLabel)) {
        await c.tap(imageRow.center.x, imageRow.center.y);
        await sleep(2_000);
        const first = (await c.labels()).find((l) => l.startsWith('image-model-row-'));
        if (!first) throw new Error('no image model on this phone');
        await c.tapLabel(first);
        await sleep(3_000);
      }
      for (let i = 0; i < 4 && (await c.findByLabel('app-sheet-close')); i += 1) {
        await c.tapLabel('app-sheet-close');
        await sleep(700);
      }
      // Image Gen to ON for this message (the composer's own state; it is not a saved setting), so the
      // step tests generation rather than the intent router's guess.
      await c.tapWhenReady('quick-settings-button', { timeoutMs: 10_000 });
      await c.waitForLabel('quick-image-mode', { timeoutMs: 10_000 });
      for (let i = 0; i < 3 && !(await phone.sourceXml()).includes('image-mode-force-badge'); i += 1) {
        await c.tapLabel('quick-image-mode');
        await sleep(700);
      }
      const forced = (await phone.sourceXml()).includes('image-mode-force-badge');
      const { width, height } = await c.windowSize();
      await c.tap(Math.round(width / 2), Math.round(height * 0.3));
      await sleep(800);
      if (!forced) throw new Error('could not set Image Gen to ON in quick settings');
      const before = (await c.labels()).filter((l) => /generated image|generated-image/i.test(l)).length;
      await sendPrompt(phone, 'a red apple on a white table');
      const outcome = await c.waitFor(
        async () => {
          const labels = await c.labels();
          if (labels.filter((l) => /generated image|generated-image/i.test(l)).length > before) return 'image';
          return labels.find((l) => /not enough (free )?(memory|space|storage)|failed to (load|generate)/i.test(l)) ?? null;
        },
        { label: 'a generated picture', timeoutMs: 10 * 60_000, intervalMs: 3_000 },
      );
      if (outcome !== 'image') throw new Error(`image generation refused: ${outcome}`);
      const disk = phone.platform === 'android' ? (await c.run(['shell', 'df', '-h', '/data']).catch(() => '')).trim().split('\n').at(-1) : 'n/a';
      return `picture generated; disk guard SKIPPED (disk not nearly full: ${disk}); ${await alive(phone, baseline)}`;
    });
  }

  if (only.includes('d7')) {
    await step('d7-dictation', async () => {
      if (phone.platform === 'android') await c.run(['shell', 'pm', 'grant', APP_ID, 'android.permission.RECORD_AUDIO']);
      await openNewChat(phone);
      await clearComposer(phone);
      const draft = await composerText(phone);
      if (draft) throw new Error(`could not clear a leftover draft from the composer: "${draft}"`);
      const mic = await c.waitForLabel('voice-record-button', { timeoutMs: 15_000 });
      await c.tap(mic.center.x, mic.center.y);
      await c.waitFor(async () => (await c.labels()).some((l) => /Stop voice recording|tap-to-stop-hint|recording-hint/.test(l)), {
        label: 'recording to start',
        timeoutMs: 20_000,
      });
      await sleep(800);
      const file = join(tmpdir(), 'offgrid-e2e-dictation.aiff');
      await exec('say', ['-v', 'Samantha', '-o', file, sentence]);
      await exec('osascript', ['-e', 'set volume output volume 90']);
      await exec('afplay', [file]);
      await sleep(800);
      const stop = (await c.findByLabel('Stop voice recording')) ?? mic;
      await c.tap(stop.center.x, stop.center.y);
      await c.waitForGone('Transcribing...', { timeoutMs: 120_000 }).catch(() => undefined);
      await sleep(1_000);
      const value = await composerText(phone);
      const words = sentence.split(' ').filter((w) => w.length > 3);
      const heard = words.filter((w) => value.toLowerCase().includes(w));
      if (heard.length < 2) throw new Error(`the input after dictation reads "${value}" (said: "${sentence}")`);
      return `input: "${value}"`;
    });
  }

  if (only.includes('d8')) {
    await step('d8-tools-on-off', async () => {
      const on = await breadTurn(phone, run, 'tools-on');
      // Every tools switch OFF, through Quick settings -> Tools, then the Pro Tools screen from there.
      let core = [];
      let pro = [];
      try {
        await openNewChat(phone);
        core = await viaQuickSettings(phone, 'quick-tools', () => flipSwitches(phone, false));
        pro = await viaQuickSettings(phone, 'quick-pro-tools', () => flipSwitches(phone, false));
        const off = await breadTurn(phone, run, 'tools-off');
        const data = { on, off, switchedOff: { core, pro } };
        await writeFile(join(run.dir, 'd8-tools-on-off.json'), JSON.stringify(data, null, 2));
        if (off.refused) {
          throw new Error(`REFUSAL WITH TOOLS OFF (${off.sent}; counts ${JSON.stringify(off.counts)}): ${off.reply.slice(0, 300)}`);
        }
        if (off.empty) throw new Error(`NO ANSWER WITH TOOLS OFF (only "Work done"; counts ${JSON.stringify(off.counts)})`);
        if (/\(\d+\)/.test(off.sent) && !/\(0\)/.test(off.sent)) {
          throw new Error(`tools still sent with every switch off: "${off.sent}"`);
        }
        return `DATA tools-on [${JSON.stringify(on.counts)} ${on.sent}] refused=${on.refused}: "${on.reply.slice(0, 160)}" || tools-off [${JSON.stringify(off.counts)} ${off.sent}] refused=${off.refused}: "${off.reply.slice(0, 160)}"`;
      } finally {
        // Put back exactly the switches this step turned off.
        await openNewChat(phone).catch(() => undefined);
        if (core.length) await viaQuickSettings(phone, 'quick-tools', () => flipSwitches(phone, true, core)).catch(() => undefined);
        if (pro.length) await viaQuickSettings(phone, 'quick-pro-tools', () => flipSwitches(phone, true, pro)).catch(() => undefined);
        const restored = await toolCounts(phone).catch(() => null);
        console.log(`    d8 restore: turned back on ${core.length} tool(s) + ${pro.length} pro switch(es); quick settings now ${JSON.stringify(restored)} (was ${JSON.stringify(on.counts)})`);
      }
    });
  }
});
