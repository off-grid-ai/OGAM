/** Thrown when something took longer than allowed. */
export class TimeoutError extends Error {
  constructor(public readonly what: string, public readonly ms: number) {
    super(`${what} took longer than ${Math.round(ms / 1000)} seconds and was stopped.`);
    this.name = 'TimeoutError';
  }
}

/**
 * Settles with `promise`, or rejects with a TimeoutError after `ms`. The work itself cannot be cancelled from here
 * (a tool that never answers keeps running in the background); this only stops the caller waiting for it forever.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
