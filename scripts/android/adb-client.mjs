/**
 * The same surface as scripts/ios/wda-client.mjs, over adb — so one e2e test drives both platforms.
 *
 * Android needs no server and no signing: adb is already the channel. `uiautomator dump` gives the
 * accessibility tree, `input tap/swipe/text` are the hands, `exec-out screencap` the eyes. The tree arrives as
 * XML with `bounds="[x1,y1][x2,y2]"`, so it is normalised here into the SAME node shape WDA returns
 * ({ label, name, value, rect, children }) — which is what lets findByLabel, waitFor and a test written once
 * work unchanged on either device.
 *
 * Coordinates are physical pixels on Android and logical points on iOS. Nothing here needs to care, because
 * every gesture goes through an element's own centre rather than a hardcoded coordinate.
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Apps other than ours that a journey may legitimately TAP (never type into): the OS permission
 * dialog and the system photo / document pickers a person goes through from inside the app.
 */
const SYSTEM_TAP_TARGETS = /permissioncontroller|photopicker|documentsui|providers\.media/;

export class AdbClient {
  #serial;
  #guardPackage = null;

  /** serial from `adb devices`; omit it when exactly one device is attached. */
  constructor(serial) {
    this.#serial = serial;
  }

  /**
   * From now on, refuse to send input anywhere but `packageName`.
   *
   * A journey types into "whatever has focus" (`input text` has no target). If a notification, a
   * share sheet or another app took the front, the text goes THERE - a chat prompt once landed in
   * Slack that way. With a guard set, every type, key event, tap and swipe first checks the focused
   * window, brings the app back once if it is not ours, and throws rather than send input elsewhere.
   */
  requireForeground(packageName) {
    this.#guardPackage = packageName;
  }

