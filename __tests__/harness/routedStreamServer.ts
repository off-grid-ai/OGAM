/**
 * routedStreamServer — a behavior-faithful fake of an OpenAI-compatible chat server at the streaming
 * XMLHttpRequest boundary (the transport createStreamingRequest uses on device).
 *
 * `wire: 'ndjson'` answers the way Ollama's native /api/chat does (one JSON object per line, ending
 * with `done: true`) instead of OpenAI SSE.
 *
 * Unlike remoteHarness.installRemoteStream, this fake looks at WHERE the request went:
 *  - Only `POST <origin><chatPath>` streams the reply. Any other origin or path answers 404 the way a
 *    real server answers an unknown route (so a doubled `/v1/v1/chat/completions` fails on screen).
 *  - A request is recorded only when it is actually SENT (`send()`), not when it is opened, so a test
 *    can tell "the app never sent it" from "the app sent it and then aborted".
 *  - `hold: true` keeps the reply open after the first delta until `release()` — so the in-flight
 *    state (the Stop button) can be observed on screen.
 *  - `abort()` ends the request like a real XHR abort: no more progress, no completion.
 *
 * Nothing here decides what the app should do: the real provider, SSE parser, generation service,
 * stores and chat screen run on top, and what renders is emergent.
 */

export interface RoutedStreamOptions {
  origin: string;
  /** The one path that answers, e.g. '/v1/chat/completions'. */
  chatPath: string;
  /** The reply, split into the content deltas the server streams. */
  deltas: string[];
  /** Hold the stream open after the first delta until release(). */
  hold?: boolean;
  /** The stream's wire shape: OpenAI SSE (default) or Ollama's native NDJSON. */
  wire?: 'sse' | 'ndjson';
}

export interface RoutedStreamHandle {
  /** Every request that was actually sent: method and full URL. */
  readonly sent: ReadonlyArray<{ method: string; url: string }>;
  /** Requests that were opened but aborted before send(). */
  readonly abortedBeforeSend: number;
  release(): void;
  restore(): void;
}

const sseLine = (payload: unknown): string => `data: ${JSON.stringify(payload)}\n\n`;
const ndjsonLine = (payload: unknown): string => `${JSON.stringify(payload)}\n`;

export function installRoutedStreamServer(opts: RoutedStreamOptions): RoutedStreamHandle {
  const g = global as unknown as { XMLHttpRequest: unknown };
  const original = g.XMLHttpRequest;
  const sent: Array<{ method: string; url: string }> = [];
  let abortedBeforeSend = 0;
  let releaseFn: (() => void) | null = null;
  let released = false;

  class RoutedXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    private method = 'GET';
    private url = '';
    private aborted = false;
    private wasSent = false;

    open(method: string, url: string): void {
      this.method = method.toUpperCase();
      this.url = url;
      this.readyState = 1;
    }

    setRequestHeader(): void { /* headers are not part of this route check */ }

    abort(): void {
      if (!this.wasSent) abortedBeforeSend += 1;
      this.aborted = true;
    }

    send(): void {
      if (this.aborted) return;
      this.wasSent = true;
      sent.push({ method: this.method, url: this.url });
      let parsed: URL | null = null;
      try { parsed = new URL(this.url); } catch { parsed = null; }
      const routed = parsed !== null && parsed.origin === opts.origin &&
        parsed.pathname === opts.chatPath && this.method === 'POST';

      const finish = (status: number): void => {
        if (this.aborted) return;
        this.readyState = 4;
        this.status = status;
        this.onreadystatechange?.();
      };

      if (!routed) {
        setTimeout(() => {
          this.responseText = JSON.stringify({ error: 'Unexpected endpoint or method.' });
          finish(404);
        }, 0);
        return;
      }

      const chunks = opts.wire === 'ndjson' ? [
        ...opts.deltas.map(content => ndjsonLine({ message: { role: 'assistant', content }, done: false })),
        ndjsonLine({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }),
      ] : [
        ...opts.deltas.map((content, i) =>
          sseLine({ choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content } : { content } }] })),
        sseLine({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        'data: [DONE]\n\n',
      ];
      let i = 0;
      const pump = (): void => {
        if (this.aborted) return;
        if (i < chunks.length) {
          this.status = 200;
          this.readyState = 3;
          this.responseText += chunks[i++];
          this.onprogress?.();
          if (i === 1 && opts.hold && !released) {
            releaseFn = () => setTimeout(pump, 0);
            return;
          }
          setTimeout(pump, 0);
        } else {
          finish(200);
        }
      };
      setTimeout(pump, 0);
    }
  }

  g.XMLHttpRequest = RoutedXHR;
  return {
    sent,
    get abortedBeforeSend() { return abortedBeforeSend; },
    release: () => {
      released = true;
      const fn = releaseFn;
      releaseFn = null;
      fn?.();
    },
    restore: () => { g.XMLHttpRequest = original; },
  };
}
