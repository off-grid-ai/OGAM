/**
 * generationDevice — the phone under generationService, for tests that drive a reply end to end.
 *
 * Real: generationService and its helpers, llmService / liteRTService, activeModelService and the residency
 * manager's load lock, the tool loop and the built-in tools, the providers and the OpenAI-compatible stream
 * parser, the stores, logger, sharePrompt.
 *
 * Faked, because it is the device or the network:
 *  - llama.rn and the LiteRT native module (installNativeBoundary), react-native-fs (memfs), RAM;
 *  - the OpenAI-compatible server on the LAN, at the streaming XMLHttpRequest the provider uses
 *    (connectServer). It answers each chat request with the next scripted reply, in the server's own SSE
 *    shape, and records what was sent. It never decides what the app does.
 *
 * A downloaded model is pre-placed the way a finished download leaves it: its file on disk and its record
 * added through the app store's action. Selecting and loading it go through activeModelService, so the load
 * takes the residency lock exactly as the app's does.
 */
import { installNativeBoundary, GB, type NativeBoundary, type RamProfile } from './nativeBoundary';
import { createDownloadedModel } from '../utils/factories';

export interface DeviceModel {
  id: string;
  name: string;
  engine?: 'llama' | 'litert';
  fileSizeBytes?: number;
  liteRTVision?: boolean;
}

export interface LaunchOptions {
  engine?: 'llama' | 'litert';
  /** false: the model is downloaded and selected, but nothing is loaded. */
  load?: boolean;
  /** false: no local model is downloaded at all (a phone that only uses a server). */
  localModel?: boolean;
  /** The main model is a LiteRT bundle that carries vision. */
  liteRTVision?: boolean;
  /** The main model's size on disk, which drives the memory budget (default 2 GB). */
  modelFileSizeBytes?: number;
  /** More downloaded models, listed after the main one (for fallback turns). */
  extraModels?: DeviceModel[];
  ram?: RamProfile;
}

type NativeOnToken = (data: { token: string; content?: string; reasoning_content?: string }) => void;

export interface GenerationDevice {
  boundary: NativeBoundary;
  generationService: any;
  llmService: any;
  liteRTService: any;
  activeModelService: any;
  remoteServerManager: any;
  providerRegistry: any;
  useChatStore: any;
  useAppStore: any;
  useRemoteServerStore: any;
  conversationId: string;
  /** The main model's id. */
  modelId: string;
  /** Add a user message to the chat (the chat store's own action) and return the thread to answer. */
  ask(text: string, attachments?: Array<{ id: string; type: 'image' | 'audio' | 'document'; uri: string }>): any[];
  /** The chat's messages as stored. */
  thread(): any[];
  /** The assistant messages in the chat, as stored. */
  answers(): any[];
  /** The llama.rn context the app holds (the native object), once a llama model has loaded. */
  nativeContext(): Record<string, jest.Mock> | null;
  /** The token callback the app handed to the native completion that is (or was last) running. */
  nativeOnToken(): NativeOnToken | null;
}

function seedModel(boundary: NativeBoundary, m: DeviceModel) {
  const engine = m.engine ?? 'llama';
  const fileName = engine === 'llama' ? `${m.id}.gguf` : `${m.id}.litertlm`;
  const filePath = `${boundary.fs!.DocumentDirectoryPath}/models/${fileName}`;
  boundary.fs!.seedFile(filePath, 500 * 1024 * 1024);
  return createDownloadedModel({
    id: m.id,
    name: m.name,
    engine,
    filePath,
    fileName,
    fileSize: m.fileSizeBytes ?? 2 * GB,
    liteRTVision: m.liteRTVision,
  });
}

