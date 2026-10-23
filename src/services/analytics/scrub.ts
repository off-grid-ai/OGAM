/**
 * Crash report scrubbing (docs/ANALYTICS.md, "Crashes"). Runs on every `$exception` before the
 * SDK sends it: a path becomes its file name, quoted text and URLs are dropped, and anything after
 * a colon in a message is dropped because it may echo what the person typed. Type, file name,
 * line and function are kept.
 */

type Frame = Record<string, unknown>;
type ExceptionEntry = Record<string, unknown> & {
  stacktrace?: { frames?: Frame[]; type?: string };
};

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const IPV4_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const QUOTED_PATTERN = /(["'`])(?:(?!\1).)*\1/g;
const PATH_PATTERN = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s:"'`]+)+[\\/]([^\\/\s:"'`]+)/g;

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
    .replace(PATH_PATTERN, '$1');
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
