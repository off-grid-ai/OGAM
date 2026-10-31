/**
 * Calls to Off Grid AI Desktop have no deadline (commit ae9c0c950): a Desktop that takes 6 seconds
 * to load a model or to accept an image still finishes the job.
 *
 * Product-correct outcome (the person's view): the person picks Desktop's image model in the remote
 * model picker. Desktop takes 6 seconds to load it (longer than the 5 seconds the phone used to
 * wait), then confirms. The pick shows as selected. They then ask the chat for an image; Desktop
 * again takes 6 seconds to accept the job, runs it, and the image appears in the chat. No step is
 * cut midway and no failure card shows.
 *
 * Real ChatScreen, image-mode toggle, RemoteModelOptionsSection picker, remoteServerManager,
 * offGridDesktopModels (gatewayFetch), imageGenerationService and remoteMediaRuntime. Fakes only at
 * the device boundary: Desktop's gateway over fetch (Desktop's own wire shapes, see
 * harness/remoteImageServer), answering two routes late, and the native file system.
 */
import React from 'react';
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

const ENDPOINT = 'http://192.168.1.63:7878'; // NOSONAR - private LAN test fixture
const MODEL = { id: 'flux-schnell', name: 'Flux Schnell' };
const SLOW_MS = 6_000;
/** A real 1x1 PNG, as Desktop returns it in a completed job's `result.data[0].b64_json`. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Desktop's gateway, answering model activation and image submission after SLOW_MS. A request the
 *  phone aborts rejects, as a real fetch does. */
function serveSlowDesktop(): { aborted: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const aborted: string[] = [];
  let activeImage: string | null = null;
  const polls = new Map<string, number>();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const late = (route: string, signal: AbortSignal | null | undefined, answer: () => Response) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(answer()), SLOW_MS);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        aborted.push(route);
        reject(new Error('Aborted'));
      }, { once: true });
    });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== ENDPOINT) return original(input, init);
    if (init?.signal?.aborted) throw new Error('Aborted');
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = `${method} ${url.pathname}`;
    if (route === 'GET /v1/models') return json({ object: 'list', data: [] });
    if (route === 'GET /v1/models/catalog') {
      return json({
        kinds: ['text', 'vision', 'image', 'speech', 'transcription'],
        models: [{ ...MODEL, kind: 'image', org: 'Black Forest Labs', tags: [], files: [] }],
      });
    }
    if (route === 'GET /v1/models/installed') return json({ installed: [MODEL.id] });
    if (route === 'GET /v1/models/active') {
      return json({ text: null, image: activeImage, speech: null, transcription: null });
    }
    if (route === 'POST /v1/models/activate') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { id?: string; kind?: string };
      return late(route, init?.signal, () => {
        const known = body.kind === 'image' && body.id === MODEL.id;
        if (known) activeImage = MODEL.id;
        return json({ success: known });
      });
    }
    if (route === 'POST /v1/images/generations') {
      return late(route, init?.signal, () => {
        polls.set('img-1', 0);
        return json({ request_id: 'img-1', object: 'request', kind: 'image', status: 'queued', poll_url: '/v1/images/img-1' }, 202);
      });
    }
    const poll = url.pathname.match(/^\/v1\/requests\/([^/]+)$/);
    if (poll && method === 'GET' && polls.has(poll[1])) {
      const count = polls.get(poll[1])! + 1;
      polls.set(poll[1], count);
      const base = { request_id: poll[1], object: 'request', kind: 'image', poll_url: `/v1/images/${poll[1]}` };
      return count === 1
        ? json({ ...base, status: 'running', progress: { step: 1, total: 4 } })
        : json({ ...base, status: 'completed', result: { data: [{ b64_json: PNG_1X1 }] } });
    }
    return json({ error: { message: 'Unknown endpoint', type: 'not_found' } }, 404);
  }) as typeof globalThis.fetch;
  return { aborted, restore: () => { globalThis.fetch = original; } };
}

describe('a slow Off Grid AI Desktop', () => {
  let desktop: ReturnType<typeof serveSlowDesktop> | undefined;

  afterEach(async () => {
    desktop?.restore();
    desktop = undefined;
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    await remoteServerManager.clearAllServers();
  });

  it('activates the picked model and draws the image when each answer takes 6 seconds', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    desktop = serveSlowDesktop();
    const { remoteServerManager } = require('../../../src/services/remoteServerManager');
    const { RemoteModelOptionsSection } = require('../../../src/components/models/RemoteModelOptionsSection');
    // The paired Desktop's saved record, as pairing leaves it.
    const server = await remoteServerManager.addServer({
      name: 'Studio Mac',
      endpoint: ENDPOINT,
      providerType: 'openai-compatible',
      modelManagement: 'offgrid-desktop-v1',
      modelCatalog: { image: [MODEL] },
    });
    const rowId = `remote-image-model-${server.id}:${MODEL.id}`;

    const picker = h.renderAside(React.createElement(RemoteModelOptionsSection, { category: 'image' }));
    // BEFORE: Desktop's image model is listed and not selected.
    expect(picker.getByTestId(rowId).props.accessibilityState?.selected).not.toBe(true);
    h.rtl.fireEvent.press(picker.getByTestId(rowId));
    await h.rtl.waitFor(() => {
      expect(picker.getByTestId(rowId).props.accessibilityState?.selected).toBe(true);
    }, { timeout: SLOW_MS + 4_000 });
    picker.unmount();

    h.render();
    await h.cycleImageMode();
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });
    expect(h.view!.queryByTestId('generated-image')).toBeNull();

    await h.tapSend('a lighthouse at dusk');
    await h.rtl.waitFor(() => {
      expect(h.view!.queryByTestId('generated-image')).not.toBeNull();
    }, { timeout: SLOW_MS + 10_000 });
    expect(h.view!.queryByTestId('model-failure-image')).toBeNull();
    expect(desktop.aborted).toEqual([]);
  }, 45_000);
});
