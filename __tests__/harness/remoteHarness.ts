/**
 * remoteHarness — makes a REMOTE (OpenAI-compatible / Ollama) model ACTIVE and replays a CAPTURED device
 * SSE response at the real network boundary (XMLHttpRequest, which createStreamingRequest uses), so the
 * REAL transport adapter + Shared GenerationService + processDelta + chat render run on top. Fake ONLY
 * the external transport; everything we own runs.
 *
 * Ground the SSE in a real captured response (docs/wire-captures/*lmstudio* / *ollama*), never a guess.
 */
import { mcpBoundaryResponse, TEST_MCP_URL } from './mcpBoundary';

/** Behavior-faithful fake of the streaming XMLHttpRequest transport. Replays `sseBody` incrementally via
 *  onprogress (as chunked SSE arrives on device), then completes 200 — exactly what createStreamingRequest
 *  consumes (reads xhr.responseText in onprogress, finalises on readyState 4). Install before a remote send. */
export function installRemoteStream(
  sseBody: string | string[] | ((requestBody: string) => string),
): { release: () => void } {
  // Accept a QUEUE of per-request bodies so a multi-turn remote flow (a tool loop: request 1 returns
  // tool_calls, request 2 — sent WITH the tool results — returns the final reply) replays the right body per
  // XHR. A single string keeps the old behavior; with an array each send() shifts the next body, the last
  // repeats for any extra requests.
  //
  // A body line that is exactly `__PAUSE__` HALTS the pump there (the deltas before it are delivered, the
  // stream is NOT completed) until the returned release() is called — so a test can observe the mid-stream
  // rendered state (e.g. the thinking-box header WHILE reasoning is still streaming). No pause line = no-op.
  const bodyFactory = typeof sseBody === 'function' ? sseBody : null;
  const bodies: string[] = bodyFactory
    ? []
    : Array.isArray(sseBody)
    ? [...sseBody]
    : [sseBody as string];
  let releaseFn: (() => void) | null = null;
  class FakeXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    onload: null | (() => void) = null;
    onabort: null | (() => void) = null;
    timeout = 0;
    private method = '';
    private url = '';
    open(method: string, url: string): void {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(): void {
      /* headers irrelevant to the fake */
    }
    getResponseHeader(name: string): string | null {
      if (this.url === TEST_MCP_URL) {
        return name.toLowerCase() === 'content-type'
          ? 'application/json'
          : null;
      }
      return null;
    }
    abort(): void {
      this.onabort?.();
    }
    send(requestBody?: string): void {
      const mcpResponse = mcpBoundaryResponse(
        this.method,
        this.url,
        requestBody ?? '',
      );
      if (mcpResponse) {
        this.status = mcpResponse.status;
        this.responseText = mcpResponse.body;
        this.readyState = 4;
        queueMicrotask(() => this.onload?.());
        return;
      }
      // Emit the captured body line-by-line, one per macrotask, so the REAL incremental parser runs like it
      // does on device — works for both OpenAI SSE (`data: {…}\n\n`) and Ollama NDJSON (`{…}\n`).
      const body = bodyFactory
        ? bodyFactory(requestBody ?? '')
        : bodies.length > 1
        ? bodies.shift()!
        : bodies[0];
      this.responseText = '';
      const chunks = body.match(/[^\n]*\n/g) ?? [body];
      let i = 0;
      const pump = (): void => {
        if (i < chunks.length) {
          const chunk = chunks[i++];
          if (chunk.trim() === '__PAUSE__') {
            releaseFn = () => setTimeout(pump, 0);
            return;
          } // hold here
          this.responseText += chunk;
          this.onprogress?.();
          setTimeout(pump, 0);
        } else {
          this.readyState = 4;
          this.status = 200;
          this.onreadystatechange?.();
        }
      };
      setTimeout(pump, 0);
    }
  }
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXHR;
  return { release: () => releaseFn?.() };
}

export type RemoteHarnessProvider =
  | 'lmstudio'
  | 'ollama'
  | 'offgrid-desktop';

