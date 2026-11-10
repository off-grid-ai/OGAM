import { expertsNote, expertRelevance, GENERAL_CHARS, EXPERT_CHARS } from '../../src/learning/experts';

const taxes = { id: 't', name: 'Taxes', topic: 'personal income tax, deductions and filing', lessons: '- Check the deadline' };
const law = { id: 'l', name: 'Law', topic: 'contracts and tenant rights', lessons: '- Quote the clause' };
const psych = { id: 'p', name: 'Psychology', topic: 'cognitive bias and therapy methods', lessons: '- Name the bias' };

describe('which expert a chat uses', () => {
  it('picks the expert whose subject the message is about', () => {
    expect(expertsNote('Can I deduct my home office on my taxes?', '', [taxes, law, psych])).toContain('expert in Taxes');
    expect(expertsNote('What are my tenant rights if the landlord keeps the deposit?', '', [taxes, law, psych])).toContain('expert in Law');
    expect(expertsNote('Which cognitive bias explains this?', '', [taxes, law, psych])).toContain('expert in Psychology');
  });
  it('uses only one expert, never all of them', () => {
    const note = expertsNote('taxes law psychology', '', [taxes, law, psych]);
    expect((note.match(/expert in/g) ?? []).length).toBe(1);
  });
  it('adds no expert for an unrelated message, but always the general lessons', () => {
    const note = expertsNote('Give me a pasta recipe', '- Be brief', [taxes, law, psych]);
    expect(note).toContain('Be brief');
    expect(note).not.toContain('expert in');
  });
  it('skips an expert with no lessons yet, and returns nothing when there is nothing to add', () => {
    expect(expertsNote('my taxes', '', [{ ...taxes, lessons: '  ' }])).toBe('');
  });
  it('keeps each part short so a small model has room', () => {
    const big = 'x'.repeat(5000);
    const note = expertsNote('taxes please', big, [{ ...taxes, lessons: big }]);
    expect(note.length).toBeLessThan(GENERAL_CHARS + EXPERT_CHARS + 300);
  });
  it('counts the name more than the topic', () => {
    expect(expertRelevance('law', law)).toBeGreaterThan(expertRelevance('contracts', law));
  });
});
