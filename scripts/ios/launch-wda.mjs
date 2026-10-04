#!/usr/bin/env -S node --no-warnings
/**
 * Bring WebDriverAgent up on a physical iPhone and print its server URL.
 *
 * Run: `node scripts/ios/launch-wda.mjs` (add `WDA_UDID=<hardware-udid>` to pick a device when more than one
 * is attached; `xcrun xctrace list devices` prints them). Leave the process running - it IS the server.
 *
 * Seven facts are baked in here because each one cost hours to find on iOS 26 + Xcode 26:
 *
 *   1. Build WDA for a GENERIC iOS destination, not the device id. A device-id destination hangs on
 *      "Device is busy (Connecting)" under CoreDevice.
 *   2. Sign with the team the APP uses, not whatever the keychain certificate defaults to.
 *   3. Neutralise WDA's "Embed app icon" post-action - it aborts build-for-testing on Xcode 26 and is purely
 *      cosmetic. `npm install` restores it, so this is re-applied on every run and is idempotent.
 *   4. Install the built .app with `devicectl`. xcodebuild's device destination cannot.
 *   5. Launch with `xcodebuild test-without-building`. The "launch without xcodebuild" route exits without
 *      ever serving on this OS.
 *   6. No tunnel is needed for the HTTP - WDA serves over the device's own address, which it prints.
 *   7. Keep the phone UNLOCKED with Auto-Lock set to Never, or WDA is suspended and dies mid-run.
 *
 * WDA itself comes from the appium-webdriveragent checkout under ~/.appium. This script only builds, installs
 * and launches it; the driving is done by scripts/ios/wda-client.mjs.
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const TEAM = process.env.WDA_TEAM ?? '84V6KCAC49';
const WDA_BUNDLE = process.env.WDA_BUNDLE ?? 'ai.offgridmobile.WebDriverAgentRunner';
const WDA_ROOT =
  process.env.WDA_ROOT ??
  `${process.env.HOME}/.appium/node_modules/appium-xcuitest-driver/node_modules/appium-webdriveragent`;
const WDA_PROJ = `${WDA_ROOT}/WebDriverAgent.xcodeproj`;
const DERIVED = process.env.WDA_DERIVED_DATA ?? '/tmp/offgrid-wda-dd';

const log = (...parts) => console.log('[launch-wda]', ...parts);

/** The attached device, or the one WDA_UDID names. */
function resolveUdid() {
  if (process.env.WDA_UDID) return process.env.WDA_UDID;
  const listed = execFileSync('xcrun', ['xctrace', 'list', 'devices'], { encoding: 'utf8' });
  // Physical devices appear above "== Devices Offline =="; simulators carry a "Simulator" suffix.
  const attached = listed
    .split('== Devices Offline ==')[0]
    .split('\n')
    .filter((line) => !line.includes('Simulator') && /\(([0-9A-Fa-f-]{25,})\)\s*$/.test(line));
  const udid = attached[0]?.match(/\(([0-9A-Fa-f-]{25,})\)\s*$/)?.[1];
  if (!udid) {
    throw new Error(
      'No physical iPhone found. Attach one and trust this Mac, or set WDA_UDID explicitly ' +
        '(`xcrun xctrace list devices`).',
    );
  }
  log('device:', attached[0].trim());
  return udid;
}

/** Fact 3: make the cosmetic icon-embed post-action a no-op. */
function neutraliseIconScript() {
  const script = join(WDA_ROOT, 'Scripts/embed-runner-icon.sh');
  if (!existsSync(script)) return;
  const body = readFileSync(script, 'utf8');
  if (body.trim() === 'exit 0' || body.includes('Neutralised for Off Grid')) return;
  copyFileSync(script, `${script}.orig`);
  writeFileSync(
    script,
    '#!/bin/bash\n# Neutralised for Off Grid: cosmetic, and it aborts build-for-testing on Xcode 26.\nexit 0\n',
  );
  log('neutralised embed-runner-icon.sh');
}

/** Facts 1-2: build for a generic iOS device, signed with the app's team. */
function buildWda() {
  const app = `${DERIVED}/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app`;
  if (existsSync(app)) {
    log('WDA already built at', app);
    return;
  }
  if (!existsSync(WDA_PROJ)) {
    throw new Error(
      `WebDriverAgent is not checked out at ${WDA_ROOT}. Install it with ` +
        '`npm i -g appium && appium driver install xcuitest`, or point WDA_ROOT at an existing copy.',
    );
  }
  log('building WDA (generic iOS, team', `${TEAM})…`);
  execFileSync(
    'xcodebuild',
    [
      'build-for-testing',
      '-project',
      WDA_PROJ,
      '-scheme',
      'WebDriverAgentRunner',
      '-destination',
      'generic/platform=iOS',
      '-derivedDataPath',
      DERIVED,
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
      'CODE_SIGN_STYLE=Automatic',
      `DEVELOPMENT_TEAM=${TEAM}`,
      'CODE_SIGN_IDENTITY=Apple Development',
      `PRODUCT_BUNDLE_IDENTIFIER=${WDA_BUNDLE}`,
    ],
    { stdio: 'inherit' },
  );
}

/** Fact 4: install with devicectl, not xcodebuild. */
function installWda(udid) {
  const app = `${DERIVED}/Build/Products/Debug-iphoneos/WebDriverAgentRunner-Runner.app`;
  log('installing WDA via devicectl…');
  execFileSync('xcrun', ['devicectl', 'device', 'install', 'app', '--device', udid, app], {
    stdio: 'inherit',
  });
}

/** Facts 5-6: launch via test-without-building and read the URL it prints. */
function startWdaServer(udid) {
  const xctestrun = execFileSync('bash', [
    '-lc',
    `ls ${DERIVED}/Build/Products/WebDriverAgentRunner_*.xctestrun | head -1`,
  ])
    .toString()
    .trim();
  log('launching WDA:', xctestrun);
  const proc = spawn(
    'xcodebuild',
    ['test-without-building', '-xctestrun', xctestrun, '-destination', `id=${udid}`],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  return new Promise((resolve, reject) => {
    const onData = (buf) => {
      const found = buf.toString().match(/ServerURLHere->(.*?)<-ServerURLHere/);
      if (found) {
        log('WDA serving at', found[1]);
        resolve({ url: found[1].trim(), proc });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) =>
      reject(new Error(`xcodebuild exited (${code}) before WDA served - is the phone unlocked?`)),
    );
    setTimeout(() => reject(new Error('timed out waiting for WDA ServerURLHere')), 180_000);
  });
}

const udid = resolveUdid();
neutraliseIconScript();
buildWda();
installWda(udid);
const { url, proc } = await startWdaServer(udid);
console.log(`\nWDA_URL=${url}`);
console.log('WDA is up. Leave this process running; point scripts/ios/wda-client.mjs at the URL above.');
// Fact 7's corollary: this process IS the server, so its lifetime is the xcodebuild child's. The
// child's pipes keep the event loop alive and the await settles when the server exits. A
// never-settling top-level await is not an option: Node 22+ treats it as a bug and exits 13, which
// took WDA down seconds after it printed its URL.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => proc.kill(signal));
}
const exitCode = await new Promise((resolve) => proc.on('exit', (code) => resolve(code ?? 1)));
log(`WDA stopped: xcodebuild exited (${exitCode})`);
process.exit(exitCode === 0 ? 0 : 1);
