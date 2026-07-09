/**
 * MessageRenderer memo comparator — guards the chat-screen freeze fix.
 *
 * A ChatScreen re-render (streaming token, focus after the document picker, keyboard,
 * unrelated store tick) must NOT re-render + re-parse the markdown of every message.
 * getDisplayMessages keeps stable refs for historical messages, so the comparator
 * skips them and only the changed (streaming) item re-renders.
 */
import { messageRendererPropsEqual } from '../../../../src/screens/ChatScreen/MessageRenderer';

const base = () => ({
  item: { id: 'm1', role: 'assistant' as const, content: 'hello', timestamp: 1 } as any,
  index: 0,
  displayMessagesLength: 3,
  animateLastN: 0,
  imageModelLoaded: false,
  isStreaming: false,
  isGeneratingImage: false,
  showGenerationDetails: false,
  onCopy: () => {}, onRetry: () => {}, onEdit: () => {}, onGenerateImage: () => {}, onImagePress: () => {},
});

describe('messageRendererPropsEqual', () => {
  it('skips re-render when the message ref and flags are unchanged (the freeze fix)', () => {
    const prev = base();
    const next = { ...prev, item: prev.item }; // same message object ref
    expect(messageRendererPropsEqual(prev as any, next as any)).toBe(true);
  });

  it('IGNORES the always-fresh on* callbacks (else the memo would never skip)', () => {
    const prev = base();
    // Every parent render recreates these inline in useChatScreen — new refs must not
    // force a re-render, or the whole list re-parses markdown every render (the freeze).
    const next = { ...prev, onCopy: () => {}, onRetry: () => {}, onImagePress: () => {} };
    expect(messageRendererPropsEqual(prev as any, next as any)).toBe(true);
  });

  it('re-renders when the message object changes (new content → new ref, e.g. the streaming item)', () => {
    const prev = base();
    const next = { ...prev, item: { ...prev.item, content: 'hello world' } };
    expect(messageRendererPropsEqual(prev as any, next as any)).toBe(false);
  });

  it('re-renders when a render-affecting flag changes (streaming end, animation, image state)', () => {
    const prev = base();
    for (const patch of [
      { isStreaming: true }, { isGeneratingImage: true }, { imageModelLoaded: true },
      { showGenerationDetails: true }, { animateLastN: 2 }, { displayMessagesLength: 4 }, { index: 1 },
    ]) {
      expect(messageRendererPropsEqual(prev as any, { ...prev, ...patch } as any)).toBe(false);
    }
  });
});
