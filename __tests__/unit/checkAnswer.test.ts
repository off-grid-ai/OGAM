import { figuresNotInContext, checkAnswerPrompt } from '../../src/services/checkAnswer';

describe('checking an answer', () => {
  const context = ['What is the filing deadline?', 'The deadline is April 15, and the standard deduction is $13,850.'];
  it('finds numbers that nothing earlier in the chat supports', () => {
    expect(figuresNotInContext('The deadline is April 15 and the penalty is 5% or $450.', context)).toEqual(['5%', '450']);
  });
  it('treats 13,850 and 13850 as the same figure, and ignores single digits', () => {
    expect(figuresNotInContext('You may deduct 13850 on 2 forms.', context)).toEqual([]);
  });
  it('lists each figure once and at most eight', () => {
    const reply = Array.from({ length: 12 }, (_, i) => `${i + 20}1`).join(' ') + ' 201 201';
    const out = figuresNotInContext(reply, []);
    expect(out).toHaveLength(8);
    expect(new Set(out).size).toBe(8);
  });
  it('names the loose figures in the message it sends', () => {
    const p = checkAnswerPrompt('The penalty is 5% or $450.', context);
    expect(p).toContain('5%, 450');
    expect(p).toContain('KNOWN');
    expect(p).toContain('Never make up');
  });
  it('says so when every figure is supported', () => {
    expect(checkAnswerPrompt('Due April 15.', context)).toContain('Every figure in it also appears earlier');
  });
});
