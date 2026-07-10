/**
 * RED-FLOW (integration) — Q8: image-prompt enhancement is skipped/broken for a REMOTE text model.
 *
 * generateStandalone (engines.ts) has only a LiteRT branch and an llmService (local llama) fallback — no
 * remote path. When the active text model is remote (gateway), enhancement routes to the LOCAL llama
 * which isn't loaded, so it throws and the enhancement is silently dropped (generateStandalone has no
 * remote branch). Real generateStandalone + real stores + real engine dispatch; nothing device-native is
 * even reached because the remote branch is missing.
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';

describe('Q8 — prompt enhancement skipped for a remote text model (red-flow)', () => {
  it('enhances via the remote model instead of failing on the (unloaded) local engine', async () => {
    installNativeBoundary();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { generateStandalone } = require('../../../src/services/engines');
    const { useAppStore, useRemoteServerStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // A remote/gateway text model is active; NO local model is loaded.
    useAppStore.setState({ downloadedModels: [{ id: 'r1', name: 'Gateway Model', engine: 'remote' }], activeModelId: 'r1' });
    useRemoteServerStore.setState({ activeServerId: 'srv-1', activeRemoteTextModelId: 'r1' });

    let threw = false;
    const result = await generateStandalone([
      { id: 's', role: 'system', content: 'Rewrite the prompt for image generation.', timestamp: 0 },
      { id: 'u', role: 'user', content: 'a cat', timestamp: 0 },
    ]).catch(() => { threw = true; return ''; });

    // Correct: enhancement runs on the remote model and returns an enhanced prompt. Today generateStandalone
    // has no remote branch → it falls to the unloaded local llama and throws → enhancement dropped → RED.
    expect(threw).toBe(false);
    expect(result).toBeTruthy();
  });
});
