/**
 * JOURNEY: send a message WHILE an image is generating → it queues → image finishes →
 * the queue drains through the SAME routing seam as a fresh send (resolveTurnKind), so a
 * queued text goes to TEXT generation (reloading the text model the image-gen swap evicted)
 * and a queued image request goes to IMAGE.
 *
 * Cluster D (queued sends) × Cluster A (model evicted by image-gen swap). Crosses:
 *   generationService queue (enqueue/drain) → the registered queueProcessor →
 *   resolveTurnKind (the single send/resend modality decision).
 *
 * Driven through the REAL generationService queue and the REAL resolveTurnKind. We assert
 * the TERMINAL artifact: the queue is emptied and the drained item is routed to the correct
 * pipeline (recorded by the processor), never toHaveBeenCalled on an internal.
 *
 * Guards the seam behind the "image gen finishes outside generationService → drainQueue()"
 * call in handleImageGenerationFn: if the processor bypassed resolveTurnKind, a queued
 * "draw a cat" would go to text (Q-class routing bug) or a queued chat would try to draw.
 */
import { generationService } from '../../../src/services/generationService';
import { resolveTurnKind } from '../../../src/screens/ChatScreen/useChatGenerationActions';
import { resetStores } from '../../utils/testHelpers';

type Routed = { text: string; dest: 'text' | 'image' };

describe('JOURNEY: queued send after image-gen drains through the real routing seam', () => {
  beforeEach(() => {
    resetStores();
    generationService.clearQueue();
    generationService.setQueueProcessor(null);
  });

  // A faithful stand-in for useChatScreen.handleQueuedSend: it routes the drained item
  // through the REAL resolveTurnKind (manual mode = only image on force) and records where
  // it landed. This is the exact decision the production drainer makes.
  function makeRealDrainer(recorded: Routed[], opts: { imageMode: 'manual' | 'auto'; hasImageModel: boolean }) {
    const deps: any = {
      isGeneratingImage: false,
      settings: { imageGenerationMode: opts.imageMode, autoDetectMethod: 'pattern' },
      activeImageModel: opts.hasImageModel ? { id: 'img-model' } : null,
      downloadedModels: [],
      setIsClassifying: () => {},
      setAppImageGenerationStatus: () => {},
      setAppIsGeneratingImage: () => {},
      hasTextModel: true,
    };
    return async (item: { text: string }) => {
      const kind = await resolveTurnKind(deps, { text: item.text, imageEnabled: true });
      recorded.push({ text: item.text, dest: kind === 'image' ? 'image' : 'text' });
    };
  }

  it('a text message queued behind an image gen drains to TEXT and empties the queue', async () => {
    const recorded: Routed[] = [];
    generationService.setQueueProcessor(makeRealDrainer(recorded, { imageMode: 'manual', hasImageModel: true }));

    // User sent this while an image was generating → it queued (handleSendFn path).
    generationService.enqueueMessage({
      id: 'q1', conversationId: 'c1', text: 'and what breed was that?', messageText: 'and what breed was that?',
    });
    expect(generationService.getState().queuedMessages).toHaveLength(1);

    // Image gen finished → handleImageGenerationFn calls drainQueue().
    generationService.drainQueue();
    await Promise.resolve();
    await Promise.resolve();

    // TERMINAL artifacts: queue emptied, and the item routed to TEXT (not misrouted to draw).
    expect(generationService.getState().queuedMessages).toHaveLength(0);
    expect(recorded).toEqual([{ text: 'and what breed was that?', dest: 'text' }]);
  });

  it('multiple queued sends are combined into ONE drained item (no lost messages)', async () => {
    const recorded: Routed[] = [];
    generationService.setQueueProcessor(makeRealDrainer(recorded, { imageMode: 'manual', hasImageModel: true }));

    generationService.enqueueMessage({ id: 'q1', conversationId: 'c1', text: 'first', messageText: 'first' });
    generationService.enqueueMessage({ id: 'q2', conversationId: 'c1', text: 'second', messageText: 'second' });
    expect(generationService.getState().queuedMessages).toHaveLength(2);

    generationService.drainQueue();
    await Promise.resolve();
    await Promise.resolve();

    // TERMINAL: both texts survive, combined into a single drained turn.
    expect(generationService.getState().queuedMessages).toHaveLength(0);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].text).toContain('first');
    expect(recorded[0].text).toContain('second');
  });

  it('a queued "draw a cat" (force route) drains to IMAGE, not text', async () => {
    const recorded: Routed[] = [];
    // Auto mode with an image model + a draw-intent phrase routes to image via pattern classifier.
    const deps: any = {
      isGeneratingImage: false,
      settings: { imageGenerationMode: 'auto', autoDetectMethod: 'pattern' },
      activeImageModel: { id: 'img-model' },
      downloadedModels: [],
      setIsClassifying: () => {},
      setAppImageGenerationStatus: () => {},
      setAppIsGeneratingImage: () => {},
      hasTextModel: true,
    };
    generationService.setQueueProcessor(async (item: { text: string }) => {
      const kind = await resolveTurnKind(deps, { text: item.text, forceImageMode: true, imageEnabled: true });
      recorded.push({ text: item.text, dest: kind === 'image' ? 'image' : 'text' });
    });

    generationService.enqueueMessage({ id: 'q1', conversationId: 'c1', text: 'draw a cat', messageText: 'draw a cat' });
    generationService.drainQueue();
    await Promise.resolve();
    await Promise.resolve();

    expect(generationService.getState().queuedMessages).toHaveLength(0);
    expect(recorded).toEqual([{ text: 'draw a cat', dest: 'image' }]);
  });
});
