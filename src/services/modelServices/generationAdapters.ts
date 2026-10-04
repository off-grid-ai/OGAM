import {
  reasoningWireForGeneration,
  bindGenerationCancellation,
  GenerationAbortedError,
  GenerationCancellationFailedError,
  localTextRuntime,
  parseToolCallsFromText,
  type GenerationAdapter,
  type GenerationChunk,
  type GenerationRequest,
  type LiveGenerationContext,
  type ReasoningWireFragment,
  type RuntimeModel,
  classifyRuntimeError,
} from '@offgrid/models';
import type { GenerationMeta, Message } from '../../types';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { remoteTextTransportRegistry } from '../adapters/providers';
import type { TextStreamTransport } from '../adapters/providers/types';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { modelInputAudioUris, modelInputImageUris } from '../modelMedia';
import { getToolExtensions } from '../tools/extensions';
import { mobileExecutionAdapterId } from './mobileRoute';
import { mobileMessages, providerOptions } from './generationAdapterRequest';
import { mobileImageGenerationAdapter } from './imageGenerationAdapter';
import { mobileTextEngineControl } from './textEngineControl';
import logger from '../../utils/logger';

export class TextGenerationStopError extends GenerationCancellationFailedError {
  readonly code = 'text-generation-stop-failed' as const;

  constructor(readonly engineId: string, readonly cause: unknown) {
    super(
      `The ${engineId} runtime did not confirm that generation stopped.`,
      cause,
    );
    this.name = 'TextGenerationStopError';
  }
}

/** Native stop port: success means confirmed; failure stays typed and observable. */
export async function stopTextGenerationAtBoundary(
  engineId: string,
  stop: () => Promise<void>,
): Promise<void> {
  try {
    await stop();
  } catch (cause) {
    const failure = new TextGenerationStopError(engineId, cause);
    logger.error('[GenerationAdapter] Text generation stop failed:', failure);
    throw failure;
  }
}

type PendingChunk = {
  value?: GenerationChunk;
  error?: unknown;
  done?: boolean;
};

function resolvedToolCalls(
  content: string,
  nativeCalls: Array<{
    id?: string;
    name: string;
    arguments: Record<string, unknown>;
  }>,
) {
  const calls = nativeCalls.length
    ? [...nativeCalls]
    : parseToolCallsFromText(content).map((call, index) => ({
        id: `text-tool-${index}`,
        name: call.name,
        arguments: call.arguments,
      }));
  for (const extension of getToolExtensions()) {
    calls.push(...extension.parseToolCalls(content));
  }
  return calls;
}

