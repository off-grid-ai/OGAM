/**
 * The macOS desktop as a DRIVABLE mesh participant, over the DevTools protocol.
 *
 * Why this exists: the Mac on .64 cannot be driven the two ways you would reach for first. macOS
 * refuses synthetic clicks to an ssh session (-25211), and this app publishes no accessibility tree at
 * all - every `entire contents of front window` query returns -1700, so desktop-ssh.mjs's labels()
 * cannot read it either. That left screenshots, which a human has to interpret, and which cannot click.
 *
 * But the packaged app is a normal Electron target, so relaunching it with --remote-debugging-port makes
 * its renderer scriptable: a DOM-level click is not a synthetic OS event, so nothing refuses it. That
 * keeps the REAL profile - the real licence, the real device identity, the real pairings - which a
 * Playwright run cannot do, because Playwright launches its own instance on a throwaway profile and
 * would join the mesh as a different device.
 *
 * Node's built-in WebSocket does the talking, so there is no dependency to install on either machine.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { selectMainOffGridPage } from './desktop-target.mjs';

const run = promisify(execFile);

const HOST = process.env.E2E_DESKTOP_HOST ?? '192.168.1.64';
const USER = process.env.E2E_DESKTOP_USER ?? 'admin';
const PASSWORD = process.env.E2E_DESKTOP_PASSWORD ?? '1234';
const APP = process.env.E2E_DESKTOP_APP_PATH ?? '/Users/admin/offgrid-app/Off Grid AI Desktop.app';
const PORT = Number(process.env.E2E_DESKTOP_CDP_PORT ?? 9222);

const ssh = async (command, { timeoutMs = 60_000 } = {}) => {
  const { stdout } = await run(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', `${USER}@${HOST}`, command],
    { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  );
  return stdout.trim();
};

/** Is the debugging port already answering ON the box? */
const cdpUpRemotely = async () =>
  (await ssh(`curl -s --max-time 4 http://127.0.0.1:${PORT}/json/version >/dev/null && echo up || echo down`))
    .includes('up');

/**
 * Relaunch the packaged app with the debugging port open.
 *
 * A plain `open` over ssh cannot switch audit sessions, hence launchctl asuser - without it the app
 * starts with no GUI session and renders nothing.
 */
export const relaunchWithCdp = async () => {
  await ssh(`pkill -f "Off Grid AI Desktop.app/Contents/MacOS"; sleep 3; echo done`).catch(() => {});
  await ssh(
    `echo ${PASSWORD} | sudo -S -p "" launchctl asuser 501 open -a ${JSON.stringify(APP)} --args --remote-debugging-port=${PORT}`,
  );
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    if (await cdpUpRemotely()) return true;
  }
  throw new Error(`the app never opened a debugging port on ${HOST}:${PORT}`);
};

/** ssh -L so CDP's WebSocket is reachable from here; the port is bound to loopback on the box. */
const openTunnel = async () => {
  const child = spawn(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-N', '-L', `${PORT}:127.0.0.1:${PORT}`, `${USER}@${HOST}`],
    { stdio: 'ignore', detached: false },
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return child;
    } catch {
      // not up yet
    }
  }
  child.kill();
  throw new Error('could not tunnel the debugging port to this machine');
};

/** A live connection to the app's window, with `evaluate` and the primitives a flow needs. */
export const connectDesktop = async ({ relaunch = false } = {}) => {
  if (relaunch || !(await cdpUpRemotely())) await relaunchWithCdp();
  const tunnel = await openTunnel();

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = selectMainOffGridPage(targets);
  if (!page) throw new Error(`no Off Grid page target. Saw: ${targets.map((t) => t.title).join(' | ')}`);

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
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = (nextId += 1);
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  // Data reaches the page as CDP arguments, never spliced into source.
  let globalObjectId;
  const call = async (fn, ...args) => {
    if (!globalObjectId) {
      const { result } = await send('Runtime.evaluate', { expression: 'globalThis' });
      globalObjectId = result.objectId;
    }
    const result = await send('Runtime.callFunctionOn', {
      objectId: globalObjectId,
      functionDeclaration: fn.toString(),
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `the page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result.value;
  };

  const desktop = {
    platform: 'macos',

    /** Run an expression in the renderer and return its value. Throws with the page's own error. */
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', {
        expression: `(() => { ${expression} })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          `the page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
        );
      }
      return result.result.value;
    },

    /** Every bit of text the window is rendering - the desktop's answer to labels(). */
    text() {
      return desktop.evaluate('return document.body.innerText;');
    },

    /**
     * Click by visible text. A DOM click, not an OS event, so -25211 does not apply.
     * Prefers the smallest matching element so a match on a container does not click the whole sidebar.
     */
    clickText(needle) {
      return call((wanted) => {
        const hits = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], li, div, span')]
          .filter((el) => (el.innerText ?? '').trim().toLowerCase() === wanted && el.offsetParent !== null);
        const target = hits.sort((a, b) => a.innerText.length - b.innerText.length)[0]
          ?? [...document.querySelectorAll('button, a, [role="button"], [role="tab"], li, div, span')]
            .filter((el) => (el.innerText ?? '').toLowerCase().includes(wanted) && el.offsetParent !== null)
            .sort((a, b) => a.innerText.length - b.innerText.length)[0];
        if (!target) return false;
        target.click();
        return true;
      }, needle.toLowerCase());
    },

    /** Poll the page until `check` (an expression returning truthy) passes, and name what was awaited. */
    async waitFor(expression, { label = 'condition', timeoutMs = 30_000, intervalMs = 1000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const value = await desktop.evaluate(expression).catch(() => null);
        if (value) return value;
        if (Date.now() >= deadline) {
          throw new Error(`timed out after ${timeoutMs}ms waiting for ${label} on the Mac`);
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },

    /** The 8-character pairing code the Mac is showing, read from its own DOM. */
    async pairingCode() {
      await desktop.waitFor(
        'return /PAIRING CODE/i.test(document.body.innerText) ? 1 : 0;',
        { label: 'the Devices screen to show a pairing code' },
      );
      const code = await desktop.evaluate(`
        const match = document.body.innerText.match(/\\b([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4})\\b/);
        return match ? match[1] : null;
      `);
      if (!code) throw new Error('the Devices screen is up but shows no pairing code');
      return code;
    },

    /** Navigate to Devices. Idempotent: a no-op when it is already there. */
    async openDevices() {
      if (/PAIRING CODE/i.test((await desktop.text()) ?? '')) return true;
      await desktop.clickText('Devices');
      await desktop.waitFor('return /PAIRING CODE/i.test(document.body.innerText) ? 1 : 0;', {
        label: 'the Devices screen',
        timeoutMs: 20_000,
      });
      return true;
    },

    async screenshot(localPath) {
      await ssh('screencapture -x /tmp/offgrid-cdp-shot.png');
      await run('scp', ['-o', 'BatchMode=yes', `${USER}@${HOST}:/tmp/offgrid-cdp-shot.png`, localPath]);
    },

    close() {
      socket.close();
      tunnel.kill();
    },
  };

  return desktop;
};