export async function launchGeneration(opts: LaunchOptions = {}): Promise<GenerationDevice> {
  const engine = opts.engine ?? 'llama';
  const boundary = installNativeBoundary({
    llama: true,
    fs: true,
    ram: opts.ram ?? { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB },
  });

  // Keep the context llama.rn hands back and the token callback each completion receives (the native side
  // of the stream), so a test can make the device emit what a real device emits — e.g. one late token.
  let context: Record<string, jest.Mock> | null = null;
  let onToken: NativeOnToken | null = null;
  const initLlama = boundary.llama!.module.initLlama;
  const open = initLlama.getMockImplementation()!;
  initLlama.mockImplementation(async (params: { embedding?: boolean }) => {
    const ctx = await open(params);
    if (params?.embedding) return ctx;
    const completion = ctx.completion as jest.Mock;
    const run = completion.getMockImplementation()!;
    completion.mockImplementation((p: unknown, cb?: NativeOnToken) => {
      onToken = cb ?? null;
      return run(p, cb);
    });
    context = ctx;
    return ctx;
  });

  const { hardwareService } = require('../../src/services/hardware');
  const { useAppStore, useChatStore, useRemoteServerStore } = require('../../src/stores');
  const { activeModelService } = require('../../src/services/activeModelService');
  const { generationService } = require('../../src/services/generationService');
  const { llmService } = require('../../src/services/llm');
  const { liteRTService } = require('../../src/services/litert');
  const { remoteServerManager } = require('../../src/services/remoteServerManager');
  const { providerRegistry } = require('../../src/services/providers');
  await hardwareService.refreshMemoryInfo();

  if (opts.localModel !== false) {
    const main = seedModel(boundary, {
      id: 'm', name: 'Test Model', engine, liteRTVision: opts.liteRTVision,
      fileSizeBytes: opts.modelFileSizeBytes,
    });
    useAppStore.getState().addDownloadedModel(main);
    activeModelService.selectTextModel('m');
  }
  for (const extra of opts.extraModels ?? []) useAppStore.getState().addDownloadedModel(seedModel(boundary, extra));
  if (opts.localModel !== false && opts.load !== false) await activeModelService.loadTextModel('m');

  const conversationId: string = useChatStore.getState().createConversation('m');

  // Leave no generation running into the next suite (jest.setup's afterEach calls this).
  (globalThis as unknown as { __GEN_CLEANUP__?: () => Promise<unknown> }).__GEN_CLEANUP__ =
    () => generationService.stopGeneration();

  const thread = () => useChatStore.getState().getConversationMessages(conversationId);
  return {
    boundary,
    generationService,
    llmService,
    liteRTService,
    activeModelService,
    remoteServerManager,
    providerRegistry,
    useChatStore,
    useAppStore,
    useRemoteServerStore,
    conversationId,
    modelId: 'm',
    ask: (text, attachments) => {
      useChatStore.getState().addMessage(conversationId, { role: 'user', content: text, attachments });
      return thread();
    },
    thread,
    answers: () => thread().filter((m: { role: string }) => m.role === 'assistant'),
    nativeContext: () => context,
    nativeOnToken: () => onToken,
  };
}

// ---------------------------------------------------------------------------
// The OpenAI-compatible server on the LAN.
// ---------------------------------------------------------------------------

export interface ServerReply {
  /** Reasoning deltas (`reasoning_content`, as LM Studio streams them), before the content. */
  reasoning?: string[];
  /** Content deltas. */
  content?: string[];
  /** Tool calls the model makes; the reply then ends with finish_reason 'tool_calls'. */
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** Answer with this HTTP status and an error body instead of a stream. */
  status?: number;
  /** After the deltas, the stream carries an error event (a provider error mid-stream). */
  streamError?: string;
  /** The connection drops after the deltas (XHR onerror). */
  dropConnection?: boolean;
  /** Keep the stream open after the first chunk until release(). */
  hold?: boolean;
}

export interface ServerHandle {
  serverId: string;
  modelId: string;
  /** The JSON bodies of the chat requests that were actually sent. */
  readonly requests: any[];
  /** Requests the app aborted. */
  readonly aborted: number;
  /** Queue the replies to the next chat requests, in order. */
  reply(...replies: ServerReply[]): void;
  release(): void;
  restore(): void;
}

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

