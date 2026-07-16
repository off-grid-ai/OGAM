/**
 * remoteHarness — makes a REMOTE (OpenAI-compatible / Ollama) model ACTIVE and replays a CAPTURED device
 * SSE response at the real network boundary (XMLHttpRequest, which createStreamingRequest uses), so the
 * REAL provider + processDelta + chat render run on top. Fake ONLY the transport; everything we own runs.
 *
 * Ground the SSE in a real captured response (docs/wire-captures/*lmstudio* / *ollama*), never a guess.
 */

/** Behavior-faithful fake of the streaming XMLHttpRequest transport. Replays `sseBody` incrementally via
 *  onprogress (as chunked SSE arrives on device), then completes 200 — exactly what createStreamingRequest
 *  consumes (reads xhr.responseText in onprogress, finalises on readyState 4). Install before a remote send. */
export function installRemoteStream(sseBody: string | string[]): { release: () => void } {
  // Accept a QUEUE of per-request bodies so a multi-turn remote flow (a tool loop: request 1 returns
  // tool_calls, request 2 — sent WITH the tool results — returns the final reply) replays the right body per
  // XHR. A single string keeps the old behavior; with an array each send() shifts the next body, the last
  // repeats for any extra requests.
  //
  // A body line that is exactly `__PAUSE__` HALTS the pump there (the deltas before it are delivered, the
  // stream is NOT completed) until the returned release() is called — so a test can observe the mid-stream
  // rendered state (e.g. the thinking-box header WHILE reasoning is still streaming). No pause line = no-op.
  const bodies = Array.isArray(sseBody) ? [...sseBody] : [sseBody];
  let releaseFn: (() => void) | null = null;
  class FakeXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    onprogress: null | (() => void) = null;
    onreadystatechange: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    open(): void { this.readyState = 1; }
    setRequestHeader(): void { /* headers irrelevant to the fake */ }
    abort(): void { /* no-op */ }
    send(): void {
      // Emit the captured body line-by-line, one per macrotask, so the REAL incremental parser runs like it
      // does on device — works for both OpenAI SSE (`data: {…}\n\n`) and Ollama NDJSON (`{…}\n`).
      const body = bodies.length > 1 ? bodies.shift()! : bodies[0];
      this.responseText = '';
      const chunks = body.match(/[^\n]*\n/g) ?? [body];
      let i = 0;
      const pump = (): void => {
        if (i < chunks.length) {
          const chunk = chunks[i++];
          if (chunk.trim() === '__PAUSE__') { releaseFn = () => setTimeout(pump, 0); return; } // hold here
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

/** Make a remote OpenAI-compatible model the ACTIVE model — the real connect flow's end state (server
 *  added, its models discovered, the provider registered + made active). Discovery/connection is the
 *  network boundary; we pre-place its result, then mount + gesture as the user. `caps` mirrors what a
 *  server actually advertises (LM Studio/Ollama do NOT advertise supportsThinking → no thinking toggle). */
export async function installRemoteModel(opts: {
  name?: string;
  endpoint?: string;
  providerType?: 'openai-compatible' | 'anthropic';
  caps?: Partial<{ supportsVision: boolean; supportsToolCalling: boolean; supportsThinking: boolean }>;
} = {}): Promise<{ serverId: string; modelId: string }> {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { useRemoteServerStore } = require('../../src/stores');
  const { providerRegistry } = require('../../src/services/providers');
  const { createProviderForServerImpl } = require('../../src/services/remoteServerManagerUtils');
  const { llmService } = require('../../src/services/llm');
  /* eslint-enable @typescript-eslint/no-var-requires */
  // A remote model is only USED when no local model is loaded/selected: generationService prefers a loaded
  // local model, and the dispatch keys off appStore.activeModelId. On device, selecting a remote model
  // clears the local selection and no local model is loaded — mirror that so the send routes remote.
  await llmService.unloadModel();
  const { useAppStore } = require('../../src/stores');
  useAppStore.getState().setActiveModelId(null);
  const name = opts.name ?? 'LM Studio';
  const endpoint = opts.endpoint ?? 'http://localhost:1234';
  const providerType = opts.providerType ?? 'openai-compatible';
  const modelId = 'remote-model';

  const serverId = useRemoteServerStore.getState().addServer({ name, endpoint, providerType });
  const model = {
    id: modelId, name: 'Remote Model', serverId, lastUpdated: 't',
    capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false, ...opts.caps },
  };
  const store = useRemoteServerStore.getState();
  store.setDiscoveredModels(serverId, [model]);
  store.setActiveServerId(serverId);
  store.setActiveRemoteTextModelId(modelId);

  // Register the provider the SAME way the connect flow does (build from the server + register), then set
  // the selected model on it (what picking a remote model does). generationService.getCurrentProvider reads
  // the active server from the store, so this is what a real remote generation runs against.
  const server = useRemoteServerStore.getState().getServerById(serverId);
  await createProviderForServerImpl(server);
  const provider = providerRegistry.getProvider(serverId);
  provider.updateConfig?.({ modelId });
  provider.modelCapabilities = { ...provider.modelCapabilities, ...model.capabilities, acceptsThinkingKwarg: !!opts.caps?.supportsThinking };
  providerRegistry.setActiveProvider(serverId);
  return { serverId, modelId };
}
