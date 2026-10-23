/**
 * The shared spine of the single-phone journeys: pick the platforms, reach each phone, record
 * evidence, report a verdict per step.
 *
 * The mesh suite (run-flows / sync-surface) drives several surfaces at once and is about Sync. These
 * journeys drive ONE phone at a time and are about what jest can only prove against fakes - a real
 * engine, a real permission prompt, a real accessibility tree. They reuse the same drivers
 * (scripts/ios/wda-client.mjs, scripts/android/adb-client.mjs), so a locator that works here works
 * there.
 *
 *   node scripts/e2e/<journey>.mjs --platform ios|android|both [--wda http://<phone-ip>:8100] [--serial <adb serial>]
 *
 * Evidence: .artifacts/device-e2e/<timestamp>/<journey>/<platform>/  - a PNG screenshot, the visible
 * labels and the raw accessibility tree before and after every step, plus result.json.
 *
 * Every assertion reads what a person sees (labels / text on screen, or the OS alert), never a log.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdbClient } from '../android/adb-client.mjs';
import { WdaClient } from '../ios/wda-client.mjs';

export const APP_ID = process.env.E2E_APP_ID ?? 'ai.offgridmobile.dev';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const safe = (value) => String(value).replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

/** Text with every regular-expression metacharacter escaped, so it matches only itself. */
export const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** A case-insensitive pattern that finds `text` literally: CLI flags and labels are never patterns. */
export const literalPattern = (text) => new RegExp(escapeRegExp(text), 'i');

/** `--name value` from argv, else the fallback. A bare `--name` is "true". */
export function flag(name, fallback) {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const next = args[at + 1];
  return next === undefined || next.startsWith('--') ? 'true' : next;
}

export function platformsFromArgs() {
  const asked = flag('platform', process.env.E2E_PLATFORM ?? 'both').toLowerCase();
  if (asked === 'both') return ['ios', 'android'];
  if (asked === 'ios' || asked === 'android') return [asked];
  throw new Error(`--platform must be ios, android or both (got ${asked})`);
}

/**
 * Where WDA is. --wda, then WDA_URL, then the newest "WDA serving at" line in the launcher's log
 * (WDA_LOG, default .artifacts/device-e2e/wda.log) - the phone's IP changes, the log does not lie.
 */
function wdaUrl() {
  const explicit = flag('wda', process.env.WDA_URL);
  if (explicit) return explicit;
  const log = process.env.WDA_LOG ?? '.artifacts/device-e2e/wda.log';
  if (existsSync(log)) {
    const urls = [...readFileSync(log, 'utf8').matchAll(/WDA serving at (\S+)/g)];
    if (urls.length) return urls[urls.length - 1][1];
  }
  return null;
}

/** The one attached adb device, or --serial. Throws when none or several are attached. */
async function adbSerial() {
  const explicit = flag('serial', process.env.E2E_ANDROID_SERIAL);
  if (explicit) return explicit;
  const listed = await AdbClient.listDevices();
  if (listed.length === 1) return listed[0];
  if (!listed.length) {
    throw new Error(
      'No Android device answers adb (`adb devices` is empty). Enable USB debugging on the phone, ' +
        'accept the "Allow USB debugging" prompt, and set USB mode to File transfer.',
    );
  }
  throw new Error(`Several adb devices attached; pass --serial (${listed.join(', ')})`);
}

/**
 * Reach the phone with the app in front, without relaunching it.
 *
 * Answers a `Phone`: the platform client plus the few verbs that differ by platform (cold launch,
 * permission reset, OS alert). Everything else is the shared client surface.
 */
export async function connectPhone(platform) {
  if (platform === 'ios') {
    const url = wdaUrl();
    if (!url) throw new Error('No WDA URL. Start WDA (nohup node scripts/ios/launch-wda.mjs) or pass --wda.');
    const client = new WdaClient(url);
    if (!(await client.isReady())) {
      throw new Error(`WDA at ${url} is not answering. Is the launcher running and the phone unlocked?`);
    }
    await client.attachOrCreate(APP_ID);
    if ((await client.appState(APP_ID)) !== 4) await client.activate(APP_ID);
    // Every tap, swipe and keystroke from here on checks the app is in front first.
    client.requireForeground(APP_ID);
    return iosPhone(client);
  }
  const client = new AdbClient(await adbSerial());
  if (!(await client.isReady())) throw new Error('The Android device stopped answering adb.');
  await client.session(APP_ID);
  // Every tap, swipe, keystroke and key event from here on checks the app is in front first.
  client.requireForeground(APP_ID);
  return androidPhone(client);
}

