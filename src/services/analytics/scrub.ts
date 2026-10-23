/**
 * Crash report scrubbing (docs/ANALYTICS.md, "Crashes"). Runs on every `$exception` before the
 * SDK sends it: a path becomes its file name, quoted text and URLs are dropped, and anything after
 * a colon in a message is dropped because it may echo what the person typed. Type, file name,
 * line and function are kept.
 *
 * File and document names are on the never-send list, so a path keeps its name only when it is the
 * app's own code (`index.android.bundle`); a person's file, bare or in a path, becomes `<file>`.
 */

type Frame = Record<string, unknown>;
type ExceptionEntry = Record<string, unknown> & {
  stacktrace?: { frames?: Frame[]; type?: string };
};

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const QUOTED_PATTERN = /(["'`])(?:(?!\1).)*\1/g;
const PATH_PATTERN = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s:"'`]+)+[\\/]([^\\/\s:"'`]+)/g;
// The app's own code: its file name helps find the bug and names nothing of the person's.
const CODE_FILE = /\.(?:[cm]?[jt]sx?|bundle|hbc|so|dylib|wasm|java|kt|swift|mm?|cpp|cc|c|h)$/i;
// A bare file name a person owns: a document, media, an archive or a model file.
const USER_FILE =
  /[^\s/\\:<>"'`]+\.(?:pdf|docx?|xlsx?|pptx?|txt|md|csv|tsv|json|rtf|pages|key|numbers|html?|png|jpe?g|gif|heic|webp|svg|mp3|m4a|wav|ogg|mp4|mov|mkv|zip|gguf|safetensors|onnx|bin|pte|tflite|litertlm|task)\b/gi;

function codeFileOnly(_path: string, name: string): string {
  return CODE_FILE.test(name) ? name : '<file>';
}

export function fileName(path: unknown): string | undefined {
  if (typeof path !== 'string' || !path) return undefined;
  const clean = path.replace(/[?#].*$/, '');
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || undefined;
}

export function scrubMessage(message: unknown): string | undefined {
  if (typeof message !== 'string') return undefined;
  const scrubbed = message
    .replace(URL_PATTERN, '')
    .replace(IPV4_PATTERN, '')
    .replace(QUOTED_PATTERN, '')
    .replace(PATH_PATTERN, codeFileOnly)
    .replace(USER_FILE, '<file>');
  const colon = scrubbed.indexOf(':');
  return (colon >= 0 ? scrubbed.slice(0, colon) : scrubbed).replace(/\s+/g, ' ').trim();
}

function scrubFrame(frame: Frame): Frame {
  return {
    platform: frame.platform,
    filename: fileName(frame.filename ?? frame.abs_path),
    function: frame.function,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
  };
}

function scrubException(entry: ExceptionEntry): ExceptionEntry {
  const frames = entry.stacktrace?.frames;
  return {
    type: entry.type,
    value: scrubMessage(entry.value),
    mechanism: entry.mechanism,
    ...(frames ? { stacktrace: { type: entry.stacktrace?.type ?? 'raw', frames: frames.map(scrubFrame) } } : {}),
  };
}

/** Keep only the scrubbed exception list and its level from the SDK's `$exception_*` properties. */
export function scrubExceptionProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!key.startsWith('$exception')) next[key] = value;
  }
  const list = properties.$exception_list;
  if (Array.isArray(list)) next.$exception_list = list.map(e => scrubException(e as ExceptionEntry));
  if (properties.$exception_level !== undefined) next.$exception_level = properties.$exception_level;
  return next;
}