export function remoteProviderFixture(provider: RemoteHarnessProvider): {
  name: string;
  endpoint: string;
  provider: RemoteHarnessProvider;
  modelManagement?: 'offgrid-desktop-v1';
} {
  if (provider === 'ollama') {
    return {
      name: 'Ollama',
      endpoint: 'http://localhost:11434',
      provider,
    };
  }
  if (provider === 'offgrid-desktop') {
    return {
      name: 'Off Grid AI Desktop',
      endpoint: 'http://localhost:7878',
      provider,
      modelManagement: 'offgrid-desktop-v1',
    };
  }
  return {
    name: 'LM Studio',
    endpoint: 'http://localhost:1234',
    provider,
  };
}

/** Provider-shaped text stream replayed at the XHR boundary. */
export function remoteTextStreamBody(
  provider: RemoteHarnessProvider,
  input: {
    contentChunks: readonly string[];
    reasoning?: string;
    error?: string;
    toolCalls?: ReadonlyArray<{
      name: string;
      arguments: Record<string, unknown>;
    }>;
    pauseBefore?: boolean;
    pauseAfterChunk?: number;
  },
): string {
  const lines: string[] = [];
  if (input.pauseBefore) lines.push('__PAUSE__');
  if (provider === 'ollama') {
    if (input.error) return `${JSON.stringify({ error: input.error })}\n`;
    if (input.reasoning) {
      lines.push(
        JSON.stringify({
          message: { role: 'assistant', thinking: input.reasoning },
          done: false,
        }),
      );
    }
    input.contentChunks.forEach((content, index) => {
      lines.push(
        JSON.stringify({
          message: { role: 'assistant', content },
          done: false,
        }),
      );
      if (input.pauseAfterChunk === index) lines.push('__PAUSE__');
    });
    if (input.toolCalls?.length) {
      lines.push(
        JSON.stringify({
          message: {
            role: 'assistant',
            tool_calls: input.toolCalls.map(call => ({
              function: { name: call.name, arguments: call.arguments },
            })),
          },
          done: false,
        }),
      );
    }
    lines.push(
      JSON.stringify({
        message: { role: 'assistant', content: '' },
        done: true,
      }),
    );
    return `${lines.join('\n')}\n`;
  }

  if (input.error) {
    lines.push(`data: ${JSON.stringify({ error: { message: input.error } })}`);
    return `${lines.join('\n\n')}\n\n`;
  }
  if (input.reasoning) {
    lines.push(
      `data: ${JSON.stringify({
        choices: [{ delta: { reasoning_content: input.reasoning } }],
      })}`,
    );
  }
  input.contentChunks.forEach((content, index) => {
    lines.push(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    );
    if (input.pauseAfterChunk === index) lines.push('__PAUSE__');
  });
  if (input.toolCalls?.length) {
    lines.push(
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: input.toolCalls.map((call, index) => ({
                index,
                id: `call-${index}`,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.arguments),
                },
              })),
            },
          },
        ],
      })}`,
    );
  }
  lines.push(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {},
          finish_reason: input.toolCalls?.length ? 'tool_calls' : 'stop',
        },
      ],
    })}`,
    'data: [DONE]',
  );
  return `${lines.join('\n\n')}\n\n`;
}

/** Make a remote OpenAI-compatible model the ACTIVE model — the real connect flow's end state (server
 *  added, its models discovered, the transport registered, and its canonical route selected). Discovery is the
 *  network boundary; we pre-place its result, then mount + gesture as the user. `caps` mirrors what a
 *  server actually advertises (LM Studio/Ollama do NOT advertise supportsThinking → no thinking toggle). */
