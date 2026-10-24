/**
 * BATCH 9 — Device Info diagnostics computation + debug-log file sink rotation.
 *
 * on-device test-plan lines 1409-1549 (Device Info cases 5-10) + the CLAUDE.md debug-log sink.
 *
 * Two ABSENT-LOGIC gaps closed here — both drive the REAL service, mocking only the
 * genuine boundaries (the native memory module; the RNFS filesystem):
 *
 * 1. HardwareService.getProcessMemory() — the bytes→MB computation behind the Device
 *    Info "available / footprint / limit" rows. Existing tests only MOCK getProcessMemory
 *    at the screen boundary (DeviceInfoScreen.test.tsx), so the rounding + the
 *    limit = available + footprint derivation + the null/throw fallbacks were never run
 *    for real. Deleting the computation would not fail any current test — it fails these.
 *    (getDeviceTier thresholds + formatBytes are already COVERED-REAL in
 *    hardware.test.ts and are NOT duplicated here.)
 *
 * 2. debugLogFile.ts — the file sink's size-cap/rotation logic (flush appends, checks
 *    stat, and truncates to the newest half once over MAX_BYTES), the flush-at-50-lines
 *    trigger, the disabled no-op, idempotent init, and the dev-only wire file. No existing test covers it.
 *    We stand up an in-memory RNFS so the REAL flush()/rotation runs end to end.
 */

import type { NativeFileSystemBoundary } from '../harness/nativeFileSystem';

// ── HardwareService.getProcessMemory computation ───────────────────────────────
describe('BATCH 9 — HardwareService.getProcessMemory (real bytes→MB computation)', () => {
  const { NativeModules } = require('react-native');
  const { hardwareService } = require('../../src/services/hardware');

  const MB = 1024 * 1024;
  let originalModule: unknown;

  beforeEach(() => {
    originalModule = NativeModules.DeviceMemoryModule;
  });
  afterEach(() => {
    NativeModules.DeviceMemoryModule = originalModule;
  });

  it('computes availableMB/footprintMB and derives limitMB = available + footprint (case 8/9)', async () => {
    // 5530 MB available, 660 MB footprint → limit 6190 MB (the exact shape the Device Info
    // screen renders). Provide raw BYTES; the service does the /MB rounding + the sum.
    NativeModules.DeviceMemoryModule = {
      getMemoryInfo: jest.fn(() => Promise.resolve({
        processAvailableBytes: 5530 * MB,
        footprintBytes: 660 * MB,
      })),
    };

    const mem = await hardwareService.getProcessMemory();

    expect(mem).toEqual({ availableMB: 5530, footprintMB: 660, limitMB: 6190 });
    // limitMB is DERIVED, not read from the native payload — prove the derivation.
    expect(mem!.limitMB).toBe(mem!.availableMB + mem!.footprintMB);
  });

  it('rounds fractional MB (Math.round, not truncate)', async () => {
    // 1.6 MB avail → 2 MB; 0.4 MB footprint → 0 MB; limit rounds the summed bytes → 2 MB.
    NativeModules.DeviceMemoryModule = {
      getMemoryInfo: jest.fn(() => Promise.resolve({
        processAvailableBytes: Math.round(1.6 * MB),
        footprintBytes: Math.round(0.4 * MB),
      })),
    };
    const mem = await hardwareService.getProcessMemory();
    expect(mem).toEqual({ availableMB: 2, footprintMB: 0, limitMB: 2 });
  });

  it('returns null when the native memory module is absent (capability gap as null)', async () => {
    NativeModules.DeviceMemoryModule = undefined;
    expect(await hardwareService.getProcessMemory()).toBeNull();
  });

  it('returns null when getMemoryInfo throws (never surfaces a diagnostics error)', async () => {
    NativeModules.DeviceMemoryModule = {
      getMemoryInfo: jest.fn(() => Promise.reject(new Error('native boom'))),
    };
    expect(await hardwareService.getProcessMemory()).toBeNull();
  });

  it('treats missing/NaN byte fields as 0 rather than NaN MB', async () => {
    NativeModules.DeviceMemoryModule = {
      getMemoryInfo: jest.fn(() => Promise.resolve({})), // no fields
    };
    const mem = await hardwareService.getProcessMemory();
    expect(mem).toEqual({ availableMB: 0, footprintMB: 0, limitMB: 0 });
    expect(Number.isNaN(mem!.limitMB)).toBe(false);
  });
});

// ── debugLogFile.ts size-cap / rotation ────────────────────────────────────────
// The shared native boundary provides the directory entry, stored bytes, append, read and truncate
// behavior. The production sink remains real above that device boundary.
jest.mock('react-native-fs', () => {
  const { defaultNativeFileSystemBoundary: boundary } = require('../harness/nativeFileSystem');
  return { __esModule: true, default: boundary.module, ...boundary.module };
});

