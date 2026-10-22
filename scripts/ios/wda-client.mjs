/**
 * A minimal WebDriverAgent client — eyes and hands on a real iPhone, over plain HTTP.
 *
 * WDA is Apple's XCUITest runner exposed as a REST server. Once it is up (see launch-wda.mjs) it serves over
 * the device's own address, so no tunnel and no Appium in the middle: observe with /screenshot and /source,
 * act with the W3C /actions endpoint.
 *
 * Callers locate a target by MEANING - its accessibility label - and tap its true on-screen centre, which is
 * why the app's testIDs matter more than pixel coordinates. A layout change moves the centre; it does not
 * break the test.
 *
 * Deliberately small and dependency-free. It is not a test framework - node:test and node:assert are the
 * runner and the assertions - but it does carry the one thing a black-box driver cannot do without:
 * waitFor(), so a test waits for the screen it expects instead of sleeping for a guessed interval.
 *
 * scripts/android/adb-client.mjs implements the same surface over adb, so one test drives both platforms.
 */
import { writeFileSync } from 'node:fs';

/** Out-of-process system UI a journey may TAP inside (never type into): the photo picker. */
const SYSTEM_TAP_TARGETS = /PhotosUI|mobileslideshow|photospicker/i;

export class WdaClient {
  #sessionId = null;
  #baseUrl;
  #guardBundle = null;

