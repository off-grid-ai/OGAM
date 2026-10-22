/**
 * Crash-fix smoke, on a real phone: the paths behind this branch's production crash fixes, driven
 * hard, with the process watched after every step.
 *
 *   node scripts/e2e/crash-smoke-journey.mjs --platform android|ios|both [--model Qwen3.5-2B-Q4_K_M]
 *
 * After EVERY step:
 *   Android  `pidof ai.offgridmobile.dev` is the pid the cold start produced (no silent restart), and
 *            `adb logcat -b crash,main` since the start has no "FATAL", "Fatal signal" or
 *            "ForegroundServiceDidNotStart".
 *   iOS      the app is still in the foreground (XCUIApplicationState 4) and no new crash report for
 *            it appeared in the device's crash logs (`idevicecrashreport`-free: devicectl lists the
 *            CrashReporter folder when available; otherwise the foreground check stands alone).
 *
 * Steps:
 *   cold-start        force-stop, launch, home screen up. Records the pid.
 *   chats-to-end      Chats tab, scroll to the last conversation.
 *   eject-mid-reply   load the text model, send a long prompt, and while it streams eject the text
 *                     model from the chat's model picker.
 *   voice-cycles      voice mode: start and stop the mic 6 times.
 *   bg-fg-sync        Sync set discoverable, then background/foreground the app 3 times fast.
 *   download-cancel   start a model download from Models, then cancel it.
 *
 * Resets: clears the device logcat buffers at the start (so "since the start" is exact); grants the
 * microphone (voice-cycles needs it); may switch "Discoverable to new devices" ON (said in the result).
 * Adds one short conversation. Downloads nothing to completion.
 */
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APP_ID, flag, openNewChat, runJourney, selectTextModel, sendPrompt, sleep, toHome, waitStreaming } from './device-journey.mjs';

const model = flag('model', 'Qwen3.5-2B-Q4_K_M');
// --only chats,eject,voice,bgfg,download re-runs single steps; cold-start always runs (it records the pid).
const only = flag('only', 'chats,eject,voice,bgfg,download').split(',');
const FATAL = /FATAL|Fatal signal|ForegroundServiceDidNotStart/;

const adb = (phone, args) => phone.client.run(args);

