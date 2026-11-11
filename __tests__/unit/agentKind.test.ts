import { isPal, DEFAULT_AGENTS } from '../../src/stores/agentStore';

describe('agents and pals', () => {
  it('Friend and Jake are pals; the working agents are not', () => {
    const pals = DEFAULT_AGENTS.filter(isPal).map((a) => a.id).sort();
    expect(pals).toEqual(['friend', 'girlfriend', 'jock-boyfriend', 'mentor']);
    expect(isPal(DEFAULT_AGENTS.find((a) => a.id === 'teacher')!)).toBe(false);
  });
  it('an agent saved before pals existed keeps working: the shipped two count as pals by id', () => {
    expect(isPal({ id: 'friend' })).toBe(true);
    expect(isPal({ id: 'my-own' })).toBe(false);
  });
  it('an explicit kind wins', () => {
    expect(isPal({ id: 'friend', kind: 'agent' })).toBe(false);
    expect(isPal({ id: 'custom', kind: 'pal' })).toBe(true);
  });
});