function providerToolArguments(
  value: string | Record<string, unknown>,
): Record<string, unknown> {
  if (typeof value !== 'string') return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Convert the callback provider bridge into the shared async chunk boundary. */
// The bridge keeps the selected transport, model, canonical request, and wire policy explicit.
// eslint-disable-next-line max-params
async function* providerChunks(
  transport: TextStreamTransport,
  modelId: string,
  request: GenerationRequest,
  reasoningWire: ReasoningWireFragment,
): AsyncIterable<GenerationChunk> {
  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  const push = (item: PendingChunk) => {
    pending.push(item);
    wake?.();
    wake = null;
  };
  if (request.signal?.aborted) throw new GenerationAbortedError();
  const cancellation = bindGenerationCancellation(
    request.signal,
    () =>
      stopTextGenerationAtBoundary(transport.id, () =>
        transport.stopGeneration(),
      ),
    error => push({ error }),
  );
  const unregisterCancellation = request.cancellation?.register(() =>
    cancellation.cancel(),
  );
  const operation = transport
    .generate(
      modelId,
      mobileMessages(request.messages ?? []),
      providerOptions(request, reasoningWire),
      {
        onToken: content => push({ value: { content } }),
        onReasoning: reasoning => push({ value: { reasoning } }),
        onComplete: result => {
          const nativeCalls =
            result.toolCalls?.map(call => ({
              id: call.id,
              name: call.name,
              arguments: providerToolArguments(call.arguments),
            })) ?? [];
          // Keep Mobile's compatibility parser at the provider boundary. Some local
          // templates emit valid tool markup as text instead of native tool-call deltas.
          const resolved = resolvedToolCalls(result.content, nativeCalls);
          resolved.forEach((call, index) =>
            push({
              value: {
                toolCallDeltas: [
                  {
                    index,
                    id: call.id ?? `provider-tool-${index}`,
                    name: call.name,
                    argumentsDelta: JSON.stringify(call.arguments),
                  },
                ],
              },
            }),
          );
          push({
            value: {
              finishReason: resolved.length ? 'tool_calls' : 'stop',
            },
          });
          push({ done: true });
        },
        onError: error => push({ error }),
      },
    )
    .catch(error => push({ error }));

  try {
    for (;;) {
      if (!pending.length)
        await new Promise<void>(resolve => {
          wake = resolve;
        });
      const item = pending.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      if (item.value) yield item.value;
    }
    await operation;
    await cancellation.wait();
  } finally {
    unregisterCancellation?.();
    cancellation.dispose();
  }
}

function toolResultText(
  content: Awaited<ReturnType<LiveGenerationContext['executeTool']>>['content'],
): string {
  if (typeof content === 'string') return content;
  return content
    .map(part => (part.type === 'text' ? part.text : `[${part.type} result]`))
    .join('\n');
}

async function* liteRTChunks(
  request: GenerationRequest,
  context: LiveGenerationContext,
  reasoningWire: ReasoningWireFragment,
): AsyncIterable<GenerationChunk> {
  const messages = mobileMessages(request.messages ?? []);
  const systemPrompt =
    messages.find(message => message.role === 'system')?.content ?? '';
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== 'user') continue;
    lastUserIndex = index;
    break;
  }
  const current = lastUserIndex >= 0 ? messages[lastUserIndex] : null;
  const history = messages
    .slice(0, Math.max(0, lastUserIndex))
    .filter(
      (message): message is Message & { role: 'user' | 'assistant' } =>
        (message.role === 'user' || message.role === 'assistant') &&
        !!message.content.trim(),
    )
    .map(message => ({ role: message.role, content: message.content }));
  const tools = providerOptions(request, reasoningWire).tools ?? [];
  await liteRTService.prepareConversation(
    request.identity?.conversationId ?? '__shared_generation__',
    systemPrompt,
    {
      samplerConfig: {
        temperature: request.sampling?.temperature,
        topK: request.sampling?.topK,
        topP: request.sampling?.topP,
      },
      tools,
      history,
    },
  );

  const pending: PendingChunk[] = [];
  let wake: (() => void) | null = null;
  let toolIndex = 0;
  let streamedContent = '';
  const push = (item: PendingChunk) => {
    pending.push(item);
    const listener = wake;
    wake = null;
    listener?.();
  };
  if (request.signal?.aborted) throw new GenerationAbortedError();
  const cancellation = bindGenerationCancellation(
    request.signal,
    () =>
      stopTextGenerationAtBoundary('litert', () =>
        liteRTService.stopGeneration(),
      ),
    error => push({ error }),
  );
  const unregisterCancellation = request.cancellation?.register(() =>
    cancellation.cancel(),
  );
  const operation = liteRTService
    .generateRaw(
      mobileTextEngineControl.preparePrompt(
        current?.content ?? '',
        request.reasoning?.enabled === true,
      ),
      {
        imageUris: modelInputImageUris(current?.attachments),
        audioUris: modelInputAudioUris(current?.attachments),
      },
      {
        onToken: content => {
          streamedContent += content;
          push({ value: { content } });
        },
        onReasoning: reasoning => push({ value: { reasoning } }),
        onToolCall: async (name, args) => {
          const result = await context.executeTool({
            id: `${request.identity?.turnId ?? 'turn'}-native-${toolIndex++}`,
            name,
            arguments: JSON.stringify(args),
          });
          return toolResultText(result.content);
        },
      },
    )
    .then(content => {
      // LiteRT also returns the complete native response. Keep streaming as the
      // primary path, but use that authoritative completion when the native token
      // callback was absent so a successful reply cannot become an empty turn.
      if (!streamedContent && content) push({ value: { content } });
      push({ value: { finishReason: 'stop' } });
      push({ done: true });
    })
    .catch(error => push({ error }));

  try {
    for (;;) {
      if (!pending.length)
        await new Promise<void>(resolve => {
          wake = resolve;
        });
      const item = pending.shift();
      if (!item) continue;
      if (item.error) throw item.error;
      if (item.done) break;
      if (item.value) yield item.value;
    }
    await operation;
    await cancellation.wait();
  } finally {
    unregisterCancellation?.();
    cancellation.dispose();
  }
}

function generationMeta(modelId: string): GenerationMeta {
  const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
  const perf = llmService.getPerformanceStats();
  return {
    gpu,
    gpuBackend,
    gpuLayers,
    modelName: modelId,
    tokensPerSecond: perf.lastTokensPerSecond,
    decodeTokensPerSecond: perf.lastDecodeTokensPerSecond,
    timeToFirstToken: perf.lastTimeToFirstToken,
    tokenCount: perf.lastTokenCount,
  };
}

