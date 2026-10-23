/**
 * Runs `handler` when `signal` aborts — immediately when it has ALREADY aborted.
 *
 * An `abort` listener never fires for a signal that aborted before it was attached, so a Stop
 * pressed while a request is still being prepared would otherwise be lost and the request sent.
 * Returns an unsubscribe for callers that outlive the operation.
 */
export function onAbort(signal: AbortSignal | null | undefined, handler: () => void): () => void {
  if (!signal) return () => {};
  if (signal.aborted) {
    handler();
    return () => {};
  }
  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}
