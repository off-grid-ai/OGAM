/**
 * run_python Tool Handler Unit Tests
 *
 * The handler is the model-facing surface: it must explain a missing runtime
 * instead of erroring, and format stdout / result / stderr / errors legibly.
 */

import { executeToolCall } from '../../../src/services/tools/handlers';

const mockExecute = jest.fn();
const mockIsInstalled = jest.fn();
const mockRefreshStatus = jest.fn();
jest.mock('../../../src/services/python/pythonRuntimeService', () => ({
  pythonRuntimeService: {
    execute: (...args: any[]) => mockExecute(...args),
    isInstalled: () => mockIsInstalled(),
    refreshStatus: () => mockRefreshStatus(),
  },
}));

let mockStatus = 'installed';
jest.mock('../../../src/stores/pythonRuntimeStore', () => ({
  usePythonRuntimeStore: { getState: () => ({ status: mockStatus }) },
}));

function runPython(code: unknown) {
  return executeToolCall({ id: 'call_1', name: 'run_python', arguments: { code } });
}

describe('run_python handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStatus = 'installed';
    mockIsInstalled.mockReturnValue(true);
  });

  it('errors when code is missing', async () => {
    const result = await runPython(undefined);
    expect(result.error).toContain('Missing required parameter: code');
  });

  it('tells the model how the user can install the runtime when missing', async () => {
    mockIsInstalled.mockReturnValue(false);
    const result = await runPython('print(1)');
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('not installed');
    expect(result.content).toContain('Settings > Tools');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('refreshes status first when it is unknown', async () => {
    mockStatus = 'unknown';
    mockIsInstalled.mockReturnValue(false);
    await runPython('print(1)');
    expect(mockRefreshStatus).toHaveBeenCalledTimes(1);
  });

  it('returns stdout and the last expression value', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: 'hello', stderr: '', result: '42' });
    const result = await runPython('print("hello")\n42');
    expect(result.content).toBe('hello\n[result] 42');
  });

  it('includes stderr and python errors', async () => {
    mockExecute.mockResolvedValue({ ok: false, stdout: '', stderr: 'Traceback...', error: "NameError: name 'x' is not defined" });
    const result = await runPython('x');
    expect(result.content).toContain('[stderr]\nTraceback...');
    expect(result.content).toContain("[error]\nNameError: name 'x' is not defined");
  });

  it('hints at print() when the script produced no output', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: '', stderr: '', result: undefined });
    const result = await runPython('x = 1');
    expect(result.content).toContain('use print()');
  });

  it('truncates very long output', async () => {
    mockExecute.mockResolvedValue({ ok: true, stdout: 'a'.repeat(10000), stderr: '' });
    const result = await runPython('print("a" * 10000)');
    expect(result.content.length).toBeLessThan(6200);
    expect(result.content).toContain('[Output truncated]');
  });

  it('surfaces execution timeouts as tool errors', async () => {
    mockExecute.mockRejectedValue(new Error('Python execution timed out after 30s'));
    const result = await runPython('while True: pass');
    expect(result.error).toContain('timed out');
  });

  it('truncates without splitting a surrogate pair', async () => {
    // 'x' + emoji repeated: the leading 'x' pushes every 2-unit emoji onto an odd
    // boundary, so a naive slice at 6000 would land mid-pair and leave a lone surrogate.
    mockExecute.mockResolvedValue({ ok: true, stdout: `x${'🎉'.repeat(4000)}`, stderr: '' });
    const result = await runPython('print(...)');
    // No unpaired surrogate survives the cut.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(result.content)).toBe(false);
    expect(result.content).toContain('[Output truncated]');
  });
});
