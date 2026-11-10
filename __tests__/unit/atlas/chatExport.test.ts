import { conversationToText, conversationToPlainText, hasShareableTurns } from '../../../src/utils/chatExport';

const msg = (role: any, content: string, extra: any = {}) => ({ id: content, role, content, timestamp: 1, ...extra });

describe('chat export', () => {
  it('writes the title and the user/assistant turns, skipping system info and tool output', () => {
    const text = conversationToText({ title: 'Trip', messages: [
      msg('user', 'Plan a hike'), msg('system', 'Model loaded', { isSystemInfo: true }),
      msg('tool', '{"results":[]}'), msg('assistant', 'Start early.', { attachments: [{ id: 'i', type: 'image', uri: 'x' }] }),
    ] as any });
    expect(text).toBe('# Trip\n\n**You:** Plan a hike\n\n**Atlas:** Start early.\n_(1 image not included)_\n');
  });
  it('a locked (empty) chat has nothing to share', () => {
    expect(hasShareableTurns({ messages: [] })).toBe(false);
  });
  it('lists the numbered sources under a reply that cited them', () => {
    const chat = { title: 'Tax', messages: [msg('user', 'Rate?'), msg('assistant', 'It is 5% [1].', { generationMeta: { gpu: false, sources: [{ title: 'Guide (part 2)', quote: 'q' }, { title: 'FAQ', quote: '' }] } })] as any };
    expect(conversationToText(chat)).toBe('# Tax\n\n**You:** Rate?\n\n**Atlas:** It is 5% [1].\n\nSources:\n1. Guide (part 2)\n2. FAQ\n');
    expect(conversationToPlainText(chat)).toContain('Atlas: It is 5% [1].\nSources: 1. Guide (part 2); 2. FAQ');
  });
});