function chunksOf(r: ServerReply): string[] {
  const out: string[] = [];
  for (const reasoning of r.reasoning ?? []) out.push(sse({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] }));
  for (const content of r.content ?? []) out.push(sse({ choices: [{ index: 0, delta: { content } }] }));
  (r.toolCalls ?? []).forEach((call, index) => out.push(sse({
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index, id: call.id, type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.arguments) },
        }],
      },
    }],
  })));
  if (r.streamError) {
    out.push(sse({ error: { message: r.streamError } }));
    return out;
  }
  if (r.dropConnection) return out;
  out.push(sse({ choices: [{ index: 0, delta: {}, finish_reason: r.toolCalls?.length ? 'tool_calls' : 'stop' }] }));
  out.push('data: [DONE]\n\n');
  return out;
}

/**
 * Put an OpenAI-compatible server on the LAN and choose its model the way the app does: the server is
 * saved, discovery's answer is placed (discovery is the network), and remoteServerManager selects the model
 * (creates the provider, applies the capabilities, makes it active).
 *
 * `select: false` saves the server and registers its provider (as the app does on launch) without choosing
 * a model on it — a provider that is not ready yet.
 */
export async function connectServer(
  device: GenerationDevice,
  opts: {
    caps?: Partial<{ supportsThinking: boolean; supportsToolCalling: boolean }>;
    select?: boolean;
    register?: boolean;
    /** false: discovery found no model on the server. */
    discovered?: boolean;
  } = {},
): Promise<ServerHandle> {
  const queue: ServerReply[] = [];
  const requests: any[] = [];
  let aborted = 0;
  let releaseFn: (() => void) | null = null;
  const g = global as unknown as { XMLHttpRequest: unknown };
  const original = g.XMLHttpRequest;

  class LanServerXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    private isAborted = false;
    open(): void { this.readyState = 1; }
    setRequestHeader(): void { /* the server reads no header */ }
    abort(): void { if (!this.isAborted) aborted += 1; this.isAborted = true; }
    send(body: string): void {
      requests.push(JSON.parse(body));
      const r = queue.shift() ?? { content: [''] };
      const finish = (status: number) => {
        if (this.isAborted) return;
        this.readyState = 4;
        this.status = status;
        this.onreadystatechange?.();
      };
      if (r.status) {
        setTimeout(() => {
          this.responseText = JSON.stringify({ error: { message: `upstream failed (${r.status})` } });
          finish(r.status!);
        }, 0);
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
        } else if (r.dropConnection) {
          this.onerror?.();
        } else {
          finish(200);
        }
      };
      setTimeout(pump, 0);
    }
  }
  g.XMLHttpRequest = LanServerXHR;

  const store = device.useRemoteServerStore.getState();
  const serverId: string = store.addServer({
    name: 'LM Studio', endpoint: 'http://192.168.1.20:1234', providerType: 'openai-compatible',
  });
  const modelId = 'qwen3-8b';
  store.setDiscoveredModels(serverId, opts.discovered === false ? [] : [{
    id: modelId, name: 'Qwen3 8B', serverId, lastUpdated: 't',
    capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false, ...opts.caps },
  }]);
  if (opts.select !== false) {
    await device.remoteServerManager.setActiveRemoteTextModel(serverId, modelId);
  } else {
    if (opts.register !== false) {
      const { createProviderForServerImpl } = require('../../src/services/remoteServerManagerUtils');
      await createProviderForServerImpl(device.useRemoteServerStore.getState().getServerById(serverId));
    }
    device.useRemoteServerStore.getState().setActiveServerId(serverId);
  }

  return {
    serverId,
    modelId,
    requests,
    get aborted() { return aborted; },
    reply: (...replies) => { queue.push(...replies); },
    release: () => { const f = releaseFn; releaseFn = null; f?.(); },
    restore: () => { g.XMLHttpRequest = original; },
  };
}
