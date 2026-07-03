/**
 * Python Executor Page Unit Tests
 *
 * The generated HTML and the injection/message protocol are the contract
 * between pythonRuntimeService and the WebView page.
 */

import {
  buildPythonPageHtml,
  buildRunInjection,
  parsePythonPageMessage,
  PAGE_MAX_STREAM_CHARS,
} from '../../../../src/services/python/pythonPage';

describe('buildPythonPageHtml', () => {
  const html = buildPythonPageHtml();

  it('loads pyodide from the served directory', () => {
    expect(html).toContain('<script src="pyodide.js"></script>');
    expect(html).toContain("loadPyodide({ indexURL: './' })");
  });

  it('locks network access down with a CSP', () => {
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'self'");
    // micropip hosts are the only remote origins allowed
    expect(html).toContain('https://pypi.org');
    expect(html).toContain('https://files.pythonhosted.org');
  });

  it('defines the __runPython entry point and posts results back', () => {
    expect(html).toContain('window.__runPython');
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain("type: 'ready'");
    expect(html).toContain("type: 'result'");
    expect(html).toContain("type: 'boot_error'");
  });

  it('caps stream output at the source and sanitizes surrogates before the bridge', () => {
    expect(html).toContain(`var MAX_STREAM_CHARS = ${PAGE_MAX_STREAM_CHARS}`);
    expect(html).toContain('[output truncated]');
    // Surrogate sanitizer wraps the payload before postMessage.
    expect(html).toContain('sanitizeSurrogates(JSON.stringify(msg))');
    expect(html).toContain('\\uFFFD');
  });
});

describe('buildRunInjection', () => {
  it('produces a JS statement carrying the request as JSON', () => {
    const js = buildRunInjection({ id: 'abc', code: 'print("hi")' });
    expect(js).toBe('window.__runPython({"id":"abc","code":"print(\\"hi\\")"}); true;');
  });

  it('safely encodes newlines and quotes in code', () => {
    const code = 'x = "a\'b"\nprint(x)';
    const js = buildRunInjection({ id: '1', code });
    const parsed = JSON.parse(/window\.__runPython\((.*)\); true;/.exec(js)![1]);
    expect(parsed.code).toBe(code);
  });

  it('escapes U+2028/U+2029 so old WebView engines cannot break parsing', () => {
    const code = `a = 1${String.fromCharCode(0x2028)}b = 2${String.fromCharCode(0x2029)}`;
    const js = buildRunInjection({ id: '1', code });
    // The raw line/paragraph separators must not appear literally in the statement.
    expect(js).not.toContain(String.fromCharCode(0x2028));
    expect(js).not.toContain(String.fromCharCode(0x2029));
    expect(js).toContain('\\u2028');
    expect(js).toContain('\\u2029');
    // ...and it still round-trips back to the original code.
    const parsed = JSON.parse(/window\.__runPython\((.*)\); true;/.exec(js)![1]);
    expect(parsed.code).toBe(code);
  });
});

describe('parsePythonPageMessage', () => {
  it('parses valid runtime messages', () => {
    expect(parsePythonPageMessage('{"type":"ready","version":"0.27.7"}')).toEqual({ type: 'ready', version: '0.27.7' });
    expect(parsePythonPageMessage('{"type":"result","id":"1","ok":true}')).toMatchObject({ type: 'result', id: '1' });
    expect(parsePythonPageMessage('{"type":"boot_error","error":"x"}')).toMatchObject({ type: 'boot_error' });
  });

  it('returns null for non-runtime and malformed messages', () => {
    expect(parsePythonPageMessage('not json')).toBeNull();
    expect(parsePythonPageMessage('{"type":"console-log"}')).toBeNull();
    expect(parsePythonPageMessage('42')).toBeNull();
  });
});
