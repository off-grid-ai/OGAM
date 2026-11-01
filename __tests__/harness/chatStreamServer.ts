/**
 * chatStreamServer — a chat server on the network, at the streaming XMLHttpRequest boundary (the transport
 * httpClient's createStreamingRequest and createNDJSONStreamingRequest use on device).
 *
 * Each sent request is answered with the next scripted reply, in the server's own wire shape:
 *  - `sse`: OpenAI-compatible Server-Sent Events (`data: {...}\n\n`, a string payload such as '[DONE]' as is);
 *  - `ndjson`: Ollama's native /api/chat (one JSON object per line);
 *  - `status` + `body`: an HTTP error;
 *  - `networkError`: the connection fails (XHR onerror).
 * `hold: true` keeps the stream open after its first chunk until release(). An aborted request stops
 * streaming, as a real XHR abort does.
 *
 * It records the URL, headers and JSON body of every request actually sent, and decides nothing: the real
 * httpClient, SSE / NDJSON parsers and provider code run on top.
 */

export type ChatStreamReply =
  | { sse: unknown[]; hold?: boolean }
  | { ndjson: unknown[]; hold?: boolean }
  | { status: number; body: string }
  | { networkError: true };

export interface SentChatRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

export interface ChatStreamServer {
  readonly requests: SentChatRequest[];
  /** Requests the app aborted. */
  readonly aborted: number;
  /** Queue the replies to the next requests, in order. */
  reply(...replies: ChatStreamReply[]): void;
  /** Let a held stream go on. */
  release(): void;
  restore(): void;
}

function chunksOf(r: { sse?: unknown[]; ndjson?: unknown[] }): string[] {
  if (r.ndjson) return r.ndjson.map(line => `${JSON.stringify(line)}\n`);
  return (r.sse ?? []).map(p => `data: ${typeof p === 'string' ? p : JSON.stringify(p)}\n\n`);
}

export function installChatStreamServer(): ChatStreamServer {
  const g = global as unknown as { XMLHttpRequest: unknown };
  const original = g.XMLHttpRequest;
  const queue: ChatStreamReply[] = [];
  const requests: SentChatRequest[] = [];
  let aborted = 0;
  let releaseFn: (() => void) | null = null;

  class ChatServerXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    responseURL = '';
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    private url = '';
    private headers: Record<string, string> = {};
    private isAborted = false;
    open(_method: string, url: string): void {
      this.url = url;
      this.responseURL = url;
      this.readyState = 1;
    }
    setRequestHeader(key: string, value: string): void { this.headers[key] = value; }
    getResponseHeader(): null { return null; }
    abort(): void {
      if (!this.isAborted) aborted += 1;
      this.isAborted = true;
    }
    send(body: string): void {
      requests.push({ url: this.url, headers: { ...this.headers }, body: JSON.parse(body) });
      const r = queue.shift() ?? { sse: [] };
      const finish = (status: number) => {
        if (this.isAborted) return;
        this.readyState = 4;
        this.status = status;
        this.onreadystatechange?.();
      };
      if ('networkError' in r) {
        setTimeout(() => { if (!this.isAborted) this.onerror?.(); }, 0);
        return;
      }
      if ('status' in r) {
        setTimeout(() => { this.responseText = r.body; finish(r.status); }, 0);
        return;
      }
      const chunks = chunksOf(r);
      let i = 0;
      const pump = () => {
        if (this.isAborted) return;
        if (i < chunks.length) {
          this.status = 200;
          this.readyState = 3;
          this.responseText += chunks[i++];
          this.onprogress?.();
          if (i === 1 && r.hold) {
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
  g.XMLHttpRequest = ChatServerXHR;

  return {
    requests,
    get aborted() { return aborted; },
    reply: (...replies) => { queue.push(...replies); },
    release: () => {
      const f = releaseFn;
      releaseFn = null;
      f?.();
    },
    restore: () => { g.XMLHttpRequest = original; },
  };
}