export async function installRemoteModel(
  opts: {
    name?: string;
    endpoint?: string;
    provider?: RemoteHarnessProvider | 'openai-compatible' | 'anthropic';
    caps?: Partial<{
      supportsVision: boolean;
      supportsToolCalling: boolean;
      supportsThinking: boolean;
    }>;
  } = {},
): Promise<{ serverId: string; modelId: string }> {
  const {
    remoteServerManager,
  } = require('../../src/services/modelServices/remoteServerController');
  const { llmService } = require('../../src/services/llm');
  const {
    clearMobileModel,
    selectMobileModel,
  } = require('../../src/services/modelServices');

  // A remote model is only USED when no local model is loaded/selected: generationService prefers a loaded
  // local model, and the dispatch keys off appStore.activeModelId. On device, selecting a remote model
  // clears the local selection and no local model is loaded — mirror that so the send routes remote.
  await llmService.unloadModel();
  await clearMobileModel('text');
  const requestedProvider = opts.provider ?? 'lmstudio';
  const fixture =
    requestedProvider === 'openai-compatible' || requestedProvider === 'anthropic'
      ? null
      : remoteProviderFixture(requestedProvider);
  const name = opts.name ?? fixture?.name ?? 'Remote Server';
  const endpoint = opts.endpoint ?? fixture?.endpoint ?? 'http://localhost:1234';
  const provider = requestedProvider;
  const modelId = 'remote-model';

  const server = await remoteServerManager.addServer({
    name,
    endpoint,
    provider,
    selections: { text: modelId },
    catalog: {
      text: [
        {
          id: modelId,
          name: 'Remote Model',
          capabilities: {
            supportsVision: false,
            supportsToolCalling: false,
            supportsThinking: false,
            acceptsThinkingKwarg: !!opts.caps?.supportsThinking,
            maxContextLength: 4096,
            ...opts.caps,
          },
        },
      ],
    },
    ...(fixture?.modelManagement
      ? { modelManagement: fixture.modelManagement }
      : {}),
  });
  const serverId = server.id;

  // The application service registers the transport as part of the atomic save transaction.
  // Select through the shared route owner after projecting the discovered catalog.
  await selectMobileModel({
    source: 'remote',
    hostId: serverId,
    modality: 'text',
    modelId,
  });
  return { serverId, modelId };
}

/** Select a remote image model through the same remote catalog and route used by the app. */
export async function installRemoteImageModel(
  opts: {
    name?: string;
    endpoint?: string;
    modelId?: string;
    provider?: 'offgrid-desktop';
  } = {},
): Promise<{ serverId: string; modelId: string }> {
  const { useRemoteServerStore } = require('../../src/stores');
  const {
    remoteServerManager,
  } = require('../../src/services/modelServices/remoteServerController');
  const { selectMobileModel } = require('../../src/services/modelServices');

  const fixture = remoteProviderFixture(opts.provider ?? 'offgrid-desktop');
  const current = useRemoteServerStore.getState().servers.find(
    (candidate: { provider?: string }) => candidate.provider === fixture.provider,
  );
  const server =
    current ??
    (await remoteServerManager.addServer({
      name: opts.name ?? fixture.name,
      endpoint: opts.endpoint ?? fixture.endpoint,
      provider: fixture.provider,
      modelManagement: fixture.modelManagement,
    }));
  const modelId = opts.modelId ?? 'remote-image-model';
  await remoteServerManager.updateServer(server.id, {
    catalog: {
      ...server.catalog,
      image: [{ id: modelId, name: 'Remote Image Model' }],
    },
  });
  const { applicationFacade } =
    require('../../src/services/applicationFacade') as typeof import('../../src/services/applicationFacade');
  const refreshed = await applicationFacade().models.refresh();
  if (!refreshed.ok) {
    throw new Error(
      `Remote image catalog refresh failed: ${refreshed.failure.kind}`,
    );
  }
  await selectMobileModel({
    source: 'remote',
    hostId: server.id,
    modality: 'image',
    modelId,
  });
  return { serverId: server.id, modelId };
}

type RemoteSpeechCategory = 'transcription' | 'voice';

/** Select an Off Grid Desktop speech route through the same remote-model application command. */
export async function installRemoteSpeechModel(
  category: RemoteSpeechCategory,
): Promise<{ serverId: string; modelId: string }> {
  // Selection activates the route on Off Grid Desktop. Install the external server before the
  // real application selection command reaches that network boundary.
  installRemoteSpeechResponses('');
  const { useRemoteServerStore } = require('../../src/stores');
  const {
    remoteServerManager,
  } = require('../../src/services/modelServices/remoteServerController');
  const { selectMobileModel } = require('../../src/services/modelServices');
  const fixture = remoteProviderFixture('offgrid-desktop');
  const current = useRemoteServerStore.getState().servers.find(
    (candidate: { provider?: string }) => candidate.provider === fixture.provider,
  );
  const server =
    current ??
    (await remoteServerManager.addServer({
      name: fixture.name,
      endpoint: fixture.endpoint,
      provider: fixture.provider,
      modelManagement: fixture.modelManagement,
    }));
  const latest =
    useRemoteServerStore.getState().servers.find(
      (candidate: { id: string }) => candidate.id === server.id,
    ) ?? server;
  const modelId =
    category === 'transcription' ? 'remote-whisper-model' : 'remote-voice-model';
  await remoteServerManager.updateServer(server.id, {
    catalog: {
      ...latest.catalog,
      [category]: [
        {
          id: modelId,
          name:
            category === 'transcription'
              ? 'Remote Whisper Model'
              : 'Remote Voice Model',
        },
      ],
    },
  });
  await selectMobileModel({
    source: 'remote',
    hostId: server.id,
    modality: category,
    modelId,
  });
  return { serverId: server.id, modelId };
}