const iosPhone = (client) => ({
  platform: 'ios',
  client,
  /** The phone's UDID, for devicectl checks. */
  udid: flag('udid', process.env.WDA_UDID),
  async coldLaunch() {
    await client.terminate(APP_ID).catch(() => false);
    await sleep(1_000);
    await client.launch(APP_ID);
  },
  /** Put the microphone permission back to "not determined". iOS kills the app as it does it. */
  async resetMicPermission() {
    await client.resetAuthorization(5);
    await sleep(1_500);
    await client.launch(APP_ID);
  },
  async micPermissionState() {
    return 'unknown on iOS (read from the alert, not the OS)';
  },
  /** The OS permission alert, as { text, buttons }, or null. */
  async systemAlert() {
    const text = await client.alertText().catch(() => null);
    if (!text) return null;
    return { text, buttons: await client.alertButtons().catch(() => []) };
  },
  async allowSystemAlert() {
    const alert = await this.systemAlert();
    const allow = alert?.buttons.find((b) => /^(allow|ok)$/i.test(b)) ?? alert?.buttons.at(-1);
    await client.acceptAlert(allow);
  },
  sourceXml: () => client.sourceXml(),
});

const androidPhone = (client) => ({
  platform: 'android',
  client,
  serial: client.serial,
  async coldLaunch() {
    await client.restart(APP_ID);
  },
  /**
   * Back to "ask next time": revoke, then clear the user-set / user-fixed flags - a plain revoke
   * leaves "don't ask again" in place and the OS would never show the prompt.
   */
  async resetMicPermission() {
    await client.shell(['pm', 'revoke', APP_ID, 'android.permission.RECORD_AUDIO']).catch(() => '');
    await client
      .shell(['pm', 'clear-permission-flags', APP_ID, 'android.permission.RECORD_AUDIO', 'user-set', 'user-fixed'])
      .catch(() => '');
    await client.restart(APP_ID);
  },
  async micPermissionState() {
    const out = await client.shell(['dumpsys', 'package', APP_ID]);
    return /android\.permission\.RECORD_AUDIO: granted=true/.test(out) ? 'granted' : 'not granted';
  },
  /** The permission controller's dialog, read from the same tree a person sees. */
  async systemAlert() {
    const xml = await client.sourceXml();
    if (!/package="com\.(google\.)?android\.permissioncontroller"/.test(xml)) return null;
    const texts = [...xml.matchAll(/text="([^"]+)"/g)].map((m) => m[1]);
    return { text: texts.join(' | '), buttons: texts.filter((t) => /allow|while using|only this time|don.t/i.test(t)) };
  },
  async allowSystemAlert() {
    const button =
      (await client.findByLabel('While using the app')) ??
      (await client.findByLabel('Only this time')) ??
      (await client.findByLabel('Allow'));
    if (!button) throw new Error('the permission dialog offers no Allow button');
    await client.tap(button.center.x, button.center.y);
  },
  sourceXml: () => client.sourceXml(),
});

/**
 * One journey's run on one phone: evidence directory, snapshots, step verdicts.
 */
export class JourneyRun {
  constructor(journey, platform, stamp) {
    this.journey = journey;
    this.platform = platform;
    this.dir = join('.artifacts', 'device-e2e', stamp, journey, platform);
    this.steps = [];
    this.shot = 0;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    return this;
  }

