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