/** The process watcher: one per platform, same questions. */
function watcher(phone, run) {
  if (phone.platform === 'android') {
    let pid = null;
    return {
      async start() {
        await adb(phone, ['logcat', '-b', 'crash', '-b', 'main', '-c']);
      },
      async capture() {
        pid = (await adb(phone, ['shell', 'pidof', APP_ID])).trim();
        return pid;
      },
      async check(step) {
        const now = (await adb(phone, ['shell', 'pidof', APP_ID]).catch(() => '')).trim();
        const log = await adb(phone, ['logcat', '-b', 'crash', '-b', 'main', '-d']);
        // The buffers are phone-wide (a shell `dmesg` killed by seccomp logs "Fatal signal" too); only
        // lines from our process, or naming our package, count.
        const ownLine = (line) => line.includes(APP_ID) || (pid && line.match(/^\S+\s+\S+\s+(\d+)\s/)?.[1] === pid);
        const bad = log.split('\n').filter((line) => FATAL.test(line) && ownLine(line));
        await writeFile(join(run.dir, `logcat-after-${step}.txt`), bad.join('\n') || '(no FATAL / Fatal signal / ForegroundServiceDidNotStart)');
        if (bad.length) {
          await writeFile(join(run.dir, `logcat-full-${step}.txt`), log);
          throw new Error(`logcat after ${step}: ${bad.slice(0, 3).join(' || ')}`);
        }
        if (!now) throw new Error(`after ${step} the app process is gone (pid was ${pid})`);
        if (now !== pid) throw new Error(`after ${step} the app restarted: pid ${pid} -> ${now}`);
        return `pid ${now} unchanged, logcat clean`;
      },
    };
  }
  let baseline = '';
  const crashes = () => {
    try {
      return execFileSync(
        'xcrun',
        ['devicectl', 'device', 'info', 'files', '--device', phone.udid, '--domain-type', 'systemCrashLogs'],
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter((l) => /OffgridMobile|offgridmobile/i.test(l))
        .join('\n');
    } catch {
      return null;
    }
  };
  return {
    async start() {
      baseline = crashes() ?? '';
    },
    async capture() {
      return phone.client.appState(APP_ID);
    },
    async check(step) {
      const state = await phone.client.appState(APP_ID);
      if (state !== 4) throw new Error(`after ${step} the app is not in the foreground (state ${state})`);
      const now = crashes();
      if (now !== null && now !== baseline) {
        await writeFile(join(run.dir, `crashlogs-after-${step}.txt`), now);
        throw new Error(`after ${step} a new crash report appeared for the app`);
      }
      return `in foreground${now === null ? ' (crash-log listing unavailable)' : ', no new crash report'}`;
    },
  };
}

async function scrollToEnd(phone) {
  const c = phone.client;
  const { width, height } = await c.windowSize();
  let previous = '';
  for (let i = 0; i < 60; i += 1) {
    await c.swipe(width / 2, height * 0.8, width / 2, height * 0.2, 150);
    await sleep(350);
    const labels = (await c.labels()).filter((l) => /^conversation-item-\d+$/.test(l));
    const last = labels.at(-1) ?? '';
    if (last && last === previous) return last;
    previous = last;
  }
  return previous;
}

await runJourney('crash-smoke', async (phone, run) => {
  const c = phone.client;
  const watch = watcher(phone, run);
  const ids = { 'chats-to-end': 'chats', 'eject-mid-reply': 'eject', 'voice-cycles': 'voice', 'bg-fg-sync': 'bgfg', 'download-cancel': 'download' };
  const step = (name, fn) =>
    ids[name] && !only.includes(ids[name])
      ? undefined
      : run.step(phone, name, async () => {
      const detail = await fn();
      return `${detail ?? ''}; ${await watch.check(name)}`;
    });

  await step('cold-start', async () => {
    await watch.start();
    await phone.coldLaunch();
    await c.waitForLabel('home-tab', { timeoutMs: 60_000 });
    return `pid ${await watch.capture()}`;
  });

  await step('chats-to-end', async () => {
    await c.tapWhenReady('chats-tab', { timeoutMs: 15_000 });
    await sleep(1_500);
    const last = await scrollToEnd(phone);
    return `reached ${last || '(no conversations)'}`;
  });

  await step('eject-mid-reply', async () => {
    await openNewChat(phone);
    await selectTextModel(phone, model);
    await sendPrompt(phone, 'Write a detailed, long guide to growing tomatoes at home, at least 600 words.');
    await waitStreaming(phone, 180_000);
    await sleep(2_000);
    await c.tapWhenReady('model-selector', { timeoutMs: 10_000 });
    const eject = await c.waitForLabel('models-row-text-eject', { timeoutMs: 10_000 });
    await c.tap(eject.center.x, eject.center.y);
    await sleep(1_000);
    // An eject may ask to confirm; confirm it, that is the point of the step.
    const confirm = (await c.findByLabel('Eject')) ?? (await c.findByLabel('Unload'));
    if (confirm && confirm.label.trim().length <= 8) await c.tap(confirm.center.x, confirm.center.y);
    await sleep(4_000);
    for (let i = 0; i < 3 && (await c.findByLabel('app-sheet-close')); i += 1) {
      await c.tapLabel('app-sheet-close');
      await sleep(700);
    }
    await c.waitForLabel('chat-input', { timeoutMs: 30_000 });
    return 'ejected the text model while it was replying';
  });

  await step('voice-cycles', async () => {
    if (phone.platform === 'android') await adb(phone, ['shell', 'pm', 'grant', APP_ID, 'android.permission.RECORD_AUDIO']);
    await c.tapWhenReady('chat-mode-toggle', { timeoutMs: 10_000 });
    const mic = await c.waitForLabel('voice-record-button-audio', { label: 'the voice-mode mic', timeoutMs: 20_000 });
    for (let i = 0; i < 6; i += 1) {
      await c.tap(mic.center.x, mic.center.y); // start
      await sleep(1_500);
      await c.tap(mic.center.x, mic.center.y); // stop
      await sleep(1_500);
    }
    // Back to chat mode so later journeys find a text composer.
    await c.tapLabel('chat-mode-toggle').catch(() => undefined);
    await sleep(1_500);
    return 'voice mode: mic started and stopped 6 times';
  });

  await step('bg-fg-sync', async () => {
    await toHome(phone);
    await c.tapWhenReady('open-sync-from-home', { timeoutMs: 15_000 });
    await sleep(2_000);
    let note = 'already discoverable';
    const sw = await c.findByLabel('Discoverable to new devices');
    if (phone.platform === 'android') {
      const xml = await phone.sourceXml();
      const on = /content-desc="Discoverable to new devices"[^>]*checked="true"|checked="true"[^>]*content-desc="Discoverable to new devices"/.test(xml);
      if (!on && sw) {
        await c.tap(sw.center.x, sw.center.y);
        note = 'switched Discoverable ON';
      }
    }
    for (let i = 0; i < 3; i += 1) {
      if (phone.platform === 'android') {
        await adb(phone, ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
        await sleep(400);
        await adb(phone, ['shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1']);
      } else {
        await c.terminate('com.apple.Preferences').catch(() => undefined);
        await c.activate('com.apple.Preferences');
        await sleep(400);
        await c.activate(APP_ID);
      }
      await sleep(600);
    }
    await sleep(3_000);
    return `${note}; backgrounded and foregrounded 3 times`;
  });

  await step('download-cancel', async () => {
    await toHome(phone);
    await c.tapWhenReady('models-tab', { timeoutMs: 15_000 });
    await sleep(1_500);
    const labels = await c.labels();
    const button = labels.find((l) => /^pick-(fast|balanced|best)-download$/.test(l));
    if (!button) throw new Error('no pick on the Text tab offers a download (all downloaded?)');
    const slot = button.replace(/-download$/, '');
    await c.tapWhenReady(button, { timeoutMs: 10_000 });
    await c.waitFor(
      async () => {
        const now = await c.labels();
        return now.some((l) => l === `${slot}-progress` || /Cancel download|Pause download/.test(l));
      },
      { label: 'the download to start', timeoutMs: 30_000 },
    );
    await sleep(3_000);
    const cancel = await c.waitForLabel('Cancel download', { timeoutMs: 10_000 });
    await c.tap(cancel.center.x, cancel.center.y);
    await sleep(1_000);
    const confirm = await c.findByLabel('Cancel Download');
    if (confirm) await c.tap(confirm.center.x, confirm.center.y);
    await c.waitForLabel(button, { label: 'the Download button to come back after Cancel', timeoutMs: 30_000 });
    return `started and cancelled ${button}`;
  });
});
