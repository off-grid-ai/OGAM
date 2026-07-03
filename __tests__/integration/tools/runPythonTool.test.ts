/**
 * run_python Tool Integration Tests
 *
 * Exercises the full chain with real modules: executeToolCall -> handler ->
 * pythonRuntimeService -> injection protocol -> (fake WebView page) ->
 * message routing -> formatted tool result. Only the filesystem, the static
 * server, and the WebView itself are faked.
 */

jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockFiles: Record<string, string> = {};
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs',
  exists: jest.fn(async (p: string) => p in mockFiles),
  readFile: jest.fn(async (p: string) => {
    if (!(p in mockFiles)) throw new Error(`ENOENT: ${p}`);
    return mockFiles[p];
  }),
  writeFile: jest.fn(async (p: string, content: string) => { mockFiles[p] = content; }),
  mkdir: jest.fn(async () => { }),
  unlink: jest.fn(async () => { }),
  stat: jest.fn(async () => ({ size: 0 })),
  downloadFile: jest.fn(),
}));

jest.mock('@dr.pogodin/react-native-static-server', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    start: jest.fn(async () => 'http://localhost:8899'),
    stop: jest.fn(async () => { }),
  })),
}));

import { executeToolCall } from '../../../src/services/tools/handlers';
import { getToolsAsOpenAISchema, AVAILABLE_TOOLS } from '../../../src/services/tools/registry';
import { pythonRuntimeService } from '../../../src/services/python/pythonRuntimeService';
import { usePythonRuntimeStore } from '../../../src/stores/pythonRuntimeStore';
import { PYODIDE_VERSION, PYTHON_RUNTIME_MARKER_FILE } from '../../../src/services/python/pyodideManifest';

const MARKER_PATH = `/docs/pyodide-runtime/${PYTHON_RUNTIME_MARKER_FILE}`;

/**
 * Fake WebView page: parses each injected request and responds like the real
 * executor page would, echoing a canned python run.
 */
const TRUSTED_URL = 'http://localhost:8899/index.html';

function attachFakePage(run: (code: string) => Record<string, unknown>): void {
  pythonRuntimeService.registerExecutor({
    inject: (js: string) => {
      const match = /window\.__runPython\((.*)\); true;/.exec(js);
      if (!match) throw new Error(`Unexpected injection: ${js}`);
      const req = JSON.parse(match[1]);
      setTimeout(() => {
        pythonRuntimeService.handleWebViewMessage(
          JSON.stringify({ type: 'result', id: req.id, ...run(req.code) }),
          TRUSTED_URL,
        );
      }, 0);
    },
    reload: () => { },
  });
  pythonRuntimeService.handleWebViewMessage(JSON.stringify({ type: 'ready', version: PYODIDE_VERSION }), TRUSTED_URL);
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Mirrors production order: the tool call starts the server and requests the
 * executor, then the host WebView mounts (attachFakePage) and posts ready.
 */
async function callToolWithFakePage(
  call: Parameters<typeof executeToolCall>[0],
  run: (code: string) => Record<string, unknown>,
): Promise<ReturnType<typeof executeToolCall> extends Promise<infer R> ? R : never> {
  const promise = executeToolCall(call);
  await tick();
  attachFakePage(run);
  return promise;
}

describe('run_python tool integration', () => {
  beforeEach(async () => {
    for (const key of Object.keys(mockFiles)) delete mockFiles[key];
    usePythonRuntimeStore.setState({
      status: 'unknown',
      downloadProgress: 0,
      errorMessage: null,
      executorRequested: false,
      serverOrigin: null,
    });
    await pythonRuntimeService.shutdownExecutor();
    pythonRuntimeService.unregisterExecutor();
    jest.clearAllMocks();
  });

  it('is exposed to the model through the OpenAI tool schema', () => {
    expect(AVAILABLE_TOOLS.some(t => t.id === 'run_python')).toBe(true);
    const schema = getToolsAsOpenAISchema(['run_python']);
    expect(schema).toHaveLength(1);
    expect(schema[0].function.name).toBe('run_python');
    expect(schema[0].function.parameters.required).toEqual(['code']);
  });

  it('returns an install hint when the runtime is missing', async () => {
    const result = await executeToolCall({ id: 'c1', name: 'run_python', arguments: { code: 'print(1)' } });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('not installed');
  });

  it('executes code end-to-end through the injection protocol', async () => {
    mockFiles[MARKER_PATH] = JSON.stringify({ version: PYODIDE_VERSION });

    const result = await callToolWithFakePage(
      { id: 'c2', name: 'run_python', arguments: { code: 'print(sum(range(11)))' } },
      () => ({ ok: true, stdout: '55', stderr: '', result: undefined }),
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toBe('55');
    expect(usePythonRuntimeStore.getState().serverOrigin).toBe('http://localhost:8899');
    expect(usePythonRuntimeStore.getState().executorRequested).toBe(true);
  });

  it('carries python exceptions back to the model', async () => {
    mockFiles[MARKER_PATH] = JSON.stringify({ version: PYODIDE_VERSION });

    const result = await callToolWithFakePage(
      { id: 'c3', name: 'run_python', arguments: { code: '1/0' } },
      () => ({
        ok: false,
        stdout: '',
        stderr: 'Traceback (most recent call last):',
        error: 'ZeroDivisionError: division by zero',
      }),
    );

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('ZeroDivisionError');
    expect(result.content).toContain('[stderr]');
  });

  it('keeps interpreter state warm across sequential tool calls', async () => {
    mockFiles[MARKER_PATH] = JSON.stringify({ version: PYODIDE_VERSION });
    const codes: string[] = [];
    const run = (code: string) => {
      codes.push(code);
      return { ok: true, stdout: `run ${codes.length}`, stderr: '' };
    };

    const first = await callToolWithFakePage({ id: 'c4', name: 'run_python', arguments: { code: 'x = 1' } }, run);
    // Second call: executor is already warm, no new page attach needed.
    const second = await executeToolCall({ id: 'c5', name: 'run_python', arguments: { code: 'print(x)' } });

    expect(first.content).toBe('run 1');
    expect(second.content).toBe('run 2');
    expect(codes).toEqual(['x = 1', 'print(x)']);
    // One server, one webview session — the store was only set up once.
    const StaticServer = require('@dr.pogodin/react-native-static-server').default;
    expect(StaticServer).toHaveBeenCalledTimes(1);
  });
});
