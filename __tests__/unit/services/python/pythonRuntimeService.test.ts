/**
 * Python Runtime Service Unit Tests
 *
 * Covers install status detection, the download/verify flow, and the
 * execute() bridge protocol against a fake executor.
 */

import {
  PYODIDE_ALL_ASSETS,
  PYODIDE_VERSION,
  PYTHON_RUNTIME_MARKER_FILE,
} from '../../../../src/services/python/pyodideManifest';

// Mock logger
jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Stateful fake filesystem. `sha` is the digest RNFS.hash will report for the file.
const mockFiles: Record<string, { content: string; size: number; sha?: string }> = {};
let mockDownloadImpl: (opts: { fromUrl: string; toFile: string; progress?: (p: { bytesWritten: number }) => void }) => Promise<{ statusCode: number }>;

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(async (p: string) => Object.keys(mockFiles).some(f => f === p || f.startsWith(`${p}/`))),
  readFile: jest.fn(async (p: string) => {
    if (!mockFiles[p]) throw new Error(`ENOENT: ${p}`);
    return mockFiles[p].content;
  }),
  writeFile: jest.fn(async (p: string, content: string) => {
    mockFiles[p] = { content, size: content.length };
  }),
  mkdir: jest.fn(async () => { }),
  unlink: jest.fn(async (p: string) => {
    for (const key of Object.keys(mockFiles)) {
      if (key === p || key.startsWith(`${p}/`)) delete mockFiles[key];
    }
  }),
  stat: jest.fn(async (p: string) => {
    if (!mockFiles[p]) throw new Error(`ENOENT: ${p}`);
    return { size: mockFiles[p].size };
  }),
  hash: jest.fn(async (p: string) => {
    if (!mockFiles[p]) throw new Error(`ENOENT: ${p}`);
    return mockFiles[p].sha ?? '';
  }),
  downloadFile: jest.fn((opts: any) => ({ promise: mockDownloadImpl(opts) })),
}));

const mockServerStart = jest.fn(async () => 'http://localhost:8899');
const mockServerStop = jest.fn(async () => { });
jest.mock('@dr.pogodin/react-native-static-server', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ start: mockServerStart, stop: mockServerStop })),
}));

import { pythonRuntimeService } from '../../../../src/services/python/pythonRuntimeService';
import { usePythonRuntimeStore } from '../../../../src/stores/pythonRuntimeStore';

const RUNTIME_DIR = '/docs/pyodide-runtime';
const MARKER_PATH = `${RUNTIME_DIR}/${PYTHON_RUNTIME_MARKER_FILE}`;

function resetStore(): void {
  usePythonRuntimeStore.setState({
    status: 'unknown',
    downloadProgress: 0,
    errorMessage: null,
    executorRequested: false,
    serverOrigin: null,
  });
}

function writeMarker(version: string = PYODIDE_VERSION): void {
  const content = JSON.stringify({ version, installedAt: '2026-01-01T00:00:00.000Z' });
  mockFiles[MARKER_PATH] = { content, size: content.length };
}

function successfulDownloads(): void {
  mockDownloadImpl = async (opts) => {
    const fileName = opts.toFile.split('/').pop()!;
    const asset = PYODIDE_ALL_ASSETS.find(a => a.fileName === fileName);
    // A well-behaved download lands the exact bytes + digest the manifest expects.
    mockFiles[opts.toFile] = { content: 'binary', size: asset ? asset.bytes : 0, sha: asset?.sha256 };
    opts.progress?.({ bytesWritten: asset ? asset.bytes : 0 });
    return { statusCode: 200 };
  };
}

// The loopback URL the native WebView reports as the message source in these tests.
const TRUSTED_URL = 'http://localhost:8899/index.html';

/** Registers a fake executor and marks the interpreter ready. */
function registerReadyExecutor(inject: (js: string) => void = () => { }, reload: () => void = () => { }): void {
  pythonRuntimeService.registerExecutor({ inject, reload });
  pythonRuntimeService.handleWebViewMessage(JSON.stringify({ type: 'ready', version: PYODIDE_VERSION }), TRUSTED_URL);
}

