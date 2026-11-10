// Code-keyed messages match the reason codes emitted by the native worker
// (see DownloadUiState.kt). New code should always pass `code`; legacy call
// sites that only have a free-form `reason` string fall through to fuzzy
// matching below.
const ERROR_MESSAGES: Record<string, string> = {
  network_lost:         'Connection lost. Check your network and try again.',
  network_timeout:      'Connection timed out. Try again on a stable network.',
  server_unavailable:   'The download server is temporarily unavailable. Please try again later.',
  download_interrupted: 'The connection dropped while downloading. Please try again.',
  disk_full:            'Not enough storage. Free up space and retry.',
  file_corrupted:       'Downloaded file was corrupted. Please retry.',
  empty_response:       'Server returned an empty response. Try again later.',
  user_cancelled:       'Download was cancelled.',
  http_401:             'Access denied. Authentication required.',
  http_403:             'Access denied. You may not have permission to download this file.',
  http_404:             'File not found. It may have been moved or removed.',
  http_416:             'The server could not resume this download. Please retry it.',
  http_429:             'Server is rate-limiting. Please try again later.',
  client_error:         'A client error occurred. Please retry.',
  save_failed:          'The download finished but could not be saved. Please retry.',
  finalize_failed:      'The download finished but could not be saved. Tap Retry to save it.',
  unknown_error:        'The download stopped before it finished. Try again.',
};

const MAX_USER_MESSAGE_LEN = 160;

interface MessageHeuristic {
  patterns: RegExp[];
  message: string;
}

// Fuzzy heuristics for legacy callers that pass an Error.message string with
// no structured code. Order matters: more specific matches come first.
const HEURISTICS: MessageHeuristic[] = [
  {
    patterns: [/timeout/i, /timed out/i],
    message: 'The download took too long to respond. Please try again.',
  },
  {
    patterns: [
      /software caused connection abort/i,
      /connection reset/i,
      /failed to connect/i,
      /connection refused/i,
      /connection aborted/i,
      /connection lost/i,
      /unable to resolve host/i,
      /network is unreachable/i,
    ],
    message: 'The connection dropped while downloading. Please try again.',
  },
  {
    patterns: [/network connection lost\.?\s*waiting to resume/i, /network lost/i],
    message: 'Network connection lost - waiting to resume...',
  },
  {
    patterns: [/http\s*5\d\d/i, /server.*unavailable/i, /service unavailable/i, /bad gateway/i],
    message: 'The download server is temporarily unavailable. Please try again later.',
  },
  {
    patterns: [/http[_\s]*429/i, /rate.?limit/i, /too many requests/i],
    message: 'Server is rate-limiting. Retrying with backoff.',
  },
  {
    patterns: [/http[_\s]*416/i, /resume.*failed/i, /requested range not satisfiable/i],
    message: 'The server could not resume this download. Please retry it.',
  },
  {
    patterns: [/http[_\s]*404/i, /not found/i],
    message: 'File not found. It may have been moved or removed.',
  },
  {
    patterns: [/http[_\s]*40[13]/i, /unauthorized/i, /forbidden/i, /access denied/i],
    message: 'Access denied. You may not have permission to download this file.',
  },
  {
    patterns: [/download interrupted/i, /interrupted/i],
    message: 'The connection dropped while downloading. Please try again.',
  },
];

function fuzzyMatch(reason: string): string | undefined {
  for (const h of HEURISTICS) {
    if (h.patterns.some(p => p.test(reason))) return h.message;
  }
  return undefined;
}

export function toUserMessage(reason?: string, code?: string): string {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  // Try fuzzy matching on whichever string we have. Some callers pass the
  // free-form reason in the `code` slot (e.g. legacy "HTTP 416" labels).
  for (const candidate of [reason, code]) {
    if (!candidate) continue;
    if (candidate.length > MAX_USER_MESSAGE_LEN) continue;
    const matched = fuzzyMatch(candidate);
    if (matched) return matched;
  }
  if (reason) {
    if (reason.length > MAX_USER_MESSAGE_LEN) return ERROR_MESSAGES.unknown_error;
    return reason;
  }
  return ERROR_MESSAGES.unknown_error;
}

const RETRYABLE_CODES = new Set([
  'network_lost', 'network_timeout', 'server_unavailable', 'download_interrupted',
  'http_416', 'http_429', 'empty_response', 'unknown_error', 'save_failed', 'finalize_failed',
]);

export function isRetryable(reasonCode?: string): boolean {
  if (!reasonCode) return true;
  return RETRYABLE_CODES.has(reasonCode);
}

export function getUserFacingDownloadMessage(message?: string, code?: string): string {
  return toUserMessage(message, code);
}

export function getDownloadStatusLabel(status: string, reasonCode?: string, reason?: string): string {
  if (status === 'retrying') return 'Retrying connection...';
  if (status === 'waiting_for_network') return 'Waiting for network';
  if (status === 'pending') {
    // If a network-loss reason came along with a 'pending' status (worker is
    // queued waiting for connectivity), show that more specific copy.
    const candidate = reason ?? reasonCode;
    if (candidate && /network.*lost.*waiting to resume/i.test(candidate)) {
      return 'Network connection lost - waiting to resume...';
    }
    return 'Queued';
  }
  if (status === 'failed') return toUserMessage(reason, reasonCode);
  if (status === 'running' || status === 'downloading') return 'Downloading...';
  return toUserMessage(reason, reasonCode);
}


/**
 * A download failure that keeps its reason code. A native error event turned into a bare
 * `new Error(reason)` lost the code, so every failure counted as a generic "error" in the numbers
 * and read as free text in the row: build the Error here, and read it back with failureDetails.
 */
export class DownloadFailedError extends Error {
  readonly code?: string;
  readonly cancelled: boolean;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'DownloadFailedError';
    this.code = code || undefined;
    this.cancelled = code === 'user_cancelled';
  }
}

export function downloadEventError(event: { reason?: string; reasonCode?: string }): DownloadFailedError {
  return new DownloadFailedError(event.reason || 'Download failed', event.reasonCode);
}

/** The message and code a failed row records, from any thrown value. */
export function failureDetails(error: unknown, fallbackCode?: string): { message: string; code?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  return { message, code: typeof code === 'string' && code ? code : fallbackCode };
}
