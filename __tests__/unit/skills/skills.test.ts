import { parseSkill, skillSlug, SkillFormatError } from '../../../src/skills/parseSkill';
import { calledSkill, pickSkill, relevance, skillsNote, skillBudgetChars } from '../../../src/skills/selectSkills';
import type { Skill } from '../../../src/skills/skillsStore';

const claudeStyle = `---
name: Summarize Meeting Notes
description: Turn raw meeting notes into a short summary with decisions and action items. Use when the user pastes meeting notes or asks for minutes.
---

# Steps
1. List the decisions.
2. List action items with an owner.
`;

const openclawStyle = `---
name: weather
description: "Get the current weather and forecast for a city."
user-invocable: false
metadata: {"openclaw":{"requires":{"bins":["curl"]}}}
---
Use curl to fetch the forecast:

\`\`\`bash
curl -s wttr.in/London
\`\`\`
`;

const skill = (over: Partial<Skill> & { name: string; description: string }): Skill =>
  ({ body: 'Do the thing.', userInvocable: true, needs: [], enabled: true, addedAt: 1, ...over });

describe('reading a skill', () => {
  it('reads a Claude style skill: name made into a command, description and the steps', () => {
    const s = parseSkill(claudeStyle);
    expect(s.name).toBe('summarize-meeting-notes');
    expect(s.description).toMatch(/^Turn raw meeting notes/);
    expect(s.body).toMatch(/^# Steps/);
    expect(s.userInvocable).toBe(true);
    expect(s.needs).toEqual([]);
  });

  it('reads an OpenClaw style skill and says what it expects Atlas cannot run', () => {
    const s = parseSkill(openclawStyle);
    expect(s.name).toBe('weather');
    expect(s.description).toBe('Get the current weather and forecast for a city.');
    expect(s.userInvocable).toBe(false);
    expect(s.needs).toEqual(['curl']);
  });

  it('reads a folded multi-line description', () => {
    const s = parseSkill('---\nname: poet\ndescription: >\n  Write short poems\n  about anything.\n---\nWrite a poem.');
    expect(s.description).toBe('Write short poems about anything.');
  });

  it('explains what is missing instead of guessing', () => {
    expect(() => parseSkill('Just some text')).toThrow(SkillFormatError);
    expect(() => parseSkill('---\ndescription: x\n---\nbody')).toThrow(/no name/);
    expect(() => parseSkill('---\nname: x\n---\nbody')).toThrow(/no description/);
    expect(() => parseSkill('---\nname: x\ndescription: y\n---\n')).toThrow(/no instructions/);
    expect(skillSlug('  My Skill!! v2 ')).toBe('my-skill-v2');
  });
});

describe('choosing a skill for a message', () => {
  const notes = skill({ name: 'summarize-meeting-notes', description: 'Turn raw meeting notes into a short summary with decisions and action items.', body: 'List decisions, then action items.' });
  const poems = skill({ name: 'poet', description: 'Write short poems about any subject.' });
  const all = [notes, poems];

  it('picks the skill whose name or description fits the message', () => {
    expect(pickSkill('Can you summarize these meeting notes for me?', all)?.name).toBe('summarize-meeting-notes');
    expect(pickSkill('Please write short poems about the sea', all)?.name).toBe('poet');
    expect(pickSkill('write a short email to my landlord', all)).toBeUndefined(); // two shared words are not enough
  });

  it('uses no skill for an unrelated message, or when the skill is switched off', () => {
    expect(pickSkill('what is the capital of France?', all)).toBeUndefined();
    expect(pickSkill('summarize my meeting notes', [{ ...notes, enabled: false }, poems])).toBeUndefined();
    expect(relevance('hello there', notes)).toBe(0);
  });

  it('calls a skill by name with a slash, but not one that cannot be called that way', () => {
    expect(calledSkill('/poet the moon', all)?.name).toBe('poet');
    expect(pickSkill('/poet hello', all)?.name).toBe('poet'); // even when the words do not match
    expect(calledSkill('/poet hello', [{ ...poems, userInvocable: false }])).toBeUndefined();
    expect(calledSkill('/missing hello', all)).toBeUndefined();
  });

  it('adds the instructions to the prompt, cut to the room a small model has', () => {
    expect(skillsNote('summarize meeting notes', all, 4096)).toContain('SKILL "summarize-meeting-notes"');
    expect(skillsNote('summarize meeting notes', all, 4096)).toContain('List decisions, then action items.');
    expect(skillsNote('capital of France', all, 4096)).toBe('');
    const long = skill({ name: 'long', description: 'Long skill for essays about anything', body: 'x'.repeat(10000) });
    const note = skillsNote('/long essays', [long], 4096);
    expect(note.length).toBeLessThan(skillBudgetChars(4096) + 300);
    expect(note).toMatch(/left out to fit/);
    expect(skillBudgetChars(16384)).toBeGreaterThan(skillBudgetChars(4096));
  });
});