  /** Screenshot + visible labels + raw tree, numbered so the folder reads in order. */
  async snap(phone, name) {
    this.shot += 1;
    const base = join(this.dir, `${String(this.shot).padStart(2, '0')}-${safe(name)}`);
    await phone.client.screenshot(`${base}.png`).catch(() => {});
    const labels = await phone.client.labels().catch((error) => [`(labels failed: ${error.message})`]);
    await writeFile(`${base}.labels.txt`, labels.join('\n'));
    const xml = await phone.sourceXml().catch(() => null);
    if (xml) await writeFile(`${base}.tree.xml`, xml);
    return labels;
  }

  /** A named step: snapshot before, run, snapshot after, record the verdict. Throws on failure. */
  async step(phone, name, fn) {
    const started = Date.now();
    await this.snap(phone, `${name}-before`);
    try {
      const detail = (await fn()) ?? '';
      await this.snap(phone, `${name}-after`);
      // A step that finds it cannot run here says so by answering "SKIPPED: <why>".
      const skipped = /^SKIPPED:/.test(detail);
      this.steps.push({ step: name, ok: skipped ? null : true, detail, ms: Date.now() - started });
      console.log(`  ${skipped ? 'SKIP' : 'PASS'}  ${name}${detail ? `  - ${detail}` : ''}`);
      return detail;
    } catch (error) {
      await this.snap(phone, `${name}-FAILED`);
      this.steps.push({ step: name, ok: false, detail: error.message, ms: Date.now() - started });
      console.log(`  FAIL  ${name}  - ${error.message.split('\n')[0]}`);
      throw error;
    }
  }

  /** A step that cannot run here, with the reason printed - never a silent pass. */
  skip(name, reason) {
    this.steps.push({ step: name, ok: null, detail: `SKIPPED: ${reason}` });
    console.log(`  SKIP  ${name}  - ${reason}`);
  }

