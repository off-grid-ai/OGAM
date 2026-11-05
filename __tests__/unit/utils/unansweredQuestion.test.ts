import { unansweredQuestionId } from '../../../src/utils/unansweredQuestion';
import { Message } from '../../../src/types';

const q = (id: string): Message => ({ id, role: 'user', content: '[test] q', timestamp: 1 });
const a = (id: string, extra: Partial<Message> = {}): Message => ({ id, role: 'assistant', content: '', timestamp: 2, ...extra });

describe('unansweredQuestionId', () => {
  it('names a question nothing follows', () => {
    expect(unansweredQuestionId([q('q1')])).toBe('q1');
  });

  it('names a question whose only reply is empty (Stop before the first word)', () => {
    expect(unansweredQuestionId([q('q1'), a('a1', { turnStatus: 'cancelled' } as Partial<Message>)])).toBe('q1');
  });

  it('is undefined when a reply has words', () => {
    expect(unansweredQuestionId([q('q1'), a('a1', { content: 'Sinhagad.' })])).toBeUndefined();
  });

  it('is undefined when a reply is a picture', () => {
    expect(unansweredQuestionId([q('q1'), a('a1', { attachments: [{ id: 'i', type: 'image', uri: 'file://x' }] as Message['attachments'] })])).toBeUndefined();
  });

  it('is undefined while the reply is being made', () => {
    expect(unansweredQuestionId([q('q1'), a('thinking', { isThinking: true })])).toBeUndefined();
    expect(unansweredQuestionId([q('q1'), a('streaming', { isStreaming: true })])).toBeUndefined();
  });

  it('is undefined for an empty chat or a chat ending in an answer', () => {
    expect(unansweredQuestionId([])).toBeUndefined();
    expect(unansweredQuestionId([a('a0', { content: 'Hi' })])).toBeUndefined();
  });
});
