/**
 * generationSession — the single owner of "which conversation is currently
 * generating". Replaces the old multi-writer ref; verifies begin/end, the
 * isGeneratingFor projection, idempotence, and subscriber notification.
 */
import { generationSession } from '../../../src/services/generationSession';

// The real logger writes to the console: read what it wrote there.
const logger = { log: jest.spyOn(console, 'log').mockImplementation(() => undefined) };

beforeEach(() => {
  generationSession._reset();
  logger.log.mockClear();
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
    const lines = logger.log.mock.calls.map(c => c[0] as string);
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

describe('generationSession turns', () => {
  const { generationSession: session } = require('../../../src/services/generationSession');
  beforeEach(() => session._reset());

  it('a turn is current until it ends', () => {
    const turn = session.begin('c1');
    expect(session.isCurrent(turn)).toBe(true);
    session.end('stopped');
    expect(session.isCurrent(turn)).toBe(false);
  });

  it('a new turn after Stop is not the old one', () => {
    const first = session.begin('c1');
    session.end('stopped');
    const second = session.begin('c1');
    expect(session.isCurrent(first)).toBe(false);
    expect(session.isCurrent(second)).toBe(true);
  });

  it('begin again for the same chat keeps the same turn', () => {
    const turn = session.begin('c1');
    expect(session.begin('c1')).toBe(turn);
  });
});

describe('generationSession: a late turn cannot end a newer one', () => {
  const { generationSession: session } = require('../../../src/services/generationSession');
  beforeEach(() => session._reset());

  it('ignores an end from a turn that is no longer current', () => {
    const first = session.begin('c1');
    session.end('stopped');
    const second = session.begin('c2');
    session.end('done', first);
    expect(session.isCurrent(second)).toBe(true);
    expect(session.isGeneratingFor('c2')).toBe(true);
  });

  it('ends when the current turn finishes', () => {
    const turn = session.begin('c1');
    session.end('done', turn);
    expect(session.isGeneratingFor('c1')).toBe(false);
  });
});