/** Off Grid Desktop STT and TTS responses at the HTTP boundary. */
export function installRemoteSpeechResponses(transcript: string): void {
  const { useRemoteServerStore } = require('../../src/stores');
  const existingServer = useRemoteServerStore
    .getState()
    .servers.find(
      (candidate: { provider?: string }) =>
        candidate.provider === 'offgrid-desktop',
    );
  const textModels = existingServer?.catalog?.text ?? [];
  const selectedTextModel = existingServer?.selections?.text;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/models/activate')) {
      return response({ success: true });
    }
    if (url.endsWith('/models/catalog')) {
      return response({
        // Off Grid Desktop exposes one multimodal catalog. A speech-model activation refreshes
        // that whole catalog; returning speech rows only would falsely remove the selected text
        // route and make the real Chat screen fall back to "No Model Selected".
        kinds: [
          ...(textModels.length > 0 ? ['text'] : []),
          'transcription',
          'voice',
        ],
        models: [
          ...textModels.map((model: { id: string; name: string; capabilities?: unknown }) => ({
            id: model.id,
            name: model.name,
            kind: 'text',
            files: [],
            ...(model.capabilities ? { capabilities: model.capabilities } : {}),
          })),
          {
            id: 'remote-whisper-model',
            name: 'Remote Whisper Model',
            kind: 'transcription',
            files: [],
          },
          {
            id: 'remote-voice-model',
            name: 'Remote Voice Model',
            kind: 'voice',
            files: [],
          },
        ],
      });
    }
    if (url.endsWith('/models/installed')) {
      return response({
        installed: [
          ...textModels.map((model: { id: string }) => model.id),
          'remote-whisper-model',
          'remote-voice-model',
        ],
      });
    }
    if (url.endsWith('/models/active')) {
      return response({
        ...(selectedTextModel ? { text: selectedTextModel } : {}),
        transcription: 'remote-whisper-model',
        voice: 'remote-voice-model',
      });
    }
    if (url.endsWith('/v1/audio/transcriptions')) {
      return response({ text: transcript });
    }
    if (url.endsWith('/v1/audio/speech')) {
      const bytes = Uint8Array.from([82, 73, 70, 70]).buffer;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'audio/wav' },
        arrayBuffer: async () => bytes,
        text: async () => '',
      } as unknown as Response;
    }
    return response({});
  }) as typeof fetch;
}

/** Replay the Off Grid Desktop image control plane and generation response at the HTTP boundary. */
export function installRemoteImageResponse(): void {
  let activeImage = 'remote-image-model';
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/models/activate')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        id?: string;
        kind?: string;
      };
      if (body.kind === 'image' && body.id) activeImage = body.id;
      return response({ success: true });
    }
    if (url.endsWith('/models/catalog')) {
      return response({
        kinds: ['text', 'image'],
        models: [
          {
            id: 'remote-model',
            name: 'Remote Model',
            kind: 'text',
            files: [],
            capabilities: { vision: true, tools: true, thinking: true },
          },
          {
            id: 'remote-image-model',
            name: 'Remote Image Model',
            kind: 'image',
            files: [],
          },
        ],
      });
    }
    if (url.endsWith('/models/installed')) {
      return response({ installed: ['remote-model', 'remote-image-model'] });
    }
    if (url.endsWith('/models/active')) {
      return response({ text: 'remote-model', image: activeImage });
    }
    return response({ data: [{ b64_json: 'aW1hZ2U=' }] });
  }) as typeof fetch;
}

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