  async finish(extra = {}) {
    const failed = this.steps.some((s) => s.ok === false);
    const result = { journey: this.journey, platform: this.platform, ok: !failed, steps: this.steps, ...extra };
    await writeFile(join(this.dir, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  }
}

/**
 * Run `body(phone, run)` on every requested platform, one after the other, and exit non-zero when any
 * platform failed. A platform that cannot be reached is a FAIL with the reason, not a skip.
 */
export async function runJourney(journey, body) {
  const stamp = flag('stamp', process.env.E2E_STAMP ?? new Date().toISOString().replace(/[:.]/g, '-'));
  const results = [];
  for (const platform of platformsFromArgs()) {
    console.log(`\n=== ${journey} on ${platform} ===`);
    const run = await new JourneyRun(journey, platform, stamp).init();
    let phone;
    try {
      phone = await connectPhone(platform);
      await body(phone, run);
    } catch (error) {
      if (!run.steps.some((s) => s.ok === false)) {
        run.steps.push({ step: 'setup', ok: false, detail: error.message });
        console.log(`  FAIL  setup  - ${error.message.split('\n')[0]}`);
      }
    }
    results.push(await run.finish());
    console.log(`  evidence: ${run.dir}`);
  }
  console.log(`\n--- ${journey} ---`);
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.platform}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
  return results;
}

// ---------------------------------------------------------------------------------------------
// App verbs shared by the journeys. Named for what a person does, addressed by testID.
// ---------------------------------------------------------------------------------------------

/** Exact-label presence, because findByLabel is a substring match (`send-button` vs `send-button-x`). */
export async function hasLabel(phone, label) {
  return (await phone.client.labels()).some((l) => l.trim() === label);
}

/** Close whatever sheet a previous run left open, then land on a tab screen. */
export async function toHome(phone) {
  const c = phone.client;
  // Android: the input guard aborts a step when another app is in front and never relaunches
  // mid-gesture. A new step starts here, so this is where the app is put back in front.
  if (phone.platform === 'android' && !(await c.focusedWindow().catch(() => '')).includes(APP_ID)) {
    await c.session(APP_ID);
    await sleep(2_000);
  }
  // A cold start (or a Metro reload) shows the startup screen for several seconds. Hardware Back
  // there finishes the Android activity and drops the run onto the launcher, so wait it out first.
  const starting = (labels) => !labels.length || labels.includes('app-loading') || labels.includes('startup-loading-dots');
  await c.waitFor(async () => !starting(await c.labels()), { label: 'the app to finish starting', timeoutMs: 60_000 }).catch(() => undefined);
  for (let i = 0; i < 4; i += 1) {
    const labels = await c.labels();
    if (labels.includes('home-tab') && !labels.includes('app-sheet-close')) break;
    if (starting(labels)) {
      await sleep(1_500);
      continue;
    }
    if (labels.includes('app-sheet-close')) await c.tapLabel('app-sheet-close');
    // The stack header's own Back control first: an edge swipe is unreliable over RN screens.
    else if (labels.includes('Back')) await c.tapLabel('Back');
    else await c.back();
    await sleep(800);
  }
  await c.tapWhenReady('home-tab', { timeoutMs: 20_000 });
  await sleep(600);
}

export async function openNewChat(phone) {
  await toHome(phone);
  await phone.client.tapWhenReady('new-chat-button', { timeoutMs: 30_000 });
  await phone.client.waitForLabel('chat-input', { label: 'a new chat composer', timeoutMs: 30_000 });
}

/**
 * Make `rowNeedle` the active text model from the chat header, waiting for it to load.
 * rowNeedle is a substring of the row testID `text-model-row-<model id>`.
 */
export async function selectTextModel(phone, rowNeedle) {
  const c = phone.client;
  // The header control ignores a tap while a sheet is still closing; tap again until the sheet is up.
  // A sheet still closing (e.g. after Eject all) also shows models-row-text, then vanishes; so the
  // sheet counts as open only once the row holds still.
  let slot = null;
  for (let attempt = 0; !slot; attempt += 1) {
    await c.tapWhenReady('model-selector', { timeoutMs: 20_000 });
    const up = await c.waitForLabel('models-row-text', { timeoutMs: 6_000 }).catch(() => null);
    // The sheet slides in; a tap read mid-animation lands where the row USED to be.
    if (up) slot = await c.waitForStable('models-row-text').catch(() => null);
    if (!slot && attempt >= 2) throw new Error('the Models sheet did not open from the chat header (3 taps)');
  }
  await c.tap(slot.center.x, slot.center.y);
  await c.waitForLabel('text-model-row-', { timeoutMs: 20_000 });
  // The row id is `text-model-row-<repo>/<file>`; the caller names the file, so find the full id first.
  let rowId;
  for (let i = 0; i < 10 && !rowId; i += 1) {
    rowId = (await c.labels()).find((l) => l.startsWith('text-model-row-') && l.includes(rowNeedle));
    if (!rowId) {
      const { width, height } = await c.windowSize();
      await c.swipe(width / 2, height * 0.75, width / 2, height * 0.45);
      await sleep(500);
    }
  }
  if (!rowId) {
    const rows = (await c.labels()).filter((l) => l.startsWith('text-model-row-'));
    throw new Error(`no text model row matches "${rowNeedle}". Rows on this phone: ${rows.join(', ')}`);
  }
  const row = await c.scrollToLabel(rowId, { maxSwipes: 6 });
  await c.tap(row.center.x, row.center.y);
  // Loading shows a spinner row; the sheet settles once the model is resident.
  await c.waitForGone('model-row-loading', { timeoutMs: 180_000 }).catch(() => undefined);
  await sleep(1_500);
  for (let i = 0; i < 3 && (await c.findByLabel('app-sheet-close')); i += 1) {
    await c.tapLabel('app-sheet-close');
    await sleep(800);
  }
  await c.waitForLabel('chat-input', { timeoutMs: 30_000 });
}

/** Type into the composer and press Send. */
export async function sendPrompt(phone, text) {
  const c = phone.client;
  await c.tapWhenReady('chat-input', { timeoutMs: 20_000 });
  await sleep(400);
  if (phone.platform === 'ios') await c.replaceTestId('chat-input', text);
  // `adb shell input text` goes through the device's shell: escape what sh would expand (? * etc.).
  else await c.type(text.replace(/([?&|;<>()$`"'*\\!#~])/g, '\\$1'));
  await sleep(500);
  if (phone.platform === 'ios') await c.hideKeyboard?.().catch(() => undefined);
  await c.tapWhenReady('send-button', { timeoutMs: 20_000 });
}

/** A reply is streaming: the Stop control is what a person sees while tokens arrive. */
export async function waitStreaming(phone, timeoutMs = 120_000) {
  const seen = await phone.client.waitFor(
    async (c) => {
      const labels = (await c.labels()).map((l) => l.trim());
      // A memory refusal is an answer, not a slow start: name it instead of timing out.
      if (labels.includes('Insufficient Memory')) {
        return { refused: labels.find((l) => /^Not enough memory/.test(l)) ?? 'Insufficient Memory' };
      }
      return labels.includes('stop-button') ? { streaming: true } : null;
    },
    { label: 'the Stop control (reply streaming)', timeoutMs },
  );
  if (seen.refused) throw new Error(`the app refused to load the model: ${seen.refused}`);
}

/**
 * The reply settled: Stop is gone, nothing is still streaming, and the composer is back.
 * (Send only renders while the composer holds text, so it is not the signal.)
 */
export async function waitSettled(phone, timeoutMs = 300_000) {
  const live = ['stop-button', 'thinking-indicator', 'streaming-cursor', 'streaming-thinking-hint'];
  await phone.client.waitFor(
    async (c) => {
      const labels = (await c.labels()).map((l) => l.trim());
      return labels.includes('chat-input') && !live.some((l) => labels.includes(l));
    },
    { label: 'the reply to finish (Stop gone, composer back)', timeoutMs, intervalMs: 1_500 },
  );
}

/**
 * The visible text of the newest reply: every text on screen BELOW the newest user message and ABOVE
 * the composer, minus testIDs and chrome. That is what a person (or a screen reader) reads as the reply.
 *
 * Located by geometry, not by tree order: the chat list is inverted on some builds, so the order WDA
 * or uiautomator reports rows in says nothing about which is newest, while "lowest on screen, just
 * above the composer" always is.
 */
export async function lastAssistantText(phone) {
  const tree = await phone.client.source();
  const nodes = [];
  const walk = (n) => {
    if (!n) return;
    if (n.rect && n.rect.width > 0 && n.rect.height > 0) nodes.push(n);
    (n.children || []).forEach(walk);
  };
  walk(tree);
  const ids = (n) => [n.label, n.name, n.value].map((f) => `${f ?? ''}`.trim());
  const composer = nodes.find((n) => ids(n).includes('chat-input'));
  if (!composer) return '';
  const bottom = composer.rect.y;
  const users = nodes.filter((n) => ids(n).includes('user-message') && n.rect.y < bottom);
  // A long reply scrolls its user message (and its own top, y < 0) off screen; the band below would
  // then hold only the header. iOS merges the whole reply into the `assistant-message` label: use it.
  if (!users.length) {
    const replies = nodes.filter((n) => ids(n).includes('assistant-message') && n.rect.y < bottom);
    const merged = replies.sort((a, b) => b.rect.y - a.rect.y)[0]?.label?.trim();
    if (merged && merged !== 'assistant-message') return merged;
  }
  const top = users.length ? Math.max(...users.map((n) => n.rect.y + n.rect.height)) : 0;
  const isId = (l) => /^[a-z0-9]+(-[a-z0-9_]+)+$/i.test(l) || /^(tts-button|tool-result)/.test(l);
  const isChrome = (l) =>
    /^(Vertical|Horizontal) scroll bar|^\d+%$|^•••$|^Assistant$|^Type a message|^Generation details$|^, Tools sent in request|^Tools sent in request|^\d{1,2}:\d{2}\s?(AM|PM)?$|^\d+(\.\d+)?s$/.test(l);
  const lines = [];
  for (const n of nodes) {
    if (n.rect.y < top - 1 || n.rect.y + n.rect.height > bottom + 1) continue;
    for (const f of [n.label, n.value]) {
      const t = `${f ?? ''}`.trim();
      if (t && !isId(t) && !isChrome(t) && !lines.includes(t)) lines.push(t);
    }
  }
  return lines.join(' | ');
}

/**
 * Send has been pressed: wait for the reply to START (Stop up, or reply text that is not the
 * "Loading <model>..." placeholder), then for it to settle. Settling alone is not enough - before
 * the model loads there is no Stop either, and the run would read the loading line as the answer.
 */
export async function waitForReply(phone, timeoutMs = 300_000) {
  const loading = /^Loading .*\.\.\.$|^(Working|Thinking\.\.\.)$/;
  const started = Date.now();
  const seen = await phone.client.waitFor(
    async (c) => {
      if (await c.findByLabel('stop-button')) return { started: true };
      const labels = (await c.labels()).map((l) => l.trim());
      // A memory refusal is the app's answer, not a slow start: name it instead of timing out.
      if (labels.includes('Insufficient Memory')) {
        return { refused: labels.find((l) => /^Not enough memory/.test(l)) ?? 'Insufficient Memory' };
      }
      const text = await lastAssistantText(phone);
      return text && !text.split(' | ').every((line) => loading.test(line)) ? { started: true } : null;
    },
    { label: 'the reply to start (Stop shown or words in the reply)', timeoutMs, intervalMs: 1_000 },
  );
  if (seen.refused) throw new Error(`the app refused to load the model: ${seen.refused}`);
  await waitSettled(phone, Math.max(30_000, timeoutMs - (Date.now() - started)));
}

/**
 * Unload every resident model (Models sheet -> Eject all models -> Eject), so a step starts from the
 * same memory every run instead of inheriting whatever the previous step left loaded.
 */
export async function ejectAllModels(phone) {
  const c = phone.client;
  await c.tapWhenReady('model-selector', { timeoutMs: 15_000 });
  await c.waitForLabel('models-row-text', { timeoutMs: 15_000 });
  const eject = await c.scrollToLabel('Eject all models', { maxSwipes: 3 }).catch(() => null);
  if (eject) {
    await c.tap(eject.center.x, eject.center.y);
    const confirm = await c
      .waitFor(async () => {
        const el = await c.findByLabel('Eject');
        return el && el.label.trim() === 'Eject' ? el : null;
      }, { label: 'the Eject confirmation', timeoutMs: 8_000 })
      .catch(() => null);
    if (confirm) await c.tap(confirm.center.x, confirm.center.y);
    await sleep(2_500);
  }
  for (let i = 0; i < 3 && (await c.findByLabel('app-sheet-close')); i += 1) {
    await c.tapLabel('app-sheet-close');
    await sleep(700);
  }
  await sleep(1_500);
  return Boolean(eject);
}

/** The composer's current text, read from the native tree (what the person sees in the field). */
export async function composerText(phone) {
  const xml = await phone.sourceXml();
  const field = xml.match(/<[^>]*(name|resource-id)="[^"]*chat-input"[^>]*>/)?.[0] ?? '';
  const value = field.match(/ (value|text)="([^"]*)"/)?.[2] ?? '';
  return /^Type a message/.test(value) ? '' : value;
}

/** Empty the composer, so a dictation or prompt is not appended to a leftover draft. */
export async function clearComposer(phone) {
  if (!(await composerText(phone))) return;
  if (phone.platform === 'ios') {
    await phone.client.replaceTestId('chat-input', '');
  } else {
    await phone.client.tapWhenReady('chat-input');
    await phone.client.run(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
    await phone.client.run(['shell', 'input', 'keyevent', ...Array(120).fill('KEYCODE_DEL')]);
  }
  await sleep(500);
}

/** Minimal XML element walker -> { tag, attrs, children, parent }. Both trees are flat attribute XML. */
export function parseXml(xml) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<(\/?)([A-Za-z][\w.-]*)\b([^>]*?)(\/?)>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, closing, tag, attrText, selfClosing] = m;
    if (closing) {
      if (cur.parent) cur = cur.parent;
      continue;
    }
    const attrs = {};
    for (const a of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      attrs[a[1]] = a[2]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#(\d+);/g, (_, v) => String.fromCodePoint(Number(v)))
        .replace(/&amp;/g, '&');
    }
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!selfClosing) cur = node;
  }
  return root;
}

export function* walkXml(node) {
  yield node;
  for (const child of node.children) yield* walkXml(child);
}