  async #assertFront(kind) {
    const pkg = this.#guardPackage;
    if (!pkg) return;
    // A heads-up banner does not take focus, so the focus check passes while it covers the top of
    // the screen - and a tap there opens the notifying app (Slack came to the front this way, twice,
    // on a tap meant for the chat header). Wait out any recent high-importance notification first.
    if (kind === 'tap' || kind === 'swipe') await this.#waitOutHeadsUp();
    const focus = await this.focusedWindow().catch(() => '');
    if (focus.includes(pkg)) return;
    if ((kind === 'tap' || kind === 'swipe') && SYSTEM_TAP_TARGETS.test(focus)) return;
    // Not ours: abort this step. Nothing is brought back here - a person may be using that app.
    // The journeys relaunch the app only at a step boundary (toHome), never mid-gesture.
    throw new Error(`app not in foreground (${focus || 'unknown'}) - refusing to ${kind}`);
  }

  /** Wait (up to ~12 s) until no importance>=HIGH notification interrupted in the last 9 s. */
  async #waitOutHeadsUp() {
    for (let i = 0; i < 6; i += 1) {
      const out = await this.#adb(['shell', 'date +%s%3N; dumpsys notification --noredact | grep -E "NotificationRecord|mInterruptionTimeMs"']).catch(() => '');
      const lines = out.split('\n');
      const now = Number(lines[0]?.trim());
      if (!now) return;
      let important = false;
      let latest = 0;
      for (const line of lines) {
        if (line.includes('NotificationRecord(')) important = /importance=([4-5])/.test(line);
        const at = line.match(/mInterruptionTimeMs=(\d+)/);
        if (at && important) latest = Math.max(latest, Number(at[1]));
      }
      if (now - latest > 9_000) return;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error('a high-importance notification keeps interrupting (heads-up over the app) - refusing to tap');
  }

  /** The adb serial this client drives (undefined when it relies on the only attached device). */
  get serial() {
    return this.#serial;
  }

  #args(rest) {
    return this.#serial ? ['-s', this.#serial, ...rest] : rest;
  }

  async #adb(rest, options = {}) {
    const { stdout } = await run('adb', this.#args(rest), { maxBuffer: 64 * 1024 * 1024, ...options });
    return stdout;
  }

  /**
   * Run an adb shell command on this device.
   *
   * The escape hatch for DEVICE state that no UI exposes - the radio, the clock, a process signal.
   * Deliberately public and deliberately thin: the driver owns talking to adb, so a caller that
   * needs the network turned off asks for that rather than shelling out to `adb` behind its back
   * and losing the serial that says WHICH phone.
   */
  async shell(command) {
    return this.#adb(['shell', ...(Array.isArray(command) ? command : command.split(' '))]);
  }

  /**
   * Run any adb command against this device (logcat, pidof via shell, reverse ...). The journeys use
   * this rather than spawning adb themselves, so the serial - WHICH phone - is never lost.
   */
  async run(args) {
    // Raw input through run() is guarded like type(): text or a key event (other than leaving the
    // app on purpose with HOME, or waking the screen) must only ever reach our app.
    const at = args.indexOf('input');
    if (args[0] === 'shell' && at >= 0) {
      const what = args[at + 1];
      const leaving = what === 'keyevent' && /^(KEYCODE_HOME|KEYCODE_WAKEUP|3|224)$/.test(args[at + 2] ?? '');
      if (!leaving) await this.#assertFront(what === 'text' ? 'type' : 'key event');
    }
    return this.#adb(args);
  }

  /** Serials of every attached, authorised device (`adb devices`). */
  static async listDevices() {
    const { stdout } = await run('adb', ['devices']);
    return stdout
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([serial, state]) => serial && state === 'device')
      .map(([serial]) => serial);
  }

  /** Is a device attached and responding? */
  async isReady() {
    try {
      return (await this.#adb(['shell', 'echo', 'ok'])).trim() === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Bring `packageName` to the front, and make sure the screen is actually SHOWING it.
   *
   * Launching is not enough. A device that has been sitting on a desk is asleep, may be on the lock screen, and
   * may have the notification shade pulled down over everything - and in that last case the app is still the
   * "focused app" while uiautomator dumps system UI instead. That failure is invisible from the outside: every
   * locator simply misses, and the run reads as an app that renders nothing. Found exactly that way on a real
   * OnePlus, where mCurrentFocus was NotificationShade.
   *
   * Wake, dismiss the keyguard, collapse the shade, then launch.
   */
  async session(packageName) {
    await this.#adb(['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP']).catch(() => {});
    await this.#adb(['shell', 'wm', 'dismiss-keyguard']).catch(() => {});
    await this.#adb(['shell', 'cmd', 'statusbar', 'collapse']).catch(() => {});
    // Animation scales are left alone: setting them to 0 changed the phone for its owner (the reply dots
    // stopped animating) and hid exactly the animation bugs a release check is for.
    if (!packageName) return null;
    await this.#adb(['shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
    return packageName;
  }

  /**
   * Restart the app so a run starts from a known screen.
   *
   * Without this a suite inherits wherever the last run left the app - and then the first assertion fails for a
   * reason that has nothing to do with the code under test. Found the obvious way: a manual poke left the app on
   * the Devices screen and the next run could not find the home screen.
   */
  async restart(packageName) {
    await this.#adb(['shell', 'am', 'force-stop', packageName]).catch(() => {});
    return this.session(packageName);
  }

  /** Which window actually has focus. Used to tell "the app is not ready yet" from "something is over it". */
  async focusedWindow() {
    const out = await this.#adb(['shell', 'dumpsys', 'window']);
    return out.match(/mCurrentFocus=Window\{[^}]*?\s(\S+)\}/)?.[1] ?? '';
  }

  /** Screen size in pixels. */
  async windowSize() {
    const out = await this.#adb(['shell', 'wm', 'size']);
    const found = out.match(/Physical size:\s*(\d+)x(\d+)/);
    if (!found) throw new Error(`Could not read the screen size from: ${out.trim()}`);
    return { width: Number(found[1]), height: Number(found[2]) };
  }

  /** Save a PNG screenshot to `path`. */
  async screenshot(path) {
    const { stdout } = await run('adb', this.#args(['exec-out', 'screencap', '-p']), {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    await writeFile(path, stdout);
  }

  /**
   * The foreground window's accessibility tree, in WDA's node shape.
   *
   * uiautomator writes to the device and the file is read back, rather than dumped to stdout: `--dump /dev/tty`
   * interleaves with adb's own chatter on some builds and yields truncated XML.
   *
   * The stale-read trap this guards against, found on a real device: `uiautomator dump` fails with
   * "ERROR: could not get idle state." whenever the screen never stops changing - a spinner, a recording dot, a
   * list that keeps updating. It exits non-zero-ish but leaves the PREVIOUS dump file in place, so reading the
   * file without checking gives you a snapshot of an older screen. Every locator then matches or misses against
   * the past, which is unfalsifiable from the outside.
   *
   * So: delete the file first, check what the dump said, and throw if it did not produce a new one. Throwing is
   * right because waitFor() polls - a transient never-idle resolves on the next attempt, while a persistent one
   * surfaces as a real error instead of silently stale UI.
   */
  async source() {
    // /data/local/tmp, not /sdcard: always writable by the shell user and unaffected by scoped storage.
    const remote = '/data/local/tmp/offgrid-ui-dump.xml';
    let lastSaid = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.#adb(['shell', 'rm', '-f', remote]).catch(() => {});
      // --compressed is not an optimisation here, it is the only mode that works on this app. The plain dump waits
      // for an idle window and this app never fully idles (a live recording indicator, lists that keep updating),
      // so it fails every time with "could not get idle state" - while --compressed skips that wait and succeeds.
      // What compression drops is nodes not marked important for accessibility, which is precisely the set no test
      // targets: testIDs and accessibility labels survive.
      lastSaid = await this.#adb(['shell', 'uiautomator', 'dump', '--compressed', remote]).catch(
        (cause) => cause.message,
      );
      let xml = await this.#adb(['shell', 'cat', remote]).catch(() => '');
      // A notification arriving mid-run pulls the shade over the app, and the dump then describes SystemUI instead.
      // On a real phone this happens constantly - it is not a setup problem to fix once at the start. Collapsing and
      // re-reading makes it self-healing; without it a run fails with a hierarchy full of other apps' notifications,
      // which is exactly how this was found.
      if (xml.includes('com.android.systemui:id/notification')) {
        await this.#adb(['shell', 'cmd', 'statusbar', 'collapse']).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 600));
        await this.#adb(['shell', 'rm', '-f', remote]).catch(() => {});
        await this.#adb(['shell', 'uiautomator', 'dump', '--compressed', remote]).catch(() => {});
        xml = await this.#adb(['shell', 'cat', remote]).catch(() => '');
      }
      if (xml.includes('<hierarchy')) return parseUiAutomatorXml(xml);
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    // uiautomator exits 0 even when it fails, so the dump's own words and the file's absence are the signal.
    const why = /could not get idle state/i.test(lastSaid)
      ? 'the screen never went idle (something is animating or continuously re-rendering)'
      : lastSaid.trim().split('\n')[0] || 'uiautomator produced no dump after 3 attempts';
    throw new Error(`Could not read the view hierarchy: ${why}`);
  }

  /**
   * The raw uiautomator XML, attributes intact.
   *
   * source() keeps only what locators need. An accessibility check needs more - whether a node is
   * clickable, focusable, enabled - and those live only on the raw dump.
   */
  async sourceXml() {
    const remote = '/data/local/tmp/offgrid-ui-dump-raw.xml';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.#adb(['shell', 'rm', '-f', remote]).catch(() => {});
      await this.#adb(['shell', 'uiautomator', 'dump', '--compressed', remote]).catch(() => '');
      const xml = await this.#adb(['shell', 'cat', remote]).catch(() => '');
      if (xml.includes('<hierarchy')) return xml;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
    throw new Error('Could not read the raw view hierarchy');
  }

  /** First element whose label, name or value contains `needle`, case-insensitively. */
  async findByLabel(needle) {
    const wanted = needle.toLowerCase();
    let exact = null;
    let partial = null;
    const walk = (node) => {
      if (!node) return;
      // EVERY identifying field, not the first non-empty one. `label || name || value` short-circuits, and that
      // hid every testID on Android: React Native puts testID in resource-id (node.name), but an accessible
      // container also gets a synthesised content-desc (node.label) built from its children - so label was always
      // truthy and name was never examined. The symptom was believing the platform did not expose testIDs at all.
      const fields = [node.label, node.name, node.value].map((f) => `${f ?? ''}`);
      const exactHit = fields.find((field) => field.toLowerCase() === wanted);
      const partialHit = fields.find((field) => field.toLowerCase().includes(wanted));
      const hit = exactHit ?? partialHit;
      if (hit !== undefined && node.rect && node.rect.width > 0) {
        const match = {
          // The matched field, so a caller that searched by testID gets the testID back rather than the
          // description that happens to sit beside it.
          label: hit,
          type: node.type || '',
          rect: node.rect,
          center: {
            x: Math.round(node.rect.x + node.rect.width / 2),
            y: Math.round(node.rect.y + node.rect.height / 2),
          },
        };
        if (exactHit !== undefined && !exact) exact = match;
        else if (!partial) partial = match;
      }
      (node.children || []).forEach(walk);
    };
    walk(await this.source());
    // React Native can place a concatenation of every child testID on an accessible parent. That
    // parent appears before the actual control in UiAutomator's tree. A substring-first walk taps the
    // large parent centre instead of the exact child (for example, Send resolves to the Models header).
    return exact ?? partial;
  }

  /** Tap an absolute point. */
  async tap(x, y) {
    await this.#assertFront('tap');
    await this.#adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
  }

  /** Drag from one point to another. */
  async swipe(x1, y1, x2, y2, durationMs = 400) {
    await this.#assertFront('swipe');
    await this.#adb([
      'shell',
      'input',
      'swipe',
      String(Math.round(x1)),
      String(Math.round(y1)),
      String(Math.round(x2)),
      String(Math.round(y2)),
      String(durationMs),
    ]);
  }

  /** Find an element by label and tap its centre. */
  async tapLabel(needle) {
    const element = await this.findByLabel(needle);
    if (!element) return null;
    await this.tap(element.center.x, element.center.y);
    return element;
  }

  /** Type into the focused field. Spaces are escaped because `input text` splits on them. */
  async type(text) {
    await this.#assertFront('type');
    await this.#adb(['shell', 'input', 'text', text.replace(/ /g, '%s')]);
  }

  /** Hardware back. */
  async back() {
    await this.#assertFront('key event');
    await this.#adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
  }

  /** Identical to the iOS client's: poll until `check` is truthy, and name what was waited for on timeout. */
  async waitFor(check, { label = 'condition', timeoutMs = 15_000, intervalMs = 400 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    for (;;) {
      try {
        const result = await check(this);
        if (result) return result;
      } catch (cause) {
        lastError = cause;
      }
      if (Date.now() >= deadline) {
        const because = lastError ? ` Last error: ${lastError.message}` : '';
        throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}.${because}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  waitForLabel(needle, options = {}) {
    return this.waitFor((device) => device.findByLabel(needle), {
      label: `an element labelled "${needle}"`,
      ...options,
    });
  }

  async tapWhenReady(needle, options = {}) {
    const element = await this.waitForLabel(needle, options);
    await this.tap(element.center.x, element.center.y);
    return element;
  }

  waitForGone(needle, options = {}) {
    return this.waitFor(async (device) => (await device.findByLabel(needle)) === null, {
      label: `"${needle}" to disappear`,
      ...options,
    });
  }

  /**
   * Scroll until `needle` is on screen, then return it.
   *
   * Needed because the two platforms disagree about what "on screen" means. WDA returns the whole accessibility
   * tree including nodes scrolled out of view, so findByLabel alone finds them on iOS. Android's compressed dump
   * contains only what is actually rendered, so anything below the fold does not exist until it is scrolled to.
   * A test that passes on iOS and fails on Android with "no such element" is almost always this.
   */
  async scrollToLabel(needle, { maxSwipes = 8, ...options } = {}) {
    const existing = await this.findByLabel(needle);
    if (existing) return existing;
    const { width, height } = await this.windowSize();
    const x = Math.round(width / 2);
    for (let attempt = 0; attempt < maxSwipes; attempt += 1) {
      await this.swipe(x, Math.round(height * 0.75), x, Math.round(height * 0.3));
      await new Promise((resolve) => setTimeout(resolve, 500));
      const found = await this.findByLabel(needle).catch(() => null);
      if (found) return found;
    }
    throw new Error(`"${needle}" did not appear after ${maxSwipes} swipes.${options.hint ? ` ${options.hint}` : ''}`);
  }

  /**
   * Wait until an element's position stops changing, then return it.
   *
   * A list keeps moving after a swipe - the fling carries on for a few hundred milliseconds. Reading an element's
   * centre during that and then tapping it sends the tap to where the row USED to be, so the tap lands on
   * whatever slid into that space, or on nothing. The symptom is maddening: the element is found, the tap is
   * issued, and the screen simply does not change. Found exactly that way tapping a row near the bottom of the
   * Devices screen.
   *
   * Two identical reads in a row is enough to call it settled.
   */
  async waitForStable(needle, { timeoutMs = 8000, intervalMs = 250, ...rest } = {}) {
    let previous = null;
    return this.waitFor(
      async (device) => {
        const element = await device.findByLabel(needle);
        if (!element) {
          previous = null;
          return null;
        }
        const here = `${element.rect.x},${element.rect.y},${element.rect.width},${element.rect.height}`;
        const settled = previous === here;
        previous = here;
        return settled ? element : null;
      },
      { label: `"${needle}" to stop moving`, timeoutMs, intervalMs, ...rest },
    );
  }

  /** Scroll to an element and tap it - the everyday gesture for anything below the fold. */
  async scrollAndTap(needle, options = {}) {
    await this.scrollToLabel(needle, options);
    // Re-read after the fling has stopped: the centre found while scrolling is already out of date.
    let element = await this.waitForStable(needle);

    // An element sitting in the very bottom band of the screen cannot reliably be tapped: that strip belongs to
    // the system's gesture navigation, which swallows the touch. The row is found, the tap is issued, and nothing
    // happens - which is exactly how the LAST row of a list fails while the one above it works. Nudge the list up
    // and re-read before tapping.
    const { height } = await this.windowSize();
    if (element.center.y > height * 0.88) {
      await this.swipe(element.center.x, Math.round(height * 0.7), element.center.x, Math.round(height * 0.5));
      element = await this.waitForStable(needle);
    }

    await this.tap(element.center.x, element.center.y);
    return element;
  }

  async labels() {
    const found = [];
    const walk = (node) => {
      if (!node) return;
      // All three fields, for the same reason findByLabel reads all three: a node can carry both a testID and a
      // description, and a locator that does not match wants to see both when this list is printed.
      for (const field of [node.label, node.name, node.value]) {
        const text = `${field ?? ''}`.trim();
        if (text && node.rect?.width > 0 && !found.includes(text)) found.push(text);
      }
      (node.children || []).forEach(walk);
    };
    walk(await this.source());
    return found;
  }

  /** Copy a file off the device — how a coverage dump gets back to the host. */
  async pull(remotePath, localPath) {
    await this.#adb(['pull', remotePath, localPath]);
  }

  /** Stage a fixture on the device before a UI-only picker journey selects it. */
  async push(localPath, remotePath) {
    await this.#adb(['push', localPath, remotePath]);
  }

  /** Read a file from this debug build's private app container without copying it to shared storage. */
  async readAppFile(packageName, relativePath) {
    if (!/^[a-z][a-z0-9_.]+$/i.test(packageName)) throw new Error(`unsafe Android package: ${packageName}`);
    if (!/^[a-z0-9_./-]+$/i.test(relativePath) || relativePath.includes('..')) {
      throw new Error(`unsafe Android app file: ${relativePath}`);
    }
    return this.#adb(['exec-out', 'run-as', packageName, 'cat', relativePath]);
  }
}

/**
 * uiautomator XML into WDA-shaped nodes.
 *
 * Hand-parsed rather than pulled from a dependency: the format is a flat stream of self-describing `<node .../>`
 * elements with no text content, so a regex over the tag stream plus a depth stack is enough, and it keeps this
 * harness dependency-free.
 *
 * `content-desc` is preferred over `text` for the label because that is where React Native puts accessibilityLabel
 * and testID - the identifiers the tests actually target.
 */
export function parseUiAutomatorXml(xml) {
  // The root carries the same fields as every other node, empty. A partial shape here means any consumer that
  // walks the tree reading node.name or node.label hits undefined on the very first node - which is exactly how
  // the parser's own test first failed.
  const root = {
    type: 'hierarchy',
    label: '',
    name: '',
    value: '',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    children: [],
  };
  const stack = [root];
  const tagPattern = /<(\/?)node\b([^>]*?)(\/?)>/g;

  for (let match = tagPattern.exec(xml); match !== null; match = tagPattern.exec(xml)) {
    const [, closing, attributeText, selfClosing] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attributes = {};
    for (const pair of attributeText.matchAll(/([\w-]+)="([^"]*)"/g)) {
      attributes[pair[1]] = pair[2]
        .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
        .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    }

    const bounds = attributes.bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    const rect = bounds
      ? {
          x: Number(bounds[1]),
          y: Number(bounds[2]),
          width: Number(bounds[3]) - Number(bounds[1]),
          height: Number(bounds[4]) - Number(bounds[2]),
        }
      : { x: 0, y: 0, width: 0, height: 0 };

    const node = {
      type: attributes.class ?? '',
      // content-desc first: React Native maps accessibilityLabel and testID onto it.
      label: attributes['content-desc'] || '',
      name: attributes['resource-id'] || '',
      value: attributes.text || '',
      rect,
      children: [],
    };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}
