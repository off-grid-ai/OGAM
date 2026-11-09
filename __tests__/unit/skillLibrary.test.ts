import { SKILL_LIBRARY } from '../../src/skills/library';
import { parseSkill, skillSlug } from '../../src/skills/parseSkill';
import { pickSkill, skillBudgetChars } from '../../src/skills/selectSkills';
import type { Skill } from '../../src/skills/skillsStore';

const asSkills = (): Skill[] => SKILL_LIBRARY.map((s) => ({ ...s, enabled: true, addedAt: 0 }));
const NEW = ['simplified-technical-english', 'basic-english', 'plain-legal-language', 'special-english-voa', 'procedure-controlled-language',
  'first-principles', 'steelman-redteam', 'socratic-method', 'morphological-analysis', 'phenomenological-description',
  'pseudocode-to-prose', 'historical-era-voice', 'zero-adjective'];

describe('skill library', () => {
  it('has unique names that are valid commands', () => {
    const names = SKILL_LIBRARY.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(skillSlug(n)).toBe(n);
  });
  it('includes all thirteen controlled-language, reasoning and style skills', () => {
    for (const n of NEW) expect(SKILL_LIBRARY.map((s) => s.name)).toContain(n);
  });
  it('round-trips through the SKILL.md parser', () => {
    for (const s of SKILL_LIBRARY) {
      const p = parseSkill(`---\nname: ${s.name}\ndescription: ${s.description}\n---\n${s.body}`);
      expect(p.name).toBe(s.name);
      expect(p.body).toBe(s.body);
    }
  });
  it('fits a small phone model: every skill is under the 4K-context budget', () => {
    for (const s of SKILL_LIBRARY) expect(s.body.length).toBeLessThan(skillBudgetChars(4096));
  });
  it('can be called by name', () => {
    expect(pickSkill('/socratic-method help me with fractions', asSkills())?.name).toBe('socratic-method');
    expect(pickSkill('/zero-adjective rewrite this', asSkills())?.name).toBe('zero-adjective');
  });
});
