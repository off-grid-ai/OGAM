/**
 * MULTIMODAL TURN JOURNEY (cluster B): resend re-uses the RECORDED modality of the turn — an image
 * turn re-draws (never falls back to a text reply), and a text turn stays text. The decision is made
 * ONCE (resolveTurnKind); resend passes the turn's recorded kind and it wins verbatim — the seam that
 * killed the 1★ "resend an image turn → got text" bug (B4).
 *
 * Drives the REAL recordedTurnKind + resolveTurnKind. Terminal artifact: the resolved TurnKind that
 * the resend path will act on (image → re-draw pipeline, text → text pipeline).
 *
 * Key adversarial edge (B4): an image turn emits an "Enhanced prompt" ASSISTANT message BEFORE the
 * image-result message. recordedTurnKind must scan the WHOLE turn, not just the first reply, or it
 * misclassifies the image turn as text and resend loads a text model instead of re-drawing.
 */
import { recordedTurnKind, resolveTurnKind } from '../../../../src/screens/ChatScreen/useChatGenerationActions';
import { createMessage } from '../../../utils/factories';
import type { MediaAttachment, Message } from '../../../../src/types';

const img = (): MediaAttachment => ({ id: 'img-1', type: 'image', uri: 'file:///gen/dog.png' } as MediaAttachment);
const voiceNote = (): MediaAttachment =>
  ({ id: 'a-1', type: 'audio', uri: 'file:///vn.wav', audioFormat: 'wav', textContent: 'draw a dog' } as MediaAttachment);

// resolveTurnKind only reads input.recordedKind on the replay path — deps are irrelevant then.
const noopDeps = {} as Parameters<typeof resolveTurnKind>[0];

describe('resend re-uses the recorded turn modality', () => {
  it('image turn (Enhanced-prompt msg BEFORE the image) → recordedTurnKind = image (B4 guard)', () => {
    const user = createMessage({ id: 'u1', role: 'user', content: 'draw a dog' });
    const enhanced = createMessage({ id: 'a1', role: 'assistant', content: 'A photorealistic dog, golden hour.' });
    const image = createMessage({ id: 'a2', role: 'assistant', content: '', attachments: [img()] });
    const messages: Message[] = [user, enhanced, image];
    // The FIRST reply (enhanced prompt) has no image — scanning only it would misclassify as text.
    expect(recordedTurnKind(messages, 'u1')).toBe('image');
  });

  it('image turn resend routes to the IMAGE pipeline (recorded kind wins over any classifier)', async () => {
    const kind = await resolveTurnKind(noopDeps, { text: 'draw a dog', recordedKind: 'image' });
    expect(kind).toBe('image');
  });

  it('text turn → recordedTurnKind = text; resend stays text', async () => {
    const user = createMessage({ id: 'u1', role: 'user', content: 'what is 2+2' });
    const reply = createMessage({ id: 'a1', role: 'assistant', content: '4' });
    expect(recordedTurnKind([user, reply], 'u1')).toBe('text');
    expect(await resolveTurnKind(noopDeps, { text: 'what is 2+2', recordedKind: 'text' })).toBe('text');
  });

  it('a VOICE-NOTE image turn (transcript "draw a dog") still re-draws on resend, not text', async () => {
    // The user sent a voice note whose transcript routed to image; the turn produced an image.
    const user = createMessage({ id: 'u1', role: 'user', content: 'draw a dog', attachments: [voiceNote()] });
    const image = createMessage({ id: 'a2', role: 'assistant', content: '', attachments: [img()] });
    expect(recordedTurnKind([user, image], 'u1')).toBe('image');
    expect(await resolveTurnKind(noopDeps, { text: 'draw a dog', recordedKind: 'image' })).toBe('image');
  });

  it('a turn with NO reply yet → undefined (caller falls back to classify, not a stale guess)', () => {
    const user = createMessage({ id: 'u1', role: 'user', content: 'draw a dog' });
    expect(recordedTurnKind([user], 'u1')).toBeUndefined();
  });
});
