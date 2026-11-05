import { plainMath } from '../../../src/utils/visibleMessages';

describe('plainMath (a chat preview reads maths as text)', () => {
  it('turns inline LaTeX into plain symbols', () => {
    expect(plainMath('$37 \\times 43 = 1591$')).toBe('37 × 43 = 1591');
    expect(plainMath('\\(a \\div b\\) and \\frac{1}{2}')).toBe('a ÷ b and 1/2');
  });
  it('leaves ordinary text alone', () => {
    expect(plainMath('You: Name three rivers')).toBe('You: Name three rivers');
  });
});

describe('plainMath keeps money', () => {
  it('a price with no LaTeX keeps its dollar sign', () => {
    expect(plainMath('It costs $5 a month')).toBe('It costs $5 a month');
  });
});
