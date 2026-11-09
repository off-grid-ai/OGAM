import { aboutMeNote, EMPTY_ABOUT, useAboutMe } from '../../src/stores/aboutMeStore';

describe('about you', () => {
  beforeEach(() => useAboutMe.setState({ about: EMPTY_ABOUT, memories: [] }));
  it('adds nothing to the prompt when empty', () => {
    expect(aboutMeNote(EMPTY_ABOUT, [])).toBe('');
  });
  it('lists only the boxes that are filled in', () => {
    const note = aboutMeNote({ ...EMPTY_ABOUT, name: 'Sam', helpWith: 'plan my week' }, []);
    expect(note).toContain('Name: Sam');
    expect(note).toContain('How they want you to help: plan my week');
    expect(note).not.toContain('Age');
  });
  it('uses the older Settings name when the box is empty', () => {
    expect(aboutMeNote(EMPTY_ABOUT, [], 'Alex')).toContain('Name: Alex');
  });
  it('keeps remembered facts, once each', () => {
    const s = useAboutMe.getState();
    expect(s.addMemory('Allergic to peanuts')).toBe('saved');
    expect(s.addMemory('allergic to peanuts')).toBe('exists');
    expect(aboutMeNote(EMPTY_ABOUT, useAboutMe.getState().memories)).toContain('Remembered: Allergic to peanuts');
  });
  it('the remember tool saves to it when no agent is selected', async () => {
    const DT = require('../../src/atlasTools/deviceTools');
    const { useAgentStore } = require('../../src/stores/agentStore');
    useAgentStore.setState({ activeAgentId: null });
    expect(await DT.rememberFact('Likes tea')).toBe('Remembered: Likes tea');
    expect(useAboutMe.getState().memories).toEqual(['Likes tea']);
  });
});
