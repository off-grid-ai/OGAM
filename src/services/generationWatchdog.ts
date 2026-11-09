/**
 * Stops a reply that has made no progress for a long time. A file write waiting on a prompt nobody could see, a
 * native call that never returned or a model that stopped producing tokens all left the chat on "working" for as
 * long as the app stayed open (a reported half hour). Progress is anything that changes what the chat shows: more
 * answer text, more thinking text, or a new message (a tool result).
 */
const STALL_LIMIT_MS = 5 * 60 * 1000;
const CHECK_EVERY_MS = 15 * 1000;

export interface StallWatchdogOptions {
  /** A string that changes whenever the reply makes progress. */
  signature: () => string;
  onStall: () => void;
  limitMs?: number;
  checkEveryMs?: number;
  now?: () => number;
}

export function startStallWatchdog(opts: StallWatchdogOptions): () => void {
  const now = opts.now ?? Date.now;
  const limit = opts.limitMs ?? STALL_LIMIT_MS;
  let last = opts.signature();
  let changedAt = now();
  let fired = false;
  const timer = setInterval(() => {
    const sig = opts.signature();
    if (sig !== last) { last = sig; changedAt = now(); return; }
    if (!fired && now() - changedAt >= limit) {
      fired = true;
      clearInterval(timer);
      opts.onStall();
    }
  }, opts.checkEveryMs ?? CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
