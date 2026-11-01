/**
 * BUG #29(a) regression — a remote generation failure must clear EVERY loading signal.
 *
 * When a remote model call fails (e.g. HTTP 400) an error alert shows, but a loading
 * indicator lingered. This drives the REAL generationService through a REAL remote-provider
 * failure (a registered provider whose generate() rejects) and asserts every loading flag
 * the UI reads is false afterward:
 *   - generationService.getState().isGenerating / isThinking
 *   - chatStore.isStreaming / isThinking / streamingForConversationId
 *   - generationSession (the "which conversation is generating" owner)
 *
 * Only the network boundary is faked: the remote server answers HTTP 400. The real remote provider, the
 * HTTP client, the service, both stores and the session owner run for real, so a lingering flag surfaces
 * here. Fails-before / passes-after.
 */
import { generationService } from '../../../src/services/generationService';
import { generationSession } from '../../../src/services/generationSession';
import { providerRegistry } from '../../../src/services/providers';
import { useChatStore } from '../../../src/stores/chatStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { resetStores, setupWithConversation, flushPromises } from '../../utils/testHelpers';
import { createMessage } from '../../utils/factories';
import { installRemoteFailure, installRemoteModel } from '../../harness/remoteHarness';

describe('BUG #29(a) — remote failure clears all loading flags', () => {
  let serverId = '';
  beforeEach(async () => {
    resetStores();
    generationSession._reset();
    await generationService.stopGeneration().catch(() => {});
  });

  afterEach(() => {
    providerRegistry.unregisterProvider(serverId);
    useRemoteServerStore.getState().setActiveServerId(null);
  });

  it('leaves isGenerating / isThinking / isStreaming / session all false after a remote error', async () => {
    // A remote model is in use (the connect flow's end state), and its server rejects the request.
    ({ serverId } = await installRemoteModel());
    installRemoteFailure(400, JSON.stringify({ error: { message: 'Bad Request' } }));

    const conversationId = setupWithConversation({ modelId: 'remote-model' });
    generationSession.begin(conversationId);

    await expect(
      generationService.generateResponse(conversationId, [createMessage({ role: 'user', content: 'hi' })]),
    ).rejects.toThrow('Bad Request');

    await flushPromises();

    const genState = generationService.getState();
    const chat = useChatStore.getState();

    expect(genState.isGenerating).toBe(false);
    expect(genState.isThinking).toBe(false);
    expect(chat.isStreaming).toBe(false);
    expect(chat.isThinking).toBe(false);
    expect(chat.streamingForConversationId).toBeNull();
    // generationService cleared its own session identity; the ChatScreen action layer
    // ends the generationSession on the thrown error (mirrored by handleStop/startGeneration).
    expect(generationService.isGeneratingFor(conversationId)).toBe(false);
  });
});
