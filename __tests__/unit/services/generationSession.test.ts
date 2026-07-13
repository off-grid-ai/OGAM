/**
 * generationSession — the single owner of "which conversation is currently
 * generating". Replaces the old multi-writer ref; verifies begin/end, the
 * isGeneratingFor projection, idempotence, and subscriber notification.
 */
import logger from '../../../src/utils/logger';
import { generationSession } from '../../../src/services/generationSession';

jest.spyOn(logger, 'log').mockImplementation(() => {});

beforeEach(() => {
  generationSession._reset();
  (logger.log as jest.Mock).mockClear();
});

describe('generationSession', () => {
  it('starts idle', () => {
    expect(generationSession.getConversationId()).toBeNull();
    expect(generationSession.isGeneratingFor('c1')).toBe(false);
  });

  it('begin sets the active conversation; end clears it', () => {
    generationSession.begin('c1');
    expect(generationSession.getConversationId()).toBe('c1');
    expect(generationSession.isGeneratingFor('c1')).toBe(true);
    expect(generationSession.isGeneratingFor('c2')).toBe(false);
    generationSession.end();
    expect(generationSession.getConversationId()).toBeNull();
    expect(generationSession.isGeneratingFor('c1')).toBe(false);
  });

  it('logs [GEN-SM] on begin and end with the reason', () => {
    generationSession.begin('c1');
    generationSession.end('stopped');
    const lines = (logger.log as jest.Mock).mock.calls.map(c => c[0] as string);
    expect(lines.some(l => l.includes('[GEN-SM] session begin conv=c1'))).toBe(true);
    expect(lines.some(l => l.includes('[GEN-SM] session end conv=c1 reason=stopped'))).toBe(true);
  });

  it('notifies subscribers on begin and end, not on a no-op', () => {
    const listener = jest.fn();
    const unsub = generationSession.subscribe(listener);
    generationSession.begin('c1');
    expect(listener).toHaveBeenCalledTimes(1);
    generationSession.begin('c1'); // idempotent — same id, no notify
    expect(listener).toHaveBeenCalledTimes(1);
    generationSession.end();
    expect(listener).toHaveBeenCalledTimes(2);
    generationSession.end(); // already idle — no notify
    expect(listener).toHaveBeenCalledTimes(2);
    unsub();
    generationSession.begin('c2');
    expect(listener).toHaveBeenCalledTimes(2); // unsubscribed
  });

  it('begin to a new conversation switches the owner', () => {
    generationSession.begin('c1');
    generationSession.begin('c2');
    expect(generationSession.getConversationId()).toBe('c2');
    expect(generationSession.isGeneratingFor('c1')).toBe(false);
  });
});
