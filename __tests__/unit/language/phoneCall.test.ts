import { parseHint, parseReview, scenarioFor, sentencesOf, CALL_TURNS_TO_PASS } from '../../../src/language/phoneCall';
import { finishedSentences } from '../../../src/language/callService';
import { boardFor, CALL_EVERY } from '../../../src/language/board';

describe('practice phone calls', () => {
  it('splits a reply into sentences and holds back one that is still being written', () => {
    expect(sentencesOf('Buenos días. ¿Qué desea tomar?')).toEqual(['Buenos días.', '¿Qué desea tomar?']);
    expect(finishedSentences('Buenos días. ¿Qué desea')).toEqual(['Buenos días.']);
    expect(finishedSentences('<think>hmm. ok.</think>Hola.')).toEqual(['Hola.']);
    expect(finishedSentences('<think>hmm. ok.')).toEqual([]);
  });

  it('reads a hint of two lines, and the mistakes of a review', () => {
    expect(parseHint('Line 1: Quiero un café.\nLine 2: I want a coffee.')).toEqual({ say: 'Quiero un café.', en: 'I want a coffee.' });
    expect(parseHint('Quiero un café.')).toBeNull();
    expect(parseReview('NONE')).toEqual([]);
    expect(parseReview('- Yo quiero café | Quiero café | pronoun left out\nFine | fine | nothing')).toEqual([{ said: 'Yo quiero café', fixed: 'Quiero café', why: 'pronoun left out' }]);
  });

  it('offers the call that matches the lesson before it', () => {
    expect(scenarioFor('food').id).toBe('cafe');
    expect(scenarioFor('nothing-matches', 1).id).toBe('intro');
    expect(CALL_TURNS_TO_PASS).toBeGreaterThan(1);
  });

  it('puts a call square on the board every few lessons, keeping the other squares\' keys', () => {
    const board = boardFor(1);
    const calls = board.filter((s) => s.kind === 'call');
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].key).toBe('call@1.1');
    const before = board.slice(0, board.indexOf(calls[0])).filter((s) => s.kind === 'lesson').length;
    expect(before).toBe(CALL_EVERY);
    expect(new Set(board.map((s) => s.key)).size).toBe(board.length);
  });
});
