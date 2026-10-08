import {
  createServer,
  request as httpRequest,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { remoteMediaRuntime } from '../../../src/services/remoteMediaRuntime';
import type { RemoteServer } from '../../../src/types';

// The device Keychain is unavailable in Node. Keep its public credential contract,
// without spies, call counters, or substitutions for Mobile service code.
jest.mock('react-native-keychain', () => {
  const credentials = new Map<string, { username: string; password: string }>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED: 'WhenUnlocked' },
    async setGenericPassword(
      username: string,
      password: string,
      options: { service: string },
    ) {
      credentials.set(options.service, { username, password });
      return { service: options.service };
    },
    async getGenericPassword(options: { service: string }) {
      return credentials.get(options.service) ?? false;
    },
    async resetGenericPassword(options: { service: string }) {
      return credentials.delete(options.service);
    },
  };
});

// Jest disables fetch. This adapter uses real Node HTTP sockets and honours AbortSignal.
// The server below is the external Desktop boundary; all Mobile owners are real.
const socketFetch: typeof fetch = async (input, init = {}) =>
  new Promise((resolve, reject) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    const transport = httpRequest(
      url,
      {
        method: init.method,
        agent: false,
        headers: init.headers as Record<string, string>,
      },
      response => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          cleanup();
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
            }),
          );
        });
        response.on('error', reject);
      },
    );
    const abort = () => transport.destroy(new Error('HTTP request aborted'));
    const cleanup = () => init.signal?.removeEventListener('abort', abort);
    transport.on('error', error => {
      cleanup();
      reject(error);
    });
    init.signal?.addEventListener('abort', abort, { once: true });
    if (init.signal?.aborted) abort();
    transport.end(init.body as string | undefined);
  });

function event<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function json(response: ServerResponse, payload: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(payload));
}

describe('Desktop image cancellation through HTTP', () => {
  const savedFetch = global.fetch;
  let holdSubmission: boolean;
  let holdPoll: boolean;
  let olderDesktop: boolean;
  let reportProgress: boolean;
  let submitted: ReturnType<typeof event<ServerResponse>>;
  let polled: ReturnType<typeof event<ServerResponse>>;
  let deleted: ReturnType<typeof event<void>>;
  let requests: string[];
  let jobStatus: string;
  let server: RemoteServer;
  const desktop = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === 'POST') {
      request.resume();
      jobStatus = 'running';
      submitted.resolve(response);
      if (!holdSubmission) json(response, { request_id: 'image-job' }, 202);
    } else if (request.method === 'DELETE') {
      if (olderDesktop)
        json(response, { error: { message: 'Unknown endpoint' } }, 404);
      else {
        jobStatus = 'failed';
        json(response, {
          request_id: 'image-job',
          status: 'failed',
          cancelled: true,
        });
      }
      deleted.resolve();
    } else {
      polled.resolve(response);
      if (!holdPoll)
        json(response, {
          ...(reportProgress ? { progress: { step: 1, total: 1 } } : {}),
          status: 'completed',
          result: { data: [{ b64_json: 'aW1hZ2U=' }] },
        });
    }
  });

  beforeAll(async () => {
    await new Promise<void>(resolve => desktop.listen(0, '127.0.0.1', resolve));
    server = {
      id: 'cancellation-desktop',
      name: 'Synthetic Desktop',
      endpoint: `http://127.0.0.1:${
        (desktop.address() as AddressInfo).port
      }/v1`,
      providerType: 'openai-compatible',
      modelManagement: 'offgrid-desktop-v1',
      createdAt: '2026-10-08T00:00:00.000Z',
      mediaModels: { image: 'synthetic-image' },
    };
  });

  beforeEach(() => {
    global.fetch = socketFetch;
    holdSubmission = false;
    holdPoll = false;
    olderDesktop = false;
    reportProgress = false;
    submitted = event<ServerResponse>();
    polled = event<ServerResponse>();
    deleted = event<void>();
    requests = [];
    jobStatus = 'idle';
  });

  afterEach(() => {
    global.fetch = savedFetch;
    desktop.closeAllConnections();
  });
  afterAll(async () => {
    await new Promise<void>(resolve => desktop.close(() => resolve()));
  });

  it('does not submit when Stop occurs before generation', async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(
      remoteMediaRuntime.generateImage(
        server,
        { prompt: 'image' },
        {
          signal: stop.signal,
        },
      ),
    ).rejects.toThrow('Remote request cancelled');
    expect(requests).toEqual([]);
  });

  it('receives a delayed request ID after Stop and cancels that job once', async () => {
    holdSubmission = true;
    const stop = new AbortController();
    const outcome = remoteMediaRuntime.generateImage(
      server,
      { prompt: 'image' },
      {
        signal: stop.signal,
      },
    );
    const settled = outcome.catch(error => error as Error);
    const response = await submitted.promise;
    stop.abort();
    stop.abort();
    json(response, { request_id: 'image-job' }, 202);
    expect(await settled).toEqual(new Error('Remote request cancelled'));
    expect(jobStatus).toBe('failed');
    expect(requests).toEqual([
      'POST /v1/images/generations',
      'DELETE /v1/requests/image-job',
    ]);
  });

  it('cancels during a pending poll and allows the next image to complete', async () => {
    holdPoll = true;
    const stop = new AbortController();
    const outcome = remoteMediaRuntime.generateImage(
      server,
      { prompt: 'image' },
      {
        signal: stop.signal,
      },
    );
    const settled = outcome.catch(error => error as Error);
    await polled.promise;
    stop.abort();
    await deleted.promise;
    expect(await settled).toEqual(new Error('Remote request cancelled'));
    expect(jobStatus).toBe('failed');
    expect(requests).toEqual([
      'POST /v1/images/generations',
      'GET /v1/requests/image-job',
      'DELETE /v1/requests/image-job',
    ]);
    holdPoll = false;
    await expect(
      remoteMediaRuntime.generateImage(server, { prompt: 'next image' }),
    ).resolves.toEqual({ base64: 'aW1hZ2U=', url: undefined });
  });

  it('settles local Stop when an older Desktop rejects DELETE', async () => {
    olderDesktop = true;
    holdPoll = true;
    const stop = new AbortController();
    const outcome = remoteMediaRuntime.generateImage(
      server,
      { prompt: 'image' },
      {
        signal: stop.signal,
      },
    );
    const settled = outcome.catch(error => error as Error);
    await polled.promise;
    stop.abort();
    expect(await settled).toEqual(new Error('Remote request cancelled'));
    expect(jobStatus).toBe('running');
    expect(requests.at(-1)).toBe('DELETE /v1/requests/image-job');
  });

  it('honours Stop from the progress callback before accepting a completed result', async () => {
    reportProgress = true;
    const stop = new AbortController();
    await expect(
      remoteMediaRuntime.generateImage(
        server,
        { prompt: 'image' },
        {
          signal: stop.signal,
          onImageProgress: () => stop.abort(),
        },
      ),
    ).rejects.toThrow('Remote request cancelled');
    expect(requests.at(-1)).toBe('DELETE /v1/requests/image-job');
  });

  it('returns a completed image without sending cancellation', async () => {
    await expect(
      remoteMediaRuntime.generateImage(server, { prompt: 'image' }),
    ).resolves.toEqual({ base64: 'aW1hZ2U=', url: undefined });
    expect(requests).toEqual([
      'POST /v1/images/generations',
      'GET /v1/requests/image-job',
    ]);
  });
});
