import {
  extractTitle,
  extractActionItems,
  parseDueAt,
  extractInsights,
} from '../../../pro/locket/services/recordingInsightsExtractive';

// Fixed clock: Wed 8 Jul 2026, 17:00 local.
const NOW = new Date(2026, 6, 8, 17, 0, 0).getTime();

describe('extractTitle', () => {
  it('uses the first sentence, stripped of trailing punctuation', () => {
    expect(extractTitle('Standup for the payments team. We shipped the API.')).toBe(
      'Standup for the payments team',
    );
  });

  it('caps long titles with an ellipsis', () => {
    const long = `${'a'.repeat(80)}. rest`;
    const title = extractTitle(long, 60);
    expect(title?.endsWith('...')).toBe(true);
    expect((title ?? '').length).toBeLessThanOrEqual(63);
  });

  it('returns undefined for an empty transcript', () => {
    expect(extractTitle('')).toBeUndefined();
    expect(extractTitle('   ')).toBeUndefined();
  });
});

describe('extractActionItems', () => {
  it('detects a trigger sentence and parses a due time', () => {
    const items = extractActionItems('Remind me to call Sam at 4pm tomorrow.', NOW);
    expect(items).toHaveLength(1);
    expect(items[0].text.toLowerCase()).toContain('call sam');
    expect(items[0].dueAt).toBeDefined();
    const due = new Date(items[0].dueAt as number);
    expect(due.getHours()).toBe(16);
    expect(due.getDate()).toBe(9); // tomorrow
  });

  it('ignores sentences with no trigger phrase', () => {
    expect(extractActionItems('The weather is nice today.', NOW)).toHaveLength(0);
  });

  it('detects multiple distinct action items and de-dupes repeats', () => {
    const t = "Let's book the room. Let's book the room. I'll send the notes.";
    const items = extractActionItems(t, NOW);
    // Two distinct actions (the duplicate "book the room" collapses).
    expect(items).toHaveLength(2);
  });

  it('leaves dueAt undefined when no time is mentioned', () => {
    const items = extractActionItems("Don't forget to water the plants.", NOW);
    expect(items).toHaveLength(1);
    expect(items[0].dueAt).toBeUndefined();
  });
});

describe('parseDueAt', () => {
  it('rolls a bare past time forward to tomorrow', () => {
    // 9am, set at 5pm with no day hint -> tomorrow 9am.
    const due = parseDueAt('call at 9am', NOW);
    const d = new Date(due as number);
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(9);
  });

  it('keeps a bare future time today', () => {
    const due = parseDueAt('sync at 8pm', NOW);
    const d = new Date(due as number);
    expect(d.getHours()).toBe(20);
    expect(d.getDate()).toBe(8);
  });

  it('resolves "tomorrow" to 9am when no time is given', () => {
    const due = parseDueAt('follow up tomorrow', NOW);
    const d = new Date(due as number);
    expect(d.getDate()).toBe(9);
    expect(d.getHours()).toBe(9);
  });

  it('returns undefined when nothing time-like is present', () => {
    expect(parseDueAt('send the report', NOW)).toBeUndefined();
  });
});

describe('extractInsights', () => {
  it('returns title + action items together', () => {
    const out = extractInsights('Project kickoff. Remind me to email the deck by Friday.', NOW);
    expect(out.title).toBe('Project kickoff');
    expect(out.actionItems).toHaveLength(1);
  });

  it('returns an empty result for a blank transcript', () => {
    expect(extractInsights('', NOW)).toEqual({ actionItems: [] });
  });
});