describe('BATCH 9 — debugLogFile size-cap / rotation (real flush logic)', () => {
  const MAX_BYTES = 5 * 1024 * 1024;
  const LOG_PATH = '/mock/documents/offgrid-debug.log';
  let mod: typeof import('../../src/utils/debugLogFile');
  let fileSystem: NativeFileSystemBoundary;
  const originalDev = (global as any).__DEV__;

  const readLog = async (): Promise<string> =>
    (await fileSystem.exists(LOG_PATH))
      ? fileSystem.module.readFile(LOG_PATH, 'utf8')
      : '';

  beforeEach(() => {
    (global as any).__DEV__ = true; // the wire file is __DEV__-gated
    jest.resetModules(); // fresh module-level `enabled`/`buffer` state per test
    fileSystem = require('../harness/nativeFileSystem').defaultNativeFileSystemBoundary;
    fileSystem.reset();
    jest.useFakeTimers();
    mod = require('../../src/utils/debugLogFile');
  });
  afterEach(() => {
    jest.useRealTimers();
    (global as any).__DEV__ = originalDev;
  });

  it('appendDebugLine is a no-op until initDebugLogFile enables the sink', async () => {
    mod.appendDebugLine('info', 'before init — should be dropped');
    await jest.runOnlyPendingTimersAsync();
    expect(await readLog()).toBe('');
  });

  it('init writes a session-start marker and is idempotent (case: __DEV__ gate)', async () => {
    mod.initDebugLogFile();
    mod.initDebugLogFile(); // second call must not add a second marker
    await jest.runOnlyPendingTimersAsync();
    const markers = (await readLog()).match(/session start/g) ?? [];
    expect(markers).toHaveLength(1);
  });

  it('appended lines land in the file after a scheduled flush', async () => {
    mod.initDebugLogFile();
    mod.appendDebugLine('DL-SM', 'download started');
    await jest.runOnlyPendingTimersAsync();
    expect(await readLog()).toContain('[DL-SM] download started');
  });

  it('flushes immediately once the buffer reaches 50 lines (FLUSH_AT_LINES)', async () => {
    mod.initDebugLogFile();
    await jest.runOnlyPendingTimersAsync(); // drain the init marker
    await fileSystem.module.writeFile(LOG_PATH, '', 'utf8');
    // 49 lines: buffered, not yet flushed (no timer advance).
    for (let i = 0; i < 49; i++) mod.appendDebugLine('x', `line ${i}`);
    expect(await readLog()).toBe('');
    // 50th line trips the immediate flush.
    mod.appendDebugLine('x', 'line 49');
    await Promise.resolve(); await Promise.resolve();
    expect(await readLog()).toContain('line 49');
    expect(await readLog()).toContain('line 0');
  });

  it('rotates to the newest half once the file exceeds MAX_BYTES (5MB cap)', async () => {
    mod.initDebugLogFile();
    await jest.runOnlyPendingTimersAsync();
    // Pre-fill the file just over the cap with an OLD marker at the head.
    await fileSystem.module.writeFile(
      LOG_PATH,
      `OLD_HEAD_MARKER${'a'.repeat(MAX_BYTES)}`,
      'utf8',
    );
    // Append a small NEW line and flush → stat > MAX_BYTES → rotate to newest half.
    mod.appendDebugLine('NEW', 'newest-tail-line');
    await jest.runOnlyPendingTimersAsync();
    await Promise.resolve();

    const content = await readLog();
    const size = Buffer.byteLength(content, 'utf8');
    expect(size).toBeLessThanOrEqual(Math.floor(MAX_BYTES / 2) + 1);
    // The newest content survives; the old head was dropped by the tail-truncation.
    expect(content).toContain('newest-tail-line');
    expect(content).not.toContain('OLD_HEAD_MARKER');
  });

  it('getDebugLogPath points at the app Documents container', () => {
    expect(mod.getDebugLogPath()).toBe('/mock/documents/offgrid-debug.log');
  });

  it('a store build writes the log for Report a problem, but never the unbounded wire file', async () => {
    (global as any).__DEV__ = false;
    jest.resetModules();
    fileSystem = require('../harness/nativeFileSystem').defaultNativeFileSystemBoundary;
    const prodMod = require('../../src/utils/debugLogFile');
    prodMod.initDebugLogFile();
    prodMod.appendDebugLine('info', 'prod line');
    prodMod.appendDebugLine('log', '[WIRE-STT] {"textLength":3}');
    await jest.runOnlyPendingTimersAsync();
    expect(await readLog()).toContain('prod line');
    expect(await fileSystem.exists(prodMod.getWireLogPath())).toBe(false);
  });
});