  /** baseUrl e.g. "http://192.168.1.20:8100", printed by launch-wda.mjs. */
  constructor(baseUrl) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
  }

  async #post(path, body) {
    const response = await fetch(this.#baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  }

  async #get(path) {
    return (await fetch(this.#baseUrl + path)).json();
  }

  /** Is WDA up and serving? */
  async isReady() {
    try {
      return Boolean((await this.#get('/status')).value);
    } catch {
      return false;
    }
  }

  /** Attach to the foreground app, or launch `bundleId` when one is given. */
  async session(bundleId) {
    const capabilities = bundleId ? { bundleId } : {};
    const created = await this.#post('/session', { capabilities: { alwaysMatch: capabilities } });
    this.#sessionId = created.value?.sessionId ?? created.sessionId ?? null;
    if (!this.#sessionId) {
      const detail = JSON.stringify(created.value ?? created).slice(0, 300);
      throw new Error(`WDA session failed: ${detail}`);
    }
    return this.#sessionId;
  }

  /** Reuse WDA's active session without relaunching or terminating the foreground app. */
  async attach() {
    const status = await this.#get('/status');
    const sessionId = status.value?.sessionId ?? status.sessionId ?? null;
    if (!sessionId) throw new Error('WDA has no active session to attach to');
    this.#sessionId = sessionId;
    return sessionId;
  }

  /**
   * Attach to WDA's live session, or create one that does NOT relaunch a running app.
   *
   * session(bundleId) asks WDA to launch the bundle, and WDA's default is forceAppLaunch=true: a
   * running app is terminated and started again. A journey that only wants to drive what is on screen
   * must not pay a cold start (or lose a stream in flight) for the privilege, so this passes
   * forceAppLaunch=false and lets WDA merely activate the app.
   */
  async attachOrCreate(bundleId) {
    try {
      return await this.attach();
    } catch {
      const created = await this.#post('/session', {
        capabilities: {
          alwaysMatch: { bundleId, forceAppLaunch: false, shouldWaitForQuiescence: false },
        },
      });
      this.#sessionId = created.value?.sessionId ?? created.sessionId ?? null;
      if (!this.#sessionId) throw new Error(`WDA session failed: ${JSON.stringify(created).slice(0, 300)}`);
      return this.#sessionId;
    }
  }

  /**
   * From now on, refuse to send input anywhere but `bundleId` (see AdbClient.requireForeground: a
   * chat prompt once reached Slack because another app was in front when a journey typed).
   */
  requireForeground(bundleId) {
    this.#guardBundle = bundleId;
  }

  /** The bundle id of the app WDA sees in front. */
  async activeBundle() {
    const info = await this.#get('/wda/activeAppInfo');
    return info.value?.bundleId ?? '';
  }

  async #assertFront(kind) {
    const bundle = this.#guardBundle;
    if (!bundle) return;
    let active = await this.activeBundle().catch(() => '');
    if (active === bundle) return;
    if ((kind === 'tap' || kind === 'swipe') && SYSTEM_TAP_TARGETS.test(active)) return;
    // Never re-activate and carry on: the target point was read from a screen that is no longer in
    // front. SpringBoard reads as active while a notification banner is up (the banner a fixed tap
    // once hit, opening Slack); banners leave in ~5 s, so re-read for up to 10 s, then abort the step.
    const was = active;
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      active = await this.activeBundle().catch(() => '');
      if (active === bundle) return;
    }
    throw new Error(`app not in foreground (${was || 'unknown'}, then ${active || 'unknown'}) - refusing to ${kind}`);
  }

  /** Terminate the app. Answers whether it was running. */
  async terminate(bundleId) {
    const out = await this.#post(`/session/${this.#requireSession()}/wda/apps/terminate`, { bundleId });
    return Boolean(out.value);
  }

  /** Launch the app (cold when it is not running). */
  async launch(bundleId) {
    await this.#post(`/session/${this.#requireSession()}/wda/apps/launch`, { bundleId });
  }

  /** Bring the app to the foreground without restarting it. */
  async activate(bundleId) {
    await this.#post(`/session/${this.#requireSession()}/wda/apps/activate`, { bundleId });
  }

  /** XCUIApplicationState: 1 not running, 2 suspended, 3 background, 4 foreground. */
  async appState(bundleId) {
    const out = await this.#post(`/session/${this.#requireSession()}/wda/apps/state`, { bundleId });
    return out.value;
  }

  /**
   * The text of the system alert on screen, or null when there is none.
   *
   * A permission prompt belongs to SpringBoard, not the app, so it never appears in the app's
   * accessibility tree. WDA reads it through its own alert route.
   */
  async alertText() {
    const out = await this.#get(`/session/${this.#requireSession()}/alert/text`);
    return typeof out.value === 'string' ? out.value : null;
  }

  /** The buttons the system alert offers, e.g. ["Don't Allow", "Allow"]. */
  async alertButtons() {
    const out = await this.#get(`/session/${this.#requireSession()}/wda/alert/buttons`);
    return Array.isArray(out.value) ? out.value : [];
  }

  /** Press a named button on the system alert (or its default accept button). */
  async acceptAlert(name) {
    const out = await this.#post(`/session/${this.#requireSession()}/alert/accept`, name ? { name } : {});
    if (out.value && out.value.error) throw new Error(`alert accept failed: ${out.value.message}`);
  }

  /**
   * Put a privacy permission back to "not determined" for the session's app, on a real device.
   *
   * `xcrun simctl privacy` does not reach a physical phone. XCUIApplication's
   * resetAuthorizationStatusForResource does, and WDA exposes it. iOS terminates the app as part of
   * the reset, so the caller relaunches. Resource ids are XCUIProtectedResource values
   * (microphone = 5, camera = 6, photos = 4).
   */
  async resetAuthorization(resource) {
    const out = await this.#post(`/session/${this.#requireSession()}/wda/resetAppAuth`, { resource });
    if (out.value && out.value.error) throw new Error(`resetAppAuth failed: ${out.value.message}`);
  }

  /** The accessibility tree as WDA's XML, which carries `accessible="true|false"` per element. */
  async sourceXml() {
    const sid = this.#requireSession();
    const response = await fetch(`${this.#baseUrl}/session/${sid}/source?format=xml`);
    return (await response.json()).value;
  }

  #requireSession() {
    if (!this.#sessionId) throw new Error('No WDA session - call session() first');
    return this.#sessionId;
  }

  /** Logical screen size in points, which is what tap() and swipe() expect. */
  async windowSize() {
    const size = await this.#get(`/session/${this.#requireSession()}/window/size`);
    return { width: size.value.width, height: size.value.height };
  }

  /** Save a PNG screenshot of the device to `path`. */
  async screenshot(path) {
    const shot = await this.#get('/screenshot');
    writeFileSync(path, Buffer.from(shot.value, 'base64'));
  }

  /** The foreground app's accessibility tree. */
  async source() {
    const sid = this.#requireSession();
    const response = await fetch(`${this.#baseUrl}/session/${sid}/source?format=json`);
    return (await response.json()).value;
  }

  /** First element whose label, name or value contains `needle`, case-insensitively. */
  async findByLabel(needle) {
    const wanted = needle.toLowerCase();
    let found = null;
    const walk = (node) => {
      if (!node) return;
      // EVERY identifying field, not the first non-empty one. `label || name || value` short-circuits, and that
      // hid every testID on Android: React Native puts testID in resource-id (node.name), but an accessible
      // container also gets a synthesised content-desc (node.label) built from its children - so label was always
      // truthy and name was never examined. The symptom was believing the platform did not expose testIDs at all.
      const fields = [node.label, node.name, node.value].map((f) => `${f ?? ''}`);
      const hit = fields.find((f) => f.toLowerCase().includes(wanted));
      // A swipe row's hidden actions (e.g. "Delete <chat title>") sit far left of the screen (x -9616) and,
      // being smaller, beat the row itself - the tap then lands off-screen. Skip anything left of x=0.
      if (hit !== undefined && node.rect && node.rect.width > 0 && node.rect.x + node.rect.width > 0) {
        // Prefer the SMALLEST, most exact match. Keeping the last match found meant a full-width
        // wrapper won over the control inside it: searching the file picker for "Open" returned
        // {x:0,y:119,w:440,h:63} - the row containing the search field - so every tap landed in the
        // search box and raised the keyboard while the Open button, untouched, stayed top-right.
        // The run then reported a successful tap and waited forever for a screen that never came.
        const better = (() => {
          if (!found) return true;
          const exact = (value) => value.trim().toLowerCase() === wanted;
          if (exact(hit) !== exact(found.label)) return exact(hit);
          return node.rect.width * node.rect.height < found.rect.width * found.rect.height;
        })();
        if (!better) {
          (node.children || []).forEach(walk);
          return;
        }
        found = {
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
      }
      (node.children || []).forEach(walk);
    };
    walk(await this.source());
    return found;
  }

  /** Tap an absolute point, in logical points, via the W3C actions API. */
  async tap(x, y) {
    await this.#assertFront('tap');
    await this.#post(`/session/${this.#requireSession()}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x, y },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 60 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  /** Drag from one point to another - a scroll, for instance. */
  async swipe(x1, y1, x2, y2) {
    await this.#assertFront('swipe');
    await this.#post(`/session/${this.#requireSession()}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: x1, y: y1 },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerMove', duration: 400, x: x2, y: y2 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }

  /** Find an element by label and tap its centre. Returns the element, or null when it is not there. */
  async tapLabel(needle) {
    const element = await this.findByLabel(needle);
    if (!element) return null;
    await this.tap(element.center.x, element.center.y);
    return element;
  }

  /** Send text to the focused field. Tap the field first so it has focus. */
  async type(text) {
    await this.#assertFront('type');
    await this.#post(`/session/${this.#requireSession()}/wda/keys`, { value: [...text] });
  }

  /** Replace a React Native text field by its testID/accessibility identifier. */
  async replaceTestId(testId, text) {
    if (!/^[a-z0-9_./-]+$/i.test(testId)) throw new Error(`unsafe iOS testID: ${testId}`);
    await this.#assertFront('type');
    const sid = this.#requireSession();
    const found = await this.#post(`/session/${sid}/element`, {
      using: 'accessibility id',
      value: testId,
    });
    const element = found.value?.['element-6066-11e4-a52e-4f735466cecf'] ?? found.value?.ELEMENT;
    if (!element) throw new Error(`iOS could not find text field ${testId}`);
    await this.#post(`/session/${sid}/element/${element}/clear`, {});
    await this.#post(`/session/${sid}/element/${element}/value`, { value: [...text] });
  }

  /**
   * Dismiss the soft keyboard.
   *
   * The project editor's Save control sits below a multiline field and UNDER the keyboard, so a tap
   * aimed at Save lands on a key instead. Android's client hides the keyboard before Save for the
   * same reason; this is the iOS counterpart. Not `back()` - that is an edge swipe, which would
   * leave the editor rather than close the keyboard.
   */
  /** Top edge of the on-screen keyboard, or null when it is not up. */
  async keyboardTop() {
    let top = null;
    const walk = node => {
      if (!node) return;
      if (node.type === 'Keyboard' && node.rect && node.rect.height > 0) {
        top = node.rect.y;
      }
      (node.children || []).forEach(walk);
    };
    walk(await this.source());
    return top;
  }

  async keyboardShown() {
    return (await this.keyboardTop()) !== null;
  }

  /**
   * Ask the keyboard to close. Returns whether it actually went away.
   *
   * Deliberately does NOT fall back to tapping a blind coordinate above the keyboard: on the paste-
   * note sheet that lands on Back and DISCARDS what was typed. A helper that silently destroys the
   * user's input is worse than one that reports it could not close the keyboard - callers position
   * the control instead (see keyboardTop).
   */
  async hideKeyboard() {
    if (!(await this.keyboardShown())) return true;
    const sid = this.#requireSession();
    // WDA's dismiss only works when the keyboard carries a Done/return affordance. A multiline
    // field has none, so the result is CHECKED rather than swallowed.
    await this.#post(`/session/${sid}/wda/keyboard/dismiss`, {}).catch(
      () => {},
    );
    if (!(await this.keyboardShown())) return true;
    // WDA's dismiss does nothing for a multiline field, which has no return key. Our own sheets put
    // a Done bar above the keyboard for exactly this - so press THAT. It is a real control found in
    // the tree, not a coordinate guessed above the keyboard.
    const done = await this.findByLabel('Dismiss keyboard');
    if (done) {
      await this.tap(done.center.x, done.center.y);
      await new Promise(resolve => setTimeout(resolve, 600));
    }
    return !(await this.keyboardShown());
  }

  /** Back one screen. iOS has no hardware back, so this is the edge-swipe-from-left gesture. */
  async back() {
    const { width, height } = await this.windowSize();
    await this.swipe(2, Math.round(height / 2), Math.round(width * 0.6), Math.round(height / 2));
  }

  /**
   * Restart the app so a run starts from a known screen.
   *
   * Same reason as the Android client's: a suite that inherits the previous run's screen fails its first
   * assertion for reasons unrelated to the code. WDA needs a session before it can terminate anything, so this
   * attaches, kills, and launches.
   */
  async restart(bundleId) {
    await this.session();
    const sid = this.#requireSession();
    await this.#post(`/session/${sid}/wda/apps/terminate`, { bundleId }).catch(() => {});
    await this.#post(`/session/${sid}/wda/apps/launch`, { bundleId });
    return sid;
  }

  /**
   * Wait until `check` returns something truthy, polling the device.
   *
   * This is the single most important method here. Driving a real device without it means sleeping for a
   * guessed number of milliseconds after every tap, which is where device tests get their reputation: too
   * short and the test is flaky, too long and a suite takes an hour. Detox avoids this by hooking the React
   * Native bridge to know when the app is idle; a black-box driver cannot, so it polls the thing it actually
   * cares about instead and stops as soon as that is true.
   *
   * Returns whatever `check` returned. Throws with `label` in the message on timeout, because "timed out
   * waiting for the Devices list" is a diagnosis and "timeout" is not.
   */
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

  /** Wait for an element whose label contains `needle`, and return it. */
  waitForLabel(needle, options = {}) {
    return this.waitFor((device) => device.findByLabel(needle), {
      label: `an element labelled "${needle}"`,
      ...options,
    });
  }

  /** Wait for an element to appear, then tap it. The everyday gesture: nothing is tapped blind. */
  async tapWhenReady(needle, options = {}) {
    const element = await this.waitForLabel(needle, options);
    await this.tap(element.center.x, element.center.y);
    return element;
  }

  /** Wait until nothing on screen matches `needle` - a sheet dismissed, a spinner finished. */
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
    const { width, height } = await this.windowSize();
    const x = Math.round(width / 2);
    // "Found" has to mean "reachable". A row that is merely PRESENT can still be half under the tab
    // bar, and tapping its centre then hits the tab bar instead - which is how a freshly created
    // project, visible at the bottom of the list, could not be opened. Keep scrolling until its
    // centre is clear of the chrome at both ends.
    const TAB_BAR = 110;
    const STATUS_BAR = 60;
    const reachable = (element) =>
      element &&
      element.center.y < height - TAB_BAR &&
      element.center.y > STATUS_BAR;

    let seen = await this.findByLabel(needle);
    if (reachable(seen)) return seen;
    for (let attempt = 0; attempt < maxSwipes; attempt += 1) {
      await this.swipe(x, Math.round(height * 0.75), x, Math.round(height * 0.3));
      await new Promise((resolve) => setTimeout(resolve, 500));
      const found = await this.findByLabel(needle).catch(() => null);
      if (reachable(found)) return found;
      if (found) seen = found;
    }
    // Present but never clear of the chrome: a list that ENDS with the target keeps it low no matter
    // how much more you scroll, and on a sheet there is no tab bar over it anyway. Preferring a
    // reachable position is right; refusing a present one outright turned a findable control into
    // "did not appear after 8 swipes".
    if (seen) return seen;
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

  /** Every label currently on screen. The first thing to print when a locator does not match. */
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
}
