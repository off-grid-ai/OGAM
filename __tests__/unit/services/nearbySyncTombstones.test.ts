import { applyTombstones, captureRemovals, combineTombstones, emptyTombstones, validateTombstones } from '../../../src/services/nearbySync/tombstones';

const earlier = '2026-10-14T12:00:00.000Z';
const later = '2026-10-16T12:00:00.000Z';
const entry = (id: string, updatedAt = earlier) => ({ id, updatedAt, title: id });
describe('offline synchronization deletion safety', () => {
  it('records a deleted ordinary conversation for the other device', () => {
    const result = captureRemovals([entry('chat-one'), entry('chat-two')], [entry('chat-two')],
      { current: emptyTombstones(), kind: 'conversations', now: 1_760_000_000_000 });
    expect(result.conversations['chat-one']).toBe(1_760_000_000_000);
    expect(result.conversations['chat-two']).toBeUndefined();
  });
  it('publishes the deletion of a locked conversation (so it does not come back) but never of a temporary one', () => {
    const secret = { ...entry('secret'), pinVerifier: 'locked' };
    const temp = { ...entry('temp'), isPrivate: true };
    const result = captureRemovals([secret, temp], [], {
      current: emptyTombstones(), kind: 'conversations', now: 1_760_000_000_000,
    });
    expect(result.conversations).toEqual({ secret: 1_760_000_000_000 });
  });
  it('deletes a locked record deleted on the other phone, unless it was edited after the deletion', () => {
    const old = { ...entry('locked-old', earlier), pinVerifier: 'pin', protectedBlob: 'atlasbackup:v1:x' };
    const edited = { ...entry('locked-new', later), pinVerifier: 'pin', protectedBlob: 'atlasbackup:v1:y' };
    const deletedAt = Date.parse('2026-10-15T12:00:00.000Z');
    const kept = applyTombstones([old, edited], { 'locked-old': deletedAt, 'locked-new': deletedAt });
    expect(kept.map((r) => r.id)).toEqual(['locked-new']);
  });
  it('merges deletion ledgers idempotently and keeps the latest known deletion', () => {
    const a = emptyTombstones();
    const b = emptyTombstones();
    a.projects['p-1'] = 500;
    b.projects['p-1'] = 600;
    b.agents['a-1'] = 700;
    const merged = combineTombstones(a, b);
    expect(merged.projects['p-1']).toBe(600);
    expect(merged.agents['a-1']).toBe(700);
    expect(combineTombstones(merged, b)).toEqual(merged);
  });
  it('does not reintroduce an older record deleted elsewhere', () => {
    const whenDeleted = Date.parse('2026-10-15T12:00:00.000Z');
    expect(applyTombstones([entry('chat-one')], { 'chat-one': whenDeleted })).toEqual([]);
  });
  it('preserves a newer concurrent edit as a recovered copy rather than losing it', () => {
    const whenDeleted = Date.parse('2026-10-15T12:00:00.000Z');
    const current = entry('chat-one', later);
    const restored = applyTombstones([current], { 'chat-one': whenDeleted });
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toMatch(/^chat-one-saved-/);
    expect(restored[0].title).toContain('edited after deletion');
    expect(applyTombstones(restored, { 'chat-one': whenDeleted })).toEqual(restored);
  });
  it('never deletes a protected local record from an incoming ledger', () => {
    const locked = { ...entry('chat-one'), protectedBlob: 'cipher' };
    expect(applyTombstones([locked], { 'chat-one': Date.now() })).toEqual([locked]);
  });
  it('rejects corrupt deletion ledgers', () => {
    expect(() => validateTombstones({ conversations: {}, agents: {}, projects: { '../bad': 4 } })).toThrow();
    expect(() => validateTombstones({ conversations: { chat: 'yesterday' }, agents: {}, projects: {} })).toThrow();
    expect(validateTombstones(undefined)).toEqual(emptyTombstones());
  });
});