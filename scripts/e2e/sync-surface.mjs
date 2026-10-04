/**
 * ONE vocabulary for Sync, on all four platforms.
 *
 * Every sync journey is the same handful of sentences - open Devices, read the code, pair with that
 * device, is it connected, send it a file - and none of them are platform questions. What differs is
 * only how you locate a thing on screen, and there are exactly two answers to that:
 *
 *   React Native (iOS, Android)  - testIDs, driven through WDA / adb
 *   Electron     (macOS, Windows) - the DOM, driven through the DevTools protocol
 *
 * So this file has two drivers and one interface. A test written against the interface runs on any
 * device, and a NEW capability is added once here rather than once per platform. That is the whole
 * point: three one-off scripts had already re-implemented "pair these two" three times, each with a
 * different set of hardcoded hostnames and roles, and each drifted.
 *
 * Devices are addressed by NAME, not by sync id. The id is the better key and the RN rows carry it in
 * their testIDs, but nothing puts it in the Electron DOM, so name is the only address both families
 * share. Names are unique enough in a personal mesh, and a test that says "pair with OGAD x.x.x.25"
 * reads like the thing a person does.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AdbClient } from '../android/adb-client.mjs';
import { WdaClient } from '../ios/wda-client.mjs';
import { ANDROID_PACKAGE, IOS_BUNDLE_ID } from './device.mjs';
import { selectMainOffGridPage } from './desktop-target.mjs';
import {
  CANCEL,
  CONFIRM_DESTRUCTIVE,
  DESKTOP,
  HIDDEN_STATUS,
  ROW_CONTROL,
  SHEET_TITLE,
} from './selectors.mjs';

const run = promisify(execFile);

/** The pairing-code alphabet is confusable-free, so a code is unambiguous to match for. */
const CODE = /\b([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4})\b/;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (check, { label, timeoutMs = 60_000, intervalMs = 1000 }) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (cause) {
      last = cause;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}${last ? `: ${last.message}` : ''}`);
    }
    await sleep(intervalMs);
  }
};

// ---------------------------------------------------------------------------------------------
// React Native surface (iOS, Android)
// ---------------------------------------------------------------------------------------------

/**
 * The RN apps put a testID on everything that matters, including the device id in the row's id -
 * `sync-pair-<id>`, `sync-paired-<id>`. Addressing is by name, so this walks the flat label list to
 * find the row's name and then takes the nearest action testID after it, which is that row's own.
 */
/**
 * Captions that sit next to the device card and are NOT the device's name. Listed once, because both
 * phones render the same card with the lines in a different order and each would otherwise need its
 * own guesswork.
 */
const CARD_CAPTIONS = new Set([
  'This device',
  'Discoverable',
  'Not discoverable',
  'Hidden',
  'PERSONAL MESH',
  'Rename this device',
  'Discoverable to new devices',
]);

const rnSurface = (client, platform) => {
  const controlFor = async (name, kinds) => {
    const labels = await client.labels();
    const at = labels.findIndex((label) => label.trim() === name);
    if (at < 0) return undefined;
    const pattern = new RegExp(`^sync-(${kinds.join('|')})-[0-9a-f]+$`);
    // Nearest match in BOTH directions. Android renders name-then-actions, iOS renders the actions
    // FIRST and the name after them - so scanning only forward found nothing on an iPhone and reported
    // "lists no pair control" for a saved Mac that was one Reconnect away.
    for (let step = 1; step <= 14; step += 1) {
      for (const index of [at + step, at - step]) {
        const label = labels[index];
        if (label && pattern.test(label)) return label;
      }
    }
    return undefined;
  };

  return {
    platform,
    family: 'rn',
    /** Low-level UI verbs shared by feature journeys. Feature rules stay in their own adapter. */
    ui: {
      source: () => client.source(),
      labels: () => client.labels(),
      findByLabel: (label) => client.findByLabel(label),
      tapLabel: (label) => client.tapLabel(label),
      tapWhenReady: (label, options) => client.tapWhenReady(label, options),
      waitForLabel: (label, options) => client.waitForLabel(label, options),
      waitForGone: (label, options) => client.waitForGone(label, options),
      scrollToLabel: (label, options) => client.scrollToLabel(label, options),
      scrollAndTap: (label, options) => client.scrollAndTap(label, options),
      type: (value) => client.type(value),
      replaceTestId: client.replaceTestId ? (testId, value) => client.replaceTestId(testId, value) : undefined,
      back: () => client.back(),
      hideKeyboard: client.hideKeyboard ? () => client.hideKeyboard() : undefined,
      keyboardTop: client.keyboardTop ? () => client.keyboardTop() : undefined,
      // Raw geometry. Needed where a system UI exposes nothing to address: the iOS photo picker
      // publishes only PXG* layout groups and one concatenated label, so its first cell can only be
      // reached by position.
      tap: client.tap ? (x, y) => client.tap(x, y) : undefined,
      windowSize: client.windowSize ? () => client.windowSize() : undefined,
      waitFor: (check, options) => client.waitFor(() => check(), options),
    },

    /**
     * Reach the Devices screen from wherever the app happens to be. Idempotent on purpose.
     *
     * A block every journey starts with cannot assume it starts from the home screen: the app is
     * usually already somewhere, often on Devices from the previous step. Insisting on home made this
     * fail with "timed out waiting for android home" while the Devices screen was on screen.
     */
    async openDevices() {
      const labels = await client.labels();
      if (labels.includes('sync-this-device')) return;
      if (!labels.includes('home-screen')) {
        // Back out to a tab bar, then home. Both RN apps carry home-tab on every tab screen.
        await client.tapLabel('home-tab').catch(async () => {
          await client.back().catch(() => {});
          await client.tapLabel('home-tab').catch(() => {});
        });
      }
      await client.waitForLabel('home-screen', { label: `${platform} home`, timeoutMs: 40_000 });
      // The sync entry point sits below the fold on a two-page home screen, so it is absent from the
      // accessibility tree until scrolled to - tapWhenReady alone times out.
      await client.scrollAndTap('open-sync-from-home', { timeoutMs: 30_000 });
      await client.waitForLabel('sync-this-device', { label: `${platform} Devices`, timeoutMs: 40_000 });
    },

    async text() {
      return (await client.labels()).join('\n');
    },

    /**
     * The name this device calls ITSELF, read off its own screen.
     *
     * Never passed in from a flow: a name typed into a script goes stale the moment someone renames a
     * device, which happened repeatedly while this was being built.
     */
    async deviceName() {
      const lines = (await client.labels()).map((line) => line.trim());
      const at = lines.indexOf('sync-this-device');
      if (at < 0) throw new Error(`no device card on ${platform}`);
      // Nearest usable neighbour in BOTH directions: iOS emits the name just before the marker,
      // Android just after, so a single-direction read is right on one phone and returns a caption on
      // the other.
      const usable = (line) =>
        Boolean(line) &&
        !line.startsWith('sync-') &&
        !CARD_CAPTIONS.has(line) &&
        !/^\d+$/.test(line) &&
        !/devices saved|connected|Let new devices/i.test(line);
      for (let step = 1; step <= 3; step += 1) {
        for (const index of [at - step, at + step]) {
          if (index >= 0 && index < lines.length && usable(lines[index])) return lines[index];
        }
      }
      throw new Error(`could not read the device name on ${platform}`);
    },

    async pairingCode() {
      await client.waitForLabel('sync-pairing-code-value', { label: 'the pairing code', timeoutMs: 20_000 });
      const code = (await client.labels()).map((l) => l.trim()).find((l) => CODE.test(l));
      if (!code) throw new Error(`${platform} shows the pairing-code section but no code`);
      return code;
    },

    async sees(name) {
      return (await client.labels()).some((label) => label.trim() === name);
    },

    async rescan() {
      await client.tapLabel('sync-rescan').catch(() => {});
    },

    async startPairing(name) {
      const control = await controlFor(name, ['pair', 'repair', 'reconnect']);
      if (!control) throw new Error(`${platform} lists no pair/repair control for "${name}"`);
      await client.tapLabel(control);
      return control;
    },

    /** Did a code prompt open? A reconnect on a held credential succeeds without one. */
    async waitForCodePrompt(timeoutMs = 20_000) {
      return client
        .waitForLabel('sync-pairing-code-input', { label: 'the code dialog', timeoutMs })
        .then(() => true)
        .catch(() => false);
    },

    async enterPairingCode(code) {
      // WAIT for the dialog: a reconnect is attempted first, so it arrives seconds later and a single
      // early sample reads as "no prompt appeared".
      await client.waitForLabel('sync-pairing-code-input', { label: 'the code dialog', timeoutMs: 45_000 });
      // Focus FIRST - adb `input text` goes to whatever holds focus, so typing into an unfocused
      // dialog silently does nothing and looks like a failed handshake.
      await client.tapLabel('sync-pairing-code-input');
      await sleep(800);
      await client.type(code.replace('-', ''));
      await sleep(800);
      await client.tapLabel('sync-pairing-code-confirm');
    },

    /**
     * The confirmation sheet currently covering the list, or undefined.
     *
     * Exposed because an open sheet makes every other read on this surface lie: the accessibility
     * label list is REPLACED by the sheet, so a device that is still connected reads as disconnected.
     * A flow that checks its own teardown has to be able to tell "gone" from "hidden behind a sheet".
     */
    async openSheet() {
      const labels = (await client.labels()).map((label) => label.trim());
      return labels.find((label) => SHEET_TITLE.test(label));
    },

    /**
     * End the session with a device, KEEPING its credential.
     *
     * The gentle teardown, and the one flows should reach for. Forget frees a licence seat and ends
     * trust everywhere; this only closes the link, so the pairing survives and the device comes back
     * with a tap rather than a code. Nothing about the licence moves.
     */
    async disconnect(name) {
      const control = await controlFor(name, ROW_CONTROL.disconnect);
      if (!control) throw new Error(`${platform} lists no disconnect control for "${name}"`);
      await client.tapLabel(control);
      // Confirmed on the platforms that ask, and a no-op on the ones that do not.
      await this.confirmDestructive(`disconnect ${name}`);
    },

    /**
     * Drop a saved device: its credential goes, so pairing with it needs the code again.
     *
     * Addressed through the row's own `sync-forget-<id>` control rather than a "Forget" label, because
     * every saved row carries one and only this row's is right.
     *
     * The confirmation is REQUIRED, not best-effort. It used to tap a guessed testID and swallow the
     * failure, which left the real sheet ("Evict 17 pro max?" / "Evict device") untouched - and since
     * that sheet hides the device list, the check that followed read the device as already gone. The
     * flow then paired against a credential that had never been dropped and called it a pass.
     */
    async forget(name) {
      const control = await controlFor(name, ROW_CONTROL.forget);
      if (!control) throw new Error(`${platform} lists no forget control for "${name}"`);
      await client.tapLabel(control);
      await this.confirmDestructive(`forget ${name}`);
    },

    /**
     * Go through with whatever destructive sheet just opened, and wait until it is gone.
     *
     * Returns false when the platform asked nothing - that is a real answer, not a failure, because
     * the same journey is confirmed on one platform and immediate on another. But a sheet that IS
     * open and offers nothing this knows how to press is a failure: pressing on would act on a screen
     * nobody can read.
     */
    async confirmDestructive(what) {
      const sheet = await waitUntil(() => this.openSheet(), {
        label: `a confirmation sheet for ${what} on ${platform}`,
        timeoutMs: 6_000,
        intervalMs: 500,
      }).catch(() => undefined);
      if (!sheet) return false;

      const labels = (await client.labels()).map((label) => label.trim());
      const confirm = CONFIRM_DESTRUCTIVE.find((candidate) => labels.includes(candidate));
      if (!confirm) {
        throw new Error(
          `${platform} opened "${sheet}" but offers none of ${CONFIRM_DESTRUCTIVE.join(', ')} - ` +
            `the sheet reads: ${labels.slice(0, 12).join(' / ')}`,
        );
      }
      await client.tapLabel(confirm);
      // Wait for it to CLOSE. Until it does, every read on this surface is the sheet's text rather
      // than the device list, and the caller's next assertion would be answered by the wrong screen.
      await waitUntil(async () => !(await this.openSheet()), {
        label: `the ${what} sheet on ${platform} to close`,
        timeoutMs: 20_000,
        intervalMs: 500,
      });
      return true;
    },

    /**
     * Turn this device's advertisement on or off, and report what it was before.
     *
     * Returns the PREVIOUS value so a flow can put it back exactly as it found it. Discoverability is
     * a privacy choice the user made and it persists across restarts, so a flow that leaves it off
     * has quietly changed a setting rather than tested one.
     */
    async setDiscoverable(on) {
      await client.waitForLabel('sync-toggle-discoverable', {
        label: 'the discoverability switch',
        timeoutMs: 20_000,
      });
      const was = await this.isDiscoverable();
      if (was !== on) await client.tapLabel('sync-toggle-discoverable');
      return was;
    },

    /**
     * Is this device advertising?
     *
     * Read from the card's STATUS LINE, not from the switch. The switch's on/off value is not in the
     * label tree on both phones - iOS emits a "1"/"0" beside the testID and Android emits nothing at
     * all - so a reader built on it works on one phone and throws on the other.
     *
     * The status line is a contract instead of an accident: the card prints it only when it says
     * something the switch does not, so a device that is simply discoverable shows NO status, and a
     * hidden one names itself. Anything else on that line (a health problem) is a device that is
     * still advertising, which is why this looks for the hidden words rather than for any status.
     */
    async isDiscoverable() {
      const labels = (await client.labels()).map((label) => label.trim());
      if (!labels.includes('sync-toggle-discoverable')) {
        throw new Error(`${platform} shows no discoverability switch`);
      }
      return !labels.some((label) => HIDDEN_STATUS.test(label));
    },

    /** Back out of an open sheet, leaving the mesh as it was. Used when a flow aborts mid-journey. */
    async dismissSheet() {
      if (!(await this.openSheet())) return false;
      const labels = (await client.labels()).map((label) => label.trim());
      const cancel = CANCEL.find((candidate) => labels.includes(candidate));
      if (cancel) await client.tapLabel(cancel);
      else await client.back().catch(() => {});
      return true;
    },

    async isConnectedTo(name) {
      const labels = (await client.labels()).map((label) => label.trim());
      const at = labels.findIndex((label) => label === name);
      if (at < 0) return false;
      // The NEAREST status line in either direction, then read what it says.
      //
      // Two mistakes are avoided here, and both produced wrong verdicts on a real screen. Scanning
      // only FORWARD is wrong because Android renders name-then-status while iOS renders the status
      // first: an iPhone showing "macos - Connected - Nearby" reported false, the same directional
      // bug as controlFor. And a loose /connected/i is wrong because the mesh summary line says
      // "3 connected", so any device looked connected the moment any one session was live.
      //
      // Reading the nearest status line rather than "is there a Connected line nearby" also keeps a
      // neighbouring row from answering for this one: rows sit next to each other, so a window wide
      // enough to find this row's status is wide enough to find the next row's too.
      // 14, not 8: a CONNECTED row carries more controls than a disconnected one (Disconnect, Send a
      // model, Forget), which pushes its status line nine labels past the name - so a window sized on
      // a disconnected row reports the connected one as not connected. Same span as controlFor.
      const STATUS = /^(\w+) - (.+)$/;
      for (let step = 1; step <= 14; step += 1) {
        for (const index of [at + step, at - step]) {
          const match = labels[index]?.match(STATUS);
          if (match) return /^Connected\b/.test(match[2]);
        }
      }
      return false;
    },

    /**
     * Leave the network for `ms`, then come back - scheduled on the DEVICE, before it goes.
     *
     * See goOffline in the shared notes below for why this is one self-restoring verb rather than an
     * off switch and an on switch. On a phone the reason is weaker (adb survives a Wi-Fi drop over
     * USB) but the shape is kept identical, because a flow that reads `goOffline(40_000)` should
     * mean the same thing whichever device it is handed.
     */
    async goOffline(ms) {
      if (platform !== 'android') {
        throw new Error(
          'an iPhone cannot be taken off the network from here: iOS exposes no radio control to WDA, ' +
            'and the Settings toggle is not reachable from the app under test. Use an Android, a Mac ' +
            'or the Windows box as the peer that goes away, or toggle it by hand.',
        );
      }
      const seconds = Math.ceil(ms / 1000);
      // Scheduled in one detached shell on the phone, for the same reason as the desktops: whatever
      // takes the network away must also be what brings it back, or a harness that dies mid-flow
      // leaves the device stranded.
      await client.shell([
        'sh',
        '-c',
        `'svc wifi disable; sleep ${seconds}; svc wifi enable' >/dev/null 2>&1 &`,
      ]);
    },

    screenshot: (path) => client.screenshot(path),
    close: async () => {},
  };
};

// ---------------------------------------------------------------------------------------------
// Electron surface (macOS, Windows)
// ---------------------------------------------------------------------------------------------

/**
 * The desktop apps are located by TEXT, because nothing puts the device id in their DOM.
 *
 * Driven over the DevTools protocol rather than the OS: macOS refuses synthetic clicks to an ssh
 * session (-25211) and the app publishes no accessibility tree at all (-1700 on every query), so a
 * DOM click through CDP is the only thing that works - and it is not an OS event, so nothing refuses
 * it. It also keeps the REAL profile, licence and identity, which a Playwright launch cannot.
 */
const electronSurface = async (spec) => {
  const { host, port = 9222, platform } = spec;

  // Try every place this desktop might be, and use the first that answers WITH an Off Grid page.
  //
  // This used to fetch 127.0.0.1 while reporting failure against `host`, so a run could name a box
  // it had never contacted - the same "live app read as a dead one" this rig exists to prevent. A
  // box that has moved, or whose tunnel is open on one address and not the other, now just works.
  const candidates = spec.candidates?.length ? spec.candidates : [{ host, port }];
  const tried = [];
  let page;
  let found;
  for (const candidate of candidates) {
    const at = `${candidate.host}:${candidate.port ?? port}`;
    tried.push(at);
    try {
      const targets = await (await fetch(`http://${at}/json`)).json();
      const hit = selectMainOffGridPage(targets);
      if (hit) {
        page = hit;
        found = at;
        break;
      }
    } catch {
      // Nothing there. Try the next address rather than failing the whole run on the first miss.
    }
  }
  if (!page) {
    throw new Error(
      `no Off Grid page for ${platform} at any of ${tried.join(', ')}. ` +
        `Start the app with --remote-debugging-port=${port}.`,
    );
  }
  if (found && !found.startsWith('127.0.0.1')) console.log(`AT    ${platform.padEnd(8)}${found}`);

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('the debugging socket refused')), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });
  const rejectPending = (reason) => {
    for (const waiting of pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(reason);
    }
    pending.clear();
  };
  socket.addEventListener('close', () => rejectPending(new Error('the debugging socket closed')));
  socket.addEventListener('error', () => rejectPending(new Error('the debugging socket failed')));
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} did not answer within 10000ms`));
      }, 10_000);
      pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  // Data reaches the page as CDP arguments, never spliced into source. `fn` is a real function or a
  // constant function-declaration string; nothing a test observed is ever turned into code.
  let globalObjectId;
  const call = async (fn, ...args) => {
    if (!globalObjectId) {
      const { result } = await send('Runtime.evaluate', { expression: 'globalThis' });
      globalObjectId = result.objectId;
    }
    const result = await send('Runtime.callFunctionOn', {
      objectId: globalObjectId,
      functionDeclaration: typeof fn === 'function' ? fn.toString() : fn,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  };

  /** Click the smallest clickable whose text matches, optionally scoped to the CARD for `within`. */
  const click = (label, within) =>
    call((wanted, scope) => {
      let root = document;
      if (scope) {
        // The <article> row, not the smallest node containing the name - that is the name span, which
        // holds no buttons at all.
        const card =
          [...document.querySelectorAll('article')]
            .filter((el) => (el.innerText ?? '').includes(scope) && el.offsetParent !== null)
            .sort((a, b) => a.innerText.length - b.innerText.length)[0] ??
          [...document.querySelectorAll('li, section, div')]
            .filter((el) => (el.innerText ?? '').includes(scope) && el.offsetParent !== null)
            .sort((a, b) => a.innerText.length - b.innerText.length)[0];
        if (!card) return false;
        root = card;
      }
      const hit = [...root.querySelectorAll('button, a, [role="button"], input, span, div')]
        .filter((el) => (el.innerText ?? el.value ?? '').trim().toLowerCase().includes(wanted))
        .filter((el) => el.offsetParent !== null)
        .sort((a, b) => (a.innerText ?? '').length - (b.innerText ?? '').length)[0];
      if (!hit) return false;
      hit.click();
      return true;
    }, label.toLowerCase(), within ?? null);

  return {
    platform,
    family: 'electron',
    /** Escape hatch for diagnosing a surface, and for capabilities not yet in the vocabulary. */
    evaluate,
    /** Low-level UI verbs shared by feature journeys. Feature rules stay in their own adapter. */
    ui: {
      evaluate,
      text: () => evaluate('return document.body.innerText;'),
      click,
      waitFor: (check, options) => waitUntil(check, options),
    },

    async openDevices() {
      if (/PAIRING CODE/i.test((await this.text()) ?? '')) return;
      await click('Devices');
      await waitUntil(async () => /PAIRING CODE/i.test(await this.text()), {
        label: `the Devices screen on ${platform}`,
        timeoutMs: 20_000,
      });
    },

    text: () => evaluate('return document.body.innerText;'),

    /** The name this device calls itself. The desktops print it outright: "This device: <name>". */
    async deviceName() {
      const match = (await this.text()).match(/This device:\s*(.+)/);
      if (!match) throw new Error(`could not read the device name on ${platform}`);
      return match[1].trim();
    },

    async pairingCode() {
      const text = await this.text();
      const match = text.match(CODE);
      if (!match) throw new Error(`${platform} shows no pairing code`);
      return match[1];
    },

    async sees(name) {
      return (await this.text()).includes(name);
    },

    async rescan() {
      await click('Rescan network');
    },

    async startPairing(name) {
      // Whichever the card actually offers. A device whose credential is still held shows Reconnect and
      // needs no code at all; only a lost credential asks for one. Trying "Pair" alone reported "offers
      // no pair control" for a device that was one click from connecting.
      for (const label of ['Pair again', 'Reconnect', 'Pair']) {
        if (await click(label, name)) return label.toLowerCase();
      }
      throw new Error(`${platform} offers no pair, repair or reconnect control for "${name}"`);
    },

    /** Did a code prompt open? A reconnect succeeds without one. */
    async waitForCodePrompt(timeoutMs = 20_000) {
      return waitUntil(async () => /Enter the pairing code/i.test(await this.text()), {
        label: `a code prompt on ${platform}`,
        timeoutMs,
        intervalMs: 1000,
      })
        .then(() => true)
        .catch(() => false);
    },

    async enterPairingCode(code) {
      await waitUntil(async () => /Pairing code/i.test(await this.text()), {
        label: `the code dialog on ${platform}`,
        timeoutMs: 45_000,
      });
      // EVERYTHING here is scoped to the dialog. The Devices screen renders a "Pair" button on every
      // discovered card - eight were visible during this failure - so an unscoped smallest-match click
      // hit a card instead of the dialog's confirm, and the dialog sat open with the code already in it.
      const dialogJs = `
        const dialog =
          document.querySelector('[role="dialog"]') ??
          [...document.querySelectorAll('div, section')]
            .filter((el) => /Enter the pairing code/i.test(el.innerText ?? '') && el.offsetParent !== null)
            .sort((a, b) => a.innerText.length - b.innerText.length)[0];
      `;
      const filled = await call(`function (code) {
        ${dialogJs}
        if (!dialog) return 'no dialog';
        const field = [...dialog.querySelectorAll('input')].find((el) => el.offsetParent !== null);
        if (!field) return 'no field';
        // Through the native setter so React's onChange fires; assigning .value directly updates the
        // DOM and leaves React's state empty, so the confirm stays disabled.
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(field, code);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
      }`, code);
      if (filled !== 'ok') throw new Error(`${platform}: could not fill the pairing code (${filled})`);
      await sleep(600);
      const confirmed = await evaluate(`
        ${dialogJs}
        if (!dialog) return false;
        const confirm = [...dialog.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null && !b.disabled)
          .find((b) => /^pair/i.test((b.innerText ?? '').trim()));
        if (!confirm) return false;
        confirm.click();
        return true;
      `);
      if (!confirmed) throw new Error(`${platform}: the dialog offered no enabled confirm button`);
    },

    /** The confirmation dialog currently open, or undefined. Same contract as the RN surface. */
    async openSheet() {
      const title = await evaluate(`
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog || dialog.offsetParent === null) return null;
        return (dialog.innerText ?? '').split('\\n')[0] ?? 'dialog';
      `);
      return title ?? undefined;
    },

    /** Drop a saved device, so pairing with it needs the code again. Scoped to that device's card. */
    async forget(name) {
      for (const label of DESKTOP.forget) {
        if (await click(label, name)) {
          await this.confirmDestructive(`forget ${name}`);
          return;
        }
      }
      throw new Error(`${platform} offers no forget control for "${name}"`);
    },

    /** Go through with an open destructive dialog, and wait until it is gone. */
    async confirmDestructive(what) {
      const dialog = await waitUntil(() => this.openSheet(), {
        label: `a confirmation dialog for ${what} on ${platform}`,
        timeoutMs: 6_000,
        intervalMs: 500,
      }).catch(() => undefined);
      if (!dialog) return false;

      // Scoped to the dialog: the Devices screen renders a Forget button on every saved card, so an
      // unscoped smallest-match would press a card behind the dialog instead of the dialog itself.
      const confirmed = await evaluate(`
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        const confirm = [...dialog.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null && !b.disabled)
          .find((b) => ${DESKTOP.confirmDestructive}.test((b.innerText ?? '').trim()));
        if (!confirm) return false;
        confirm.click();
        return true;
      `);
      if (!confirmed) {
        throw new Error(`${platform} opened "${dialog}" but offered no enabled confirm button`);
      }
      await waitUntil(async () => !(await this.openSheet()), {
        label: `the ${what} dialog on ${platform} to close`,
        timeoutMs: 20_000,
        intervalMs: 500,
      });
      return true;
    },

    /** Turn this device's advertisement on or off. Answers what it was, so a flow can restore it. */
    async setDiscoverable(on) {
      const was = await this.isDiscoverable();
      if (was === on) return was;
      if (!(await click('Discoverable'))) {
        throw new Error(`${platform} offers no discoverability control`);
      }
      return was;
    },

    /** Is this device advertising? Read from the Discoverable chip's own pressed/checked state. */
    async isDiscoverable() {
      const state = await evaluate(`
        const chip = [...document.querySelectorAll('button, [role="switch"], [role="checkbox"]')]
          .filter((el) => /discoverable/i.test(el.innerText ?? '') && el.offsetParent !== null)
          .sort((a, b) => (a.innerText ?? '').length - (b.innerText ?? '').length)[0];
        if (!chip) return null;
        // Whichever the control actually publishes. A chip that says only "Discoverable" when on and
        // "Not discoverable"/"Hidden" when off is read by its text; a real switch by its state.
        const flag = chip.getAttribute('aria-checked') ?? chip.getAttribute('aria-pressed');
        if (flag !== null) return flag === 'true';
        return !/not discoverable|hidden/i.test(chip.innerText ?? '');
      `);
      if (state === null) throw new Error(`${platform} shows no discoverability control`);
      return state;
    },

    /** Back out of an open dialog, leaving the mesh as it was. */
    async dismissSheet() {
      if (!(await this.openSheet())) return false;
      await evaluate(`
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;
        const cancel = [...dialog.querySelectorAll('button')]
          .filter((b) => b.offsetParent !== null && !b.disabled)
          .find((b) => /cancel|not now|keep/i.test((b.innerText ?? '').trim()));
        if (cancel) { cancel.click(); return true; }
        return false;
      `);
      return true;
    },

    async isConnectedTo(name) {
      return call((wanted) => {
        // The <article> ROW, not the smallest node mentioning the name - that is the name span, which
        // carries no status at all, so this reported false for a device the screen showed as connected.
        const card = [...document.querySelectorAll('article')]
          .filter((el) => (el.innerText ?? '').includes(wanted) && el.offsetParent !== null)
          .sort((a, b) => a.innerText.length - b.innerText.length)[0];
        if (!card) return false;
        // Case-sensitive includes, NOT a regex. Case matters because the summary chip says
        // "N connected" - a loose match makes every device look connected at once.
        return card.innerText.includes('Connected');
      }, name);
    },

    /**
     * Leave the network for `ms`, then come back - scheduled ON the machine before it goes.
     *
     * The desktops are driven THROUGH the network: CDP reaches them over an ssh tunnel. A plain
     * "network off" would cut the channel that would later be used to turn it back on, and the box
     * would sit there stranded until someone walked over to it. So the outage and the recovery are
     * issued as ONE detached command that the machine runs by itself - it is already committed to
     * coming back before it goes anywhere.
     */
    async goOffline(ms) {
      const seconds = Math.ceil(ms / 1000);
      const { host: sshHost, user, service } = spec.offline ?? {};
      if (!sshHost) {
        throw new Error(
          `${platform} has no offline access configured - see OFFLINE in mesh-config.mjs. Taking a ` +
            'desktop off the network needs a shell on it, not the debugging port.',
        );
      }
      const script =
        platform === 'macos'
          ? // Belt and braces: whichever of Wi-Fi and Ethernet is carrying this box, both come back.
            `networksetup -setairportpower ${service} off; sleep ${seconds}; ` +
            `networksetup -setairportpower ${service} on`
          : `netsh interface set interface "${service}" admin=disable & timeout /t ${seconds} & ` +
            `netsh interface set interface "${service}" admin=enable`;
      // nohup + & so the command survives the ssh session dying WITH the network it is about to cut.
      const remote =
        platform === 'macos'
          ? `nohup sudo sh -c '${script}' >/dev/null 2>&1 &`
          : `start /b cmd /c "${script}"`;
      const sshArgs = ['-o', 'ConnectTimeout=8', `${user}@${sshHost}`, remote];
      // The Windows guest authenticates by password, so it needs sshpass with SSHPASS in the
      // environment. Said plainly rather than failing with a bare "Permission denied".
      if (spec.offline.password) {
        if (!process.env.SSHPASS) {
          throw new Error(
            `${platform} needs SSHPASS set to take it off the network (it authenticates by password)`,
          );
        }
        await run('sshpass', [
          '-e',
          'ssh',
          '-o',
          'PreferredAuthentications=password',
          '-o',
          'PubkeyAuthentication=no',
          ...sshArgs,
        ]);
        return;
      }
      await run('ssh', sshArgs);
    },

    async screenshot(path) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, Buffer.from(shot.data, 'base64'));
    },

    close: () => socket.close(),
  };
};

// ---------------------------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------------------------

/**
 * A surface for one device.
 *
 *   connectSurface({ kind: 'android' })
 *   connectSurface({ kind: 'ios', wdaUrl })
 *   connectSurface({ kind: 'macos', host: '192.168.1.25', port: 9222 })
 *   connectSurface({ kind: 'windows', host: '192.168.1.26', port: 9222 })
 */
export async function connectSurface(spec) {
  // `passive` means LOOK, do not touch: attach to whatever is on screen and launch nothing. Anything
  // that observes a journey a person is driving must use it, or the observer changes the thing it is
  // observing - activating the app under test is how a live model transfer got killed.
  const { kind, restart = false, passive = false } = spec;
  if (kind === 'android') {
    const client = new AdbClient(spec.serial ?? process.env.E2E_ANDROID_SERIAL);
    if (!(await client.isReady())) throw new Error('nothing is answering adb');
    if (restart) await client.restart(ANDROID_PACKAGE);
    // Android's session() relaunches the app to the foreground, which is fine for driving and wrong
    // for watching. Passive skips it and reads whatever is already there.
    else if (!passive) await client.session(ANDROID_PACKAGE);
    return rnSurface(client, 'android');
  }
  if (kind === 'ios') {
    const url = spec.wdaUrl ?? process.env.WDA_URL;
    if (!url) throw new Error('the iPhone needs WDA_URL from scripts/ios/launch-wda.mjs');
    const client = new WdaClient(url);
    if (!(await client.isReady())) throw new Error(`WDA at ${url} is not answering`);
    if (restart) await client.restart(IOS_BUNDLE_ID);
    // A session created WITH a bundle id makes WDA launch and activate that app, which terminates
    // whatever it was doing. That is right when a flow is about to drive the phone, and completely
    // wrong when something only wants to LOOK: it killed a model transfer that was mid-flight,
    // because the observer relaunched the app it was observing. Passive attaches to whatever is
    // already on screen and touches nothing.
    else if (passive) await client.attach();
    else await client.session(IOS_BUNDLE_ID);
    return rnSurface(client, 'ios');
  }
  if (kind === 'macos' || kind === 'windows') return electronSurface({ ...spec, platform: kind });
  throw new Error(`unknown device kind "${kind}"`);
}

/**
 * Pair two devices, whatever they are.
 *
 * The joiner presents the code the HOST is showing; the host compares it itself. Both sides are then
 * required to agree - a pairing only one side believes in is the failure this catches, and it is why
 * the assertion is not simply "the joiner stopped erroring".
 */
export async function pair({ host, joiner, hostName, joinerName, timeoutMs = 120_000 }) {
  await Promise.all([host.openDevices(), joiner.openDevices()]);

  if (await joiner.isConnectedTo(hostName)) return { alreadyConnected: true };

  // Discovery is asynchronous and a peer that restarted moves port, so the joiner's list can be stale.
  // Rescan and WAIT before concluding anything: "lists no pair control" is a discovery symptom being
  // reported as a pairing failure, which sends you looking in the wrong place.
  if (!(await joiner.sees(hostName))) {
    await joiner.rescan();
    await waitUntil(() => joiner.sees(hostName), {
      label: `${joiner.platform} to discover "${hostName}"`,
      timeoutMs: 60_000,
      intervalMs: 3000,
    });
  }

  const code = await host.pairingCode();
  const action = await joiner.startPairing(hostName);
  // A code is only needed when the joiner has LOST its credential. A reconnect on a held one succeeds
  // without a prompt, and waiting 45s for a dialog that will never open reads as a pairing failure.
  const prompted = await joiner.waitForCodePrompt();
  if (prompted) await joiner.enterPairingCode(code);

  await waitUntil(async () => (await joiner.isConnectedTo(hostName)) && (await host.isConnectedTo(joinerName)), {
    label: `${joiner.platform} and ${host.platform} to both report the pairing`,
    timeoutMs,
    intervalMs: 2000,
  });
  return { code, action, usedCode: prompted };
}

/**
 * Make `surface` forget `name`, and WAIT until the screen agrees.
 *
 * The wait is the whole value: forgetting is asynchronous, and a flow that pairs immediately after
 * tapping Forget races the teardown it just asked for - the credential is often still there, the
 * pairing succeeds without a code, and the route passes for the wrong reason.
 */
export async function forget(surface, name, { timeoutMs = 30_000 } = {}) {
  await surface.forget(name);
  await waitUntil(
    async () => {
      // A sheet still open means the screen being read is the SHEET, not the device list, and every
      // answer from it is about the wrong screen. This is the exact false pass this helper exists to
      // prevent: "not connected" read off a covering sheet, while the credential was never dropped.
      if (await surface.openSheet()) return false;
      return !(await surface.isConnectedTo(name));
    },
    {
      label: `${surface.platform} to let go of "${name}" with no sheet left open`,
      timeoutMs,
      intervalMs: 1000,
    },
  );
}

/** Poll any condition on a surface, with a diagnosis rather than a bare timeout. */
export { waitUntil };