const llamaTextTransport: TextStreamTransport = {
  id: 'llama.rn',
  type: 'local',
  // This is the native transport boundary; Shared owns the four values passed to it.
  // eslint-disable-next-line max-params
  async generate(modelId, messages, options, callbacks): Promise<void> {
    if (!llmService.isModelLoaded()) throw new Error('No model loaded');
    let content = '';
    let reasoning = '';
    await llmService.runNativeCompletion(messages, {
      reasoningWire: options.reasoningWire,
      tools: options.tools,
      onStream: data => {
        if (data.content) {
          content += data.content;
          callbacks.onToken(data.content);
        }
        if (data.reasoningContent) {
          reasoning += data.reasoningContent;
          callbacks.onReasoning?.(data.reasoningContent);
        }
      },
      onComplete: result => {
        callbacks.onComplete({
          content: result.content || content,
          reasoningContent: result.reasoningContent || reasoning || undefined,
          meta: generationMeta(modelId),
          toolCalls: result.toolCalls,
        });
      },
    });
  },
  stopGeneration: () => llmService.stopGeneration(),
  isReady: async () => llmService.isModelLoaded(),
};

function remoteTransportFor(model: RuntimeModel): TextStreamTransport {
  const transport = model.serverId
    ? remoteTextTransportRegistry.get(model.serverId)
    : undefined;
  if (!transport)
    throw new Error(
      `Generation transport is unavailable: ${model.serverId ?? model.id}`,
    );
  return transport;
}

function adapter(id: string): GenerationAdapter {
  return {
    id,
    async load(model) {
      if (model.source !== 'local') return;
      await nativeModelLifecycle.loadTextModel(model.id);
    },
    async unload(model) {
      if (model.source === 'local')
        await nativeModelLifecycle.unloadTextModel(true);
    },
    async *generate(model, request, context) {
      // This is the single policy-to-wire translation for every Mobile text route.
      // Read llama.rn metadata after residency has loaded the native template, including on turn one.
      const localRuntime = localTextRuntime(model);
      const reasoningModel =
        localRuntime === 'llama-rn'
          ? { reasoning: llmService.getReasoningMetadata() }
          : model;
      const reasoningWire = reasoningWireForGeneration(request, reasoningModel);
      logger.log(
        `[WIRE-REASONING] ${JSON.stringify({
          routeId: request.routeId,
          reasoning: request.reasoning,
          control: reasoningModel.reasoning?.control,
          wire: reasoningWire,
        })}`,
      ); // [WIRE] policy→wire per turn
      if (localRuntime === 'litert') {
        yield* liteRTChunks(request, context, reasoningWire);
        return;
      }
      if (localRuntime === 'llama-rn') {
        if (request.identity?.conversationId) {
          await mobileTextEngineControl.prepareActiveConversation(
            request.identity.conversationId,
          );
        }
        yield* providerChunks(
          llamaTextTransport,
          model.id,
          request,
          reasoningWire,
        );
        return;
      }
      yield* providerChunks(
        remoteTransportFor(model),
        model.id,
        request,
        reasoningWire,
      );
    },
    classifyError: classifyRuntimeError,
  };
}

/** Remove an ephemeral shared-generation prompt from either native text runtime. */
export async function clearMobileEphemeralTextState(): Promise<void> {
  await mobileTextEngineControl.invalidateAllConversations();
}

export function reconcileMobileGenerationAdapters(
  service: { registerAdapter(adapter: GenerationAdapter): () => void },
  inventory: readonly RuntimeModel[],
  registrations: Map<string, () => void>,
): void {
  const supported = new Map<string, RuntimeModel['modality']>([
    [mobileExecutionAdapterId('local', 'llama', 'text'), 'text'],
    [mobileExecutionAdapterId('local', 'litert', 'text'), 'text'],
    ...inventory
      .filter(
        model =>
          (model.source === 'remote' && model.modality === 'text') ||
          model.modality === 'image',
      )
      .map(model => [model.adapterId, model.modality] as const),
  ]);
  for (const [id, unregister] of registrations) {
    if (supported.has(id)) continue;
    unregister();
    registrations.delete(id);
  }
  for (const [id, modality] of supported) {
    if (!registrations.has(id)) {
      registrations.set(
        id,
        service.registerAdapter(
          modality === 'image' ? mobileImageGenerationAdapter(id) : adapter(id),
        ),
      );
    }
  }
}
