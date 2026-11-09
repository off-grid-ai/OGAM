import { aiStyleNote, NO_IDLE_QUESTIONS } from '../../src/services/aiStyle';

describe('aiStyleNote follow-up questions', () => {
  it('tells the model not to end with idle questions when nothing is chosen', () => {
    expect(aiStyleNote(undefined)).toContain(NO_IDLE_QUESTIONS);
    expect(aiStyleNote({})).toContain(NO_IDLE_QUESTIONS);
  });
  it('allows a follow-up only when the user turned them on', () => {
    const on = aiStyleNote({ followUps: true });
    expect(on).toContain('follow-up question when it would help');
    expect(on).not.toContain(NO_IDLE_QUESTIONS);
  });
  it('never asks when the user said never', () => {
    expect(aiStyleNote({ followUps: false })).toContain('Never end with a follow-up question');
  });
  it('keeps the other style rules and standing instructions', () => {
    const note = aiStyleNote({ length: 'brief', custom: 'Use metric units.' });
    expect(note).toContain('Keep answers short');
    expect(note).toContain('Use metric units.');
  });
});
