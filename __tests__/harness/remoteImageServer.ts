/**
 * A remote image server at the network boundary (fetch), plus the real gestures that make it the
 * chat's image model. The server answers an image request with a URL to transfer, as OpenAI-style
 * servers do; the transfer itself is served by the RNFS fake (nativeFileSystem.serveRemoteFile).
 */
import React from 'react';
import type { setupChatScreen } from './chatHarness';

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

const ENDPOINT = 'http://192.168.1.60:7878'; // NOSONAR - private LAN test fixture
export const REMOTE_IMAGE_URL = 'https://images.example.test/out/lighthouse.png';

export function serveImageGeneration(): { requests: number; restore: () => void } {
  const original = globalThis.fetch;
  const state = { requests: 0, restore: () => { globalThis.fetch = original; } };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${ENDPOINT}/v1/images/generations`) {
      state.requests += 1;
      return new Response(JSON.stringify({ data: [{ url: REMOTE_IMAGE_URL }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return original(input);
  }) as typeof globalThis.fetch;
  return state;
}

/**
 * Like serveImageGeneration, but the answer waits until `release()`, so the image stays in progress
 * while the test acts. The request stops when the app aborts it, as a real fetch does.
 */
export function holdImageGeneration(): {
  requests: number;
  aborted: number;
  release: () => void;
  restore: () => void;
} {
  const original = globalThis.fetch;
  const waiting: Array<() => void> = [];
  const state = {
    requests: 0,
    aborted: 0,
    release: () => { waiting.splice(0).forEach(answer => answer()); },
    restore: () => { globalThis.fetch = original; },
  };
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== `${ENDPOINT}/v1/images/generations`) return original(input, init);
    state.requests += 1;
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        state.aborted += 1;
        reject(new Error('Aborted'));
      }, { once: true });
      waiting.push(() => resolve(new Response(JSON.stringify({ data: [{ url: REMOTE_IMAGE_URL }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })));
    });
  }) as typeof globalThis.fetch;
  return state;
}

/** Pick the remote image model in the real picker, then switch the chat into image mode. */
export async function chooseRemoteImageModel(h: Harness): Promise<void> {
  const { useRemoteServerStore } = require('../../src/stores/remoteServerStore');
  const { RemoteModelOptionsSection } = require('../../src/components/models/RemoteModelOptionsSection');
  // A saved server with its discovered image catalog is what the add-server flow leaves behind.
  const serverId = useRemoteServerStore.getState().addServer({
    name: 'Studio Mac',
    endpoint: ENDPOINT,
    providerType: 'openai-compatible',
    modelCatalog: { image: [{ id: 'flux-schnell', name: 'Flux Schnell' }] },
  });
  const picker = h.rtl.render(React.createElement(RemoteModelOptionsSection, { category: 'image' }));
  h.rtl.fireEvent.press(picker.getByTestId(`remote-image-model-${serverId}:flux-schnell`));
  await h.rtl.waitFor(() => {
    expect(useRemoteServerStore.getState().activeRemoteMediaServerIds.image).toBe(serverId);
  });
  picker.unmount();

  h.render();
  await h.cycleImageMode();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
}

/** Clear the saved remote servers this harness added. */
export function clearRemoteServers(): void {
  require('../../src/stores/remoteServerStore').useRemoteServerStore.getState().clearAllServers();
}

// ---------------------------------------------------------------------------------------------------
// Off Grid AI Desktop as the image server: its gateway runs every image as an ASYNC JOB.
//
// Wire shapes are Desktop's own (desktop/src/main/model-server.ts):
//  - POST /v1/images/generations with `"async": true` answers 202 { request_id, object: 'request', status };
//  - GET /v1/requests/{id} is the poll: { request_id, object, kind, status, progress?, result? | error? };
//  - a job that ends `failed` carries error { message, type } from errMeta(); Desktop's image memory guard
//    puts its code in the message as `OFFGRID_IMAGE_MEMORY_LIMIT:<reason>`
//    (desktop/src/shared/image-generation-contract.ts imageMemoryGuardErrorMessage);
//  - the model switcher is /v1/models/catalog, /installed, /active and POST /v1/models/activate.
// ---------------------------------------------------------------------------------------------------

export const DESKTOP_IMAGE_ENDPOINT = 'http://192.168.1.61:7878'; // NOSONAR - private LAN test fixture
export const DESKTOP_IMAGE_MODEL = { id: 'flux-schnell', name: 'Flux Schnell' };
export const IMAGE_MEMORY_LIMIT_CODE = 'OFFGRID_IMAGE_MEMORY_LIMIT';
/** A real 1x1 PNG, as Desktop returns it in a completed job's `result.data[0].b64_json`. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export interface DesktopImageJobs {
  /** Every image submission Desktop received, in order: the JSON body the phone sent. */
  submissions: Array<Record<string, unknown>>;
  restore: () => void;
}

/**
 * Off Grid AI Desktop's gateway with one installed image model. Each image job runs one poll as
 * `running` (with progress), then ends. A job whose submission does not carry
 * `allow_unsafe_memory_override: true` ends `failed` with Desktop's image memory guard (`memoryReason`);
 * an overridden job completes with an image. By default the code rides in the message, as Desktop sends
 * it today; `failWithCode: true` sends the structured form instead (`error.code`, a plain message).
 */
export function serveDesktopImageJobs(options: { memoryReason: string; failWithCode?: boolean }): DesktopImageJobs {
  const original = globalThis.fetch;
  const jobs = new Map<string, { override: boolean; polls: number }>();
  let activeImage: string | null = null;
  const state: DesktopImageJobs = {
    submissions: [],
    restore: () => { globalThis.fetch = original; },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== DESKTOP_IMAGE_ENDPOINT) return original(input, init);
    if (init?.signal?.aborted) throw new Error('Aborted');
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (route === 'GET /v1/models') return json({ object: 'list', data: [] });
    if (route === 'GET /v1/models/catalog') {
      return json({
        kinds: ['text', 'vision', 'image', 'speech', 'transcription'],
        models: [{ ...DESKTOP_IMAGE_MODEL, kind: 'image', org: 'Black Forest Labs', tags: [], files: [] }],
      });
    }
    if (route === 'GET /v1/models/installed') return json({ installed: [DESKTOP_IMAGE_MODEL.id] });
    if (route === 'GET /v1/models/active') {
      return json({ text: null, image: activeImage, speech: null, transcription: null });
    }
    if (route === 'POST /v1/models/activate') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string; kind?: string };
      const known = body.kind === 'image' && body.id === DESKTOP_IMAGE_MODEL.id;
      if (known) activeImage = DESKTOP_IMAGE_MODEL.id;
      return json({ success: known });
    }
    if (route === 'POST /v1/images/generations') {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      state.submissions.push(body);
      const id = `img-${state.submissions.length}`;
      jobs.set(id, { override: body.allow_unsafe_memory_override === true, polls: 0 });
      return json({ request_id: id, object: 'request', kind: 'image', status: 'queued', poll_url: `/v1/images/${id}` }, 202);
    }
    const poll = url.pathname.match(/^\/v1\/requests\/([^/]+)$/);
    if (poll && method === 'GET') {
      const id = decodeURIComponent(poll[1]);
      const job = jobs.get(id);
      if (!job) return json({ error: { message: `No request with id '${id}'.`, type: 'not_found' } }, 404);
      job.polls += 1;
      const base = { request_id: id, object: 'request', kind: 'image', poll_url: `/v1/images/${id}` };
      if (job.polls === 1) return json({ ...base, status: 'running', progress: { step: 1, total: 4 } });
      if (!job.override) {
        return json({
          ...base,
          status: 'failed',
          error: options.failWithCode
            ? { message: options.memoryReason, type: 'server_error', code: IMAGE_MEMORY_LIMIT_CODE }
            : { message: `${IMAGE_MEMORY_LIMIT_CODE}:${options.memoryReason}`, type: 'server_error' },
        });
      }
      return json({ ...base, status: 'completed', result: { data: [{ b64_json: PNG_1X1 }] } });
    }
    return json({ error: { message: 'Unknown endpoint', type: 'not_found' } }, 404);
  }) as typeof globalThis.fetch;
  return state;
}

/**
 * The person has paired the Desktop (its saved server record) and picks its image model in the real
 * remote-model picker, which asks Desktop to activate it; then the chat is switched into image mode.
 */
export async function chooseDesktopImageModel(h: Harness): Promise<string> {
  const { remoteServerManager } = require('../../src/services/remoteServerManager');
  const { RemoteModelOptionsSection } = require('../../src/components/models/RemoteModelOptionsSection');
  const server = await remoteServerManager.addServer({
    name: 'Studio Mac',
    endpoint: DESKTOP_IMAGE_ENDPOINT,
    providerType: 'openai-compatible',
    modelManagement: 'offgrid-desktop-v1',
    modelCatalog: { image: [DESKTOP_IMAGE_MODEL] },
  });
  const picker = h.rtl.render(React.createElement(RemoteModelOptionsSection, { category: 'image' }));
  h.rtl.fireEvent.press(picker.getByTestId(`remote-image-model-${server.id}:${DESKTOP_IMAGE_MODEL.id}`));
  await h.rtl.waitFor(() => {
    expect(picker.getByTestId(`remote-image-model-${server.id}:${DESKTOP_IMAGE_MODEL.id}`).props.accessibilityState?.selected).toBe(true);
  });
  picker.unmount();

  h.render();
  await h.cycleImageMode();
  await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
  return server.id;
}
