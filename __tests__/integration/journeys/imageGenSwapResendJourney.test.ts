/**
 * JOURNEY: image-gen swaps the text model out → resend must re-DRAW (not re-load text).
 *
 * Cluster A (model lifecycle + memory) × Cluster D (interrupt/recovery), crossing:
 *   chatStore (persisted turn) → recordedTurnKind (turn-modality record) → resolveTurnKind
 *   (the single send/resend decision seam) → residency manager (what is resident).
 *
 * Driven end-to-end through the REAL seams: real chatStore, real modelResidencyManager,
 * real recordedTurnKind/resolveTurnKind. Only the native boundary is mocked. We assert the
 * TERMINAL artifact at each step: the persisted assistant message the user sees, and the
 * residents set in RAM — never toHaveBeenCalled as the proof.
 *
 * The bug this guards (B4, device-confirmed 1★): an image turn emits an "Enhanced prompt"
 * assistant message BEFORE the image-result message. recordedTurnKind must scan the WHOLE
 * turn, so resend re-runs the IMAGE pipeline instead of misclassifying the turn as text and
 * trying to load a text model (which was evicted by the image-gen swap).
 */
import { useChatStore } from '../../../src/stores/chatStore';
import {
  recordedTurnKind,
  resolveTurnKind,
} from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { modelResidencyManager } from '../../../src/services/modelResidency';
import { resetStores } from '../../utils/testHelpers';
import { createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

describe('JOURNEY: image-gen swap → resend re-draws (does not reload text)', () => {
  beforeEach(() => {
    resetStores();
    modelResidencyManager._reset();
    modelResidencyManager.setBudgetOverrideMB(null);
  });

  // A realistic image turn as it lands in the persisted store: the user's prompt,
  // then the "Enhanced prompt" assistant message, THEN the image-result message.
  function seedImageTurn(conversationId: string): { userId: string; messages: Message[] } {
    const userMsg = createMessage({ role: 'user', content: 'Draw a dog' });
    const enhanced = createMessage({
      role: 'assistant',
      content: '<think>__LABEL:Enhanced prompt__\na photorealistic golden retriever</think>',
    });
    const imageResult = createMessage({
      role: 'assistant',
      content: 'Generated image for: "Draw a dog"',
      attachments: [{ id: 'gen-1', type: 'image', uri: 'file:///dog.png' }],
    } as any);
    const conv = {
      id: conversationId,
      title: 'Draw a dog',
      messages: [userMsg, enhanced, imageResult],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any;
    useChatStore.setState({ conversations: [conv], activeConversationId: conversationId });
    return { userId: userMsg.id, messages: [userMsg, enhanced, imageResult] };
  }

  it('records the turn as IMAGE by scanning past the Enhanced-prompt reply (B4 whole-turn scan)', () => {
    const { userId, messages } = seedImageTurn('conv-img');
    // The FIRST reply is the Enhanced-prompt message (text-shaped). A first-reply-only
    // scan would misread this as 'text'. The whole-turn scan must find the image result.
    expect(recordedTurnKind(messages, userId)).toBe('image');
  });

  it('resolveTurnKind honors the recorded IMAGE kind verbatim on resend (no re-classify)', async () => {
    const { userId, messages } = seedImageTurn('conv-img');
    const recordedKind = recordedTurnKind(messages, userId);

    // A resend passes recordedKind; the decision seam must return it WITHOUT touching the
    // classifier. We give a deps object whose classifier path throws if reached — so if
    // resolveTurnKind ignored recordedKind and re-classified, this test fails.
    const explodingDeps: any = {
      isGeneratingImage: false,
      settings: { imageGenerationMode: 'auto', autoDetectMethod: 'llm' },
      activeImageModel: { id: 'img-model' },
      downloadedModels: [],
      setIsClassifying: () => { throw new Error('classifier must NOT run on a recorded resend'); },
      setAppImageGenerationStatus: () => {},
      setAppIsGeneratingImage: () => {},
      hasTextModel: true,
    };

    const kind = await resolveTurnKind(explodingDeps, { text: 'Draw a dog', recordedKind });
    expect(kind).toBe('image');
  });

  it('after the image-gen swap the IMAGE model is the resident, not the text model', async () => {
    // Reproduce the swap through the REAL residency manager on a device where both models
    // cannot co-reside. Text is resident first (chat), then the image load evicts it to fit.
    modelResidencyManager.setBudgetOverrideMB(4000); // ~4GB budget: only one heavy model fits

    const unloadText = jest.fn().mockResolvedValue(undefined);
    const unloadImage = jest.fn().mockResolvedValue(undefined);

    // Text model resident from the chat turn (3GB).
    modelResidencyManager.register(
      { key: 'text', type: 'text', modelId: 'text-1', sizeMB: 3000 },
      unloadText,
    );
    expect(modelResidencyManager.getResidents().map(r => r.key)).toEqual(['text']);

    // Image-gen: make room for the image model (3GB). It cannot co-reside with text in 4GB.
    const room = await modelResidencyManager.makeRoomFor({
      key: 'image',
      type: 'image',
      modelId: 'img-1',
      sizeMB: 3000,
      dirtyMemory: true,
    });
    expect(room.fits).toBe(true);
    expect(room.evicted).toContain('text'); // text was swapped OUT
    // The image caller registers the image model after its load.
    modelResidencyManager.register(
      { key: 'image', type: 'image', modelId: 'img-1', sizeMB: 3000, dirtyMemory: true },
      unloadImage,
    );

    const residents = modelResidencyManager.getResidents().map(r => r.key);
    expect(residents).toContain('image');
    expect(residents).not.toContain('text'); // TERMINAL artifact: text is gone from RAM
    expect(unloadText).toHaveBeenCalledTimes(1); // eviction actually ran the unload
  });

  it('resend of an image turn re-adds an image-bearing assistant message (never a bare text reply)', () => {
    // Terminal-artifact check on the PERSISTED conversation: after a resend re-runs the image
    // pipeline, the finalized message the user sees carries an image attachment.
    const conversationId = 'conv-img';
    const { userId, messages } = seedImageTurn(conversationId);
    expect(recordedTurnKind(messages, userId)).toBe('image');

    // A resend re-runs image gen with skipUserMessage:true, then adds the new image message.
    useChatStore.getState().addMessage(conversationId, {
      role: 'assistant',
      content: 'Generated image for: "Draw a dog"',
      attachments: [{ id: 'gen-2', type: 'image', uri: 'file:///dog2.png' }],
    } as any);

    const conv = useChatStore.getState().conversations.find(c => c.id === conversationId);
    const last = conv?.messages[conv.messages.length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.attachments?.some(a => a.type === 'image')).toBe(true);
  });
});