/** Extracts the injected request payload from buildRunInjection output. */
function parseInjectedRequest(js: string): { id: string; code: string } {
  const match = /window\.__runPython\((.*)\); true;/.exec(js);
  if (!match) throw new Error(`Unexpected injection: ${js}`);
  return JSON.parse(match[1]);
}

describe('pythonRuntimeService', () => {
  beforeEach(async () => {
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    successfulDownloads();
    resetStore();
    await pythonRuntimeService.shutdownExecutor();
    pythonRuntimeService.unregisterExecutor();
    jest.clearAllMocks();
  });

  describe('refreshStatus', () => {
    it('reports not_installed when no marker exists', async () => {
      await pythonRuntimeService.refreshStatus();
      expect(usePythonRuntimeStore.getState().status).toBe('not_installed');
    });

    it('reports installed when the marker matches the pinned version', async () => {
      writeMarker();
      await pythonRuntimeService.refreshStatus();
      expect(usePythonRuntimeStore.getState().status).toBe('installed');
    });

    it('forces reinstall when the marker version differs', async () => {
      writeMarker('0.20.0');
      await pythonRuntimeService.refreshStatus();
      expect(usePythonRuntimeStore.getState().status).toBe('not_installed');
    });

    it('treats a corrupt marker as not installed', async () => {
      mockFiles[MARKER_PATH] = { content: 'not json', size: 8 };
      await pythonRuntimeService.refreshStatus();
      expect(usePythonRuntimeStore.getState().status).toBe('not_installed');
    });
  });

  describe('install', () => {
    it('downloads every asset, writes the page and marker, and reports installed', async () => {
      await pythonRuntimeService.install();

      const state = usePythonRuntimeStore.getState();
      expect(state.status).toBe('installed');
      expect(state.downloadProgress).toBe(1);
      for (const asset of PYODIDE_ALL_ASSETS) {
        expect(mockFiles[`${RUNTIME_DIR}/${asset.fileName}`]).toBeDefined();
      }
      expect(mockFiles[`${RUNTIME_DIR}/index.html`].content).toContain('loadPyodide');
      expect(JSON.parse(mockFiles[MARKER_PATH].content).version).toBe(PYODIDE_VERSION);
    });

    it('reports error and throws when a download returns a non-200 status', async () => {
      mockDownloadImpl = async () => ({ statusCode: 503 });

      await expect(pythonRuntimeService.install()).rejects.toThrow('HTTP 503');
      const state = usePythonRuntimeStore.getState();
      expect(state.status).toBe('error');
      expect(state.errorMessage).toContain('HTTP 503');
    });

    it('reports error when a downloaded file size does not match the manifest', async () => {
      mockDownloadImpl = async (opts) => {
        mockFiles[opts.toFile] = { content: 'short', size: 5 };
        return { statusCode: 200 };
      };

      await expect(pythonRuntimeService.install()).rejects.toThrow('Size mismatch');
      expect(usePythonRuntimeStore.getState().status).toBe('error');
    });

    it('rejects a right-size file whose SHA-256 does not match (tamper/MITM)', async () => {
      mockDownloadImpl = async (opts) => {
        const fileName = opts.toFile.split('/').pop()!;
        const asset = PYODIDE_ALL_ASSETS.find(a => a.fileName === fileName);
        // Correct byte-count, wrong content digest — the exact case size alone misses.
        mockFiles[opts.toFile] = { content: 'tampered', size: asset ? asset.bytes : 0, sha: 'deadbeef' };
        return { statusCode: 200 };
      };

      await expect(pythonRuntimeService.install()).rejects.toThrow('Integrity check failed');
      expect(usePythonRuntimeStore.getState().status).toBe('error');
    });

    it('clears a prior install before re-downloading (no orphaned version-tagged assets)', async () => {
      // Simulate leftovers from an earlier pyodide version still on disk.
      mockFiles[`${RUNTIME_DIR}/numpy-1.0.0-old.whl`] = { content: 'stale', size: 5 };
      await pythonRuntimeService.install();
      expect(mockFiles[`${RUNTIME_DIR}/numpy-1.0.0-old.whl`]).toBeUndefined();
      expect(usePythonRuntimeStore.getState().status).toBe('installed');
    });

    it('is a no-op when already installed', async () => {
      writeMarker();
      await pythonRuntimeService.refreshStatus();
      const RNFS = require('react-native-fs');
      await pythonRuntimeService.install();
      expect(RNFS.downloadFile).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the runtime dir and reports not_installed', async () => {
      await pythonRuntimeService.install();
      await pythonRuntimeService.remove();

      expect(usePythonRuntimeStore.getState().status).toBe('not_installed');
      expect(mockFiles[MARKER_PATH]).toBeUndefined();
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      writeMarker();
      await pythonRuntimeService.refreshStatus();
    });

    const tick = () => new Promise(resolve => setTimeout(resolve, 0));

    /**
     * Mirrors the production sequence: execute() starts the server and
     * requests the executor, THEN the host WebView mounts (registers the
     * executor) and the page posts 'ready'. Returns the still-pending
     * execution wrapped in an object so `await` does not flatten it.
     */
    async function startExecution(
      code: string,
      opts: { timeoutMs?: number },
      inject: (js: string) => void,
      reload: () => void = () => { },
    ): Promise<{ promise: Promise<import('../../../../src/services/python/pythonRuntimeService').PythonExecutionResult> }> {
      const promise = pythonRuntimeService.execute(code, opts);
      promise.catch(() => { }); // expectation attaches later
      await tick();
      registerReadyExecutor(inject, reload);
      await tick();
      return { promise };
    }

    function respondWith(payload: Record<string, unknown>): (js: string) => void {
      return (js) => {
        const req = parseInjectedRequest(js);
        setTimeout(() => {
          pythonRuntimeService.handleWebViewMessage(JSON.stringify({ type: 'result', id: req.id, ...payload }), TRUSTED_URL);
        }, 0);
      };
    }

    it('throws when the runtime is not installed', async () => {
      for (const key of Object.keys(mockFiles)) delete mockFiles[key];
      resetStore();
      await expect(pythonRuntimeService.execute('print(1)')).rejects.toThrow('not installed');
    });

    it('starts the server, injects the request, and resolves with the page result', async () => {
      const injected: string[] = [];
      const { promise } = await startExecution('print("hello")\n42', {}, js => {
        injected.push(js);
        respondWith({ ok: true, stdout: 'hello', stderr: '', result: '42' })(js);
      });

      const result = await promise;

      expect(mockServerStart).toHaveBeenCalledTimes(1);
      expect(usePythonRuntimeStore.getState().serverOrigin).toBe('http://localhost:8899');
      expect(usePythonRuntimeStore.getState().executorRequested).toBe(true);
      expect(injected).toHaveLength(1);
      expect(parseInjectedRequest(injected[0]).code).toBe('print("hello")\n42');
      expect(result).toEqual({ ok: true, stdout: 'hello', stderr: '', result: '42', error: undefined });
    });

    it('resolves failed executions with the python error', async () => {
      const { promise } = await startExecution('x', {}, respondWith({
        ok: false, stdout: '', stderr: 'Traceback', error: 'NameError: x',
      }));

      const result = await promise;
      expect(result.ok).toBe(false);
      expect(result.error).toBe('NameError: x');
      expect(result.stderr).toBe('Traceback');
    });

    it('reuses the running server and warm executor across calls', async () => {
      const responder = respondWith({ ok: true, stdout: '', stderr: '' });
      const { promise } = await startExecution('1', {}, responder);
      await promise;

      // Second call: executor already ready, no second server start.
      await pythonRuntimeService.execute('2');
      expect(mockServerStart).toHaveBeenCalledTimes(1);
    });

    it('times out a hung script and reloads the interpreter', async () => {
      const reload = jest.fn();
      const { promise } = await startExecution('while True: pass', { timeoutMs: 30 }, () => { /* never responds */ }, reload);

      await expect(promise).rejects.toThrow('timed out');
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('rejects when the interpreter fails to boot', async () => {
      pythonRuntimeService.registerExecutor({ inject: () => { }, reload: () => { } });
      const pending = pythonRuntimeService.execute('1');
      // eslint-disable-next-line jest/valid-expect -- awaited below, after the boot_error is posted
      const expectation = expect(pending).rejects.toThrow('failed to start');
      await tick();
      pythonRuntimeService.handleWebViewMessage(JSON.stringify({ type: 'boot_error', error: 'wasm compile failed' }), TRUSTED_URL);
      await expectation;
    });

    it('ignores malformed webview messages', () => {
      expect(() => pythonRuntimeService.handleWebViewMessage('not json', TRUSTED_URL)).not.toThrow();
      expect(() => pythonRuntimeService.handleWebViewMessage('{"type":"other"}', TRUSTED_URL)).not.toThrow();
    });

    it('drops any message with no native source URL (fails closed)', async () => {
      const { promise } = await startExecution('1', { timeoutMs: 5000 }, js => {
        const req = parseInjectedRequest(js);
        // Missing url → must be treated as untrusted and dropped...
        pythonRuntimeService.handleWebViewMessage(JSON.stringify({ type: 'result', id: req.id, ok: true, stdout: 'no-url' }));
        // ...the same result with the trusted url settles it.
        setTimeout(() => pythonRuntimeService.handleWebViewMessage(
          JSON.stringify({ type: 'result', id: req.id, ok: true, stdout: 'trusted' }), TRUSTED_URL), 0);
      });
      expect((await promise).stdout).toBe('trusted');
    });

    it('rejects in-flight executions when the executor unmounts', async () => {
      const { promise } = await startExecution('1', { timeoutMs: 5000 }, () => { /* never responds */ });
      // eslint-disable-next-line jest/valid-expect -- awaited below, after the executor unregisters
      const expectation = expect(promise).rejects.toThrow('shut down');
      pythonRuntimeService.unregisterExecutor();
      await expectation;
    });

    it('drops forged result messages from an untrusted origin', async () => {
      const { promise } = await startExecution('1', { timeoutMs: 5000 }, js => {
        const req = parseInjectedRequest(js);
        // An attacker-controlled page (post-navigation) forges a result...
        pythonRuntimeService.handleWebViewMessage(
          JSON.stringify({ type: 'result', id: req.id, ok: true, stdout: 'forged' }),
          'https://attacker.example/',
        );
        // ...the genuine loopback page delivers the real one.
        setTimeout(() => pythonRuntimeService.handleWebViewMessage(
          JSON.stringify({ type: 'result', id: req.id, ok: true, stdout: 'real' }),
          'http://localhost:8899/index.html',
        ), 0);
      });

      const result = await promise;
      expect(result.stdout).toBe('real');
    });

    it('serializes overlapping execute() calls on the shared interpreter', async () => {
      const events: string[] = [];
      // Both queue immediately; the first starts the server, then the page mounts.
      const both = Promise.all([pythonRuntimeService.execute('A'), pythonRuntimeService.execute('B')]);
      both.catch(() => { });
      await tick();
      registerReadyExecutor(js => {
        const req = parseInjectedRequest(js);
        events.push(`inject:${req.code}`);
        setTimeout(() => {
          events.push(`resolve:${req.code}`);
          pythonRuntimeService.handleWebViewMessage(JSON.stringify({ type: 'result', id: req.id, ok: true, stdout: '' }), TRUSTED_URL);
        }, 5);
      });

      await both;

      // B must not be injected until A has fully resolved — no interleaving.
      expect(events).toEqual(['inject:A', 'resolve:A', 'inject:B', 'resolve:B']);
    });

    it('self-heals after a boot timeout by tearing down the dead server', async () => {
      // execute() requests the executor but the page never signals ready.
      const promise = pythonRuntimeService.execute('1', { timeoutMs: 50000 });
      promise.catch(() => { });
      await tick();
      // No executor registers / no ready → the boot timer eventually fires.
      // Speed it up by triggering the crash path directly, as the timer would.
      pythonRuntimeService.notifyExecutorCrashed('interpreter did not start in time');

      await expect(promise).rejects.toThrow(/unavailable|did not start|shut down/);
      // Server torn down and origin cleared so the next call rebuilds from scratch.
      expect(mockServerStop).toHaveBeenCalled();
      expect(usePythonRuntimeStore.getState().serverOrigin).toBeNull();
    });
  });
});
