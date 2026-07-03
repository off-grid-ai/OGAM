/**
 * Python Executor Page
 *
 * Generates the HTML page the hidden WebView loads from the local static
 * server. The page boots Pyodide and exposes window.__runPython, which the
 * runtime service invokes via injectJavaScript. Results flow back through
 * window.ReactNativeWebView.postMessage as JSON.
 *
 * Sandbox: the CSP restricts network access to the local server itself plus
 * the PyPI hosts micropip needs. Model-written code cannot reach any other
 * origin, and Pyodide's filesystem is in-memory only.
 */

/** Message from the page to the runtime service. */
export interface PythonPageMessage {
  type: 'ready' | 'result' | 'boot_error';
  id?: string;
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  result?: string;
  error?: string;
  version?: string;
}

/** Request injected into the page. */
export interface PythonPageRequest {
  id: string;
  code: string;
}

/**
 * Per-stream character ceiling enforced inside the page's stdout/stderr sinks,
 * before anything is serialized across the WebView bridge. Sized well above the
 * native-side model cap (6000) so normal output is untouched, but low enough
 * that a runaway print loop can't build a multi-MB string on a low-RAM device.
 */
export const PAGE_MAX_STREAM_CHARS = 100000;

const CSP = [
  "default-src 'self'",
  // Pyodide needs eval for its JS/Python FFI and WASM compilation.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  // 'self' covers local wheel loading; the PyPI hosts enable micropip installs.
  "connect-src 'self' https://pypi.org https://files.pythonhosted.org https://cdn.jsdelivr.net",
].join('; ');

export function buildPythonPageHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
</head>
<body>
<script src="pyodide.js"></script>
<script>
(function () {
  // Hard ceiling per stream so unbounded output (e.g. print('a' * 200_000_000))
  // cannot materialize a giant string, cross the bridge, and OOM the app. The
  // native side truncates again for the model; this cap protects the device.
  var MAX_STREAM_CHARS = ${PAGE_MAX_STREAM_CHARS};

  // Python strings can carry lone UTF-16 surrogates (e.g. errors='surrogateescape'
  // when decoding bytes). Those corrupt the native postMessage bridge, so replace
  // any unpaired surrogate with U+FFFD before sending.
  function sanitizeSurrogates(s) {
    return s.replace(/[\\uD800-\\uDFFF]/g, function (ch, i) {
      var code = ch.charCodeAt(0);
      if (code <= 0xDBFF) {
        var next = s.charCodeAt(i + 1);
        return (next >= 0xDC00 && next <= 0xDFFF) ? ch : '\\uFFFD';
      }
      var prev = s.charCodeAt(i - 1);
      return (prev >= 0xD800 && prev <= 0xDBFF) ? ch : '\\uFFFD';
    });
  }

  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(sanitizeSurrogates(JSON.stringify(msg)));
    }
  }

  // Bounded accumulator: appends until the ceiling, then stops and flags overflow.
  function makeSink() {
    return { text: '', truncated: false };
  }
  function append(sink, s) {
    if (sink.truncated) return;
    if (sink.text.length >= MAX_STREAM_CHARS) { sink.truncated = true; return; }
    var remaining = MAX_STREAM_CHARS - sink.text.length;
    if (s.length > remaining) {
      sink.text += s.slice(0, remaining);
      sink.truncated = true;
    } else {
      sink.text += s + '\\n';
    }
  }
  function finalize(sink) {
    return sink.truncated ? sink.text + '\\n[output truncated]' : sink.text;
  }

  var bootPromise = (async function () {
    var pyodide = await loadPyodide({ indexURL: './' });
    window.__pyodide = pyodide;
    return pyodide;
  })();

  window.__runPython = async function (req) {
    var out = makeSink();
    var err = makeSink();
    try {
      var pyodide = await bootPromise;
      pyodide.setStdout({ batched: function (s) { append(out, s); } });
      pyodide.setStderr({ batched: function (s) { append(err, s); } });
      await pyodide.loadPackagesFromImports(req.code);
      var value = await pyodide.runPythonAsync(req.code);
      var repr;
      if (value !== undefined) {
        try {
          repr = String(value);
          if (repr.length > MAX_STREAM_CHARS) { repr = repr.slice(0, MAX_STREAM_CHARS) + '\\n[result truncated]'; }
        } finally {
          if (value && typeof value.destroy === 'function') { value.destroy(); }
        }
      }
      post({ type: 'result', id: req.id, ok: true, stdout: finalize(out), stderr: finalize(err), result: repr });
    } catch (e) {
      post({ type: 'result', id: req.id, ok: false, stdout: finalize(out), stderr: finalize(err), error: String((e && e.message) || e) });
    }
  };

  bootPromise
    .then(function (pyodide) { post({ type: 'ready', version: pyodide.version }); })
    .catch(function (e) { post({ type: 'boot_error', error: String((e && e.message) || e) }); });
})();
</script>
</body>
</html>
`;
}

/** JS statement string that hands a request to the page. */
export function buildRunInjection(request: PythonPageRequest): string {
  // JSON.stringify leaves U+2028/U+2029 unescaped; on pre-ES2019 WebView engines
  // they act as line terminators inside string literals and would break parsing
  // of the injected statement. Escape them defensively.
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const payload = JSON.stringify(request)
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
  return `window.__runPython(${payload}); true;`;
}

export function parsePythonPageMessage(raw: string): PythonPageMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && (msg.type === 'ready' || msg.type === 'result' || msg.type === 'boot_error')) {
      return msg as PythonPageMessage;
    }
  } catch {
    // Not a runtime message — ignore.
  }
  return null;
}
