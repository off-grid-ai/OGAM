import {
  preScore,
  fullScore,
  classifyImportance,
  priorityRank,
  LLM_THRESHOLD,
} from '../../../pro/locket/utils/recordingImportance';
import { refineActionItems } from '../../../pro/locket/services/recordingInsightsExtractive';
import type { Recording } from '../../../pro/locket/stores/recordingsStore';

const mk = (o: Partial<Recording> = {}): Recording => ({
  id: 'r', path: '/r.wav', startedAt: 0, endedAt: 0, durationMs: 60000, sizeBytes: 1000, ...o,
} as Recording);

describe('preScore (metadata + VAD, no transcript)', () => {
  it('rewards a calendar match heavily', () => {
    const withCal = preScore(mk({ eventTitle: 'Standup', attendees: [{ name: 'A', email: 'a' }, { name: 'B', email: 'b' }] }));
    const without = preScore(mk({}));
    expect(withCal).toBeGreaterThan(without);
    expect(withCal).toBeGreaterThan(0.5);
  });

  it('rewards sustained speech time', () => {
    const talky = preScore(mk({ durationMs: 600000, vad: { speech: [], totalMs: 600000, speechMs: 300000, speechPct: 50, detectedAt: 0 } }));
    const quiet = preScore(mk({ durationMs: 600000, vad: { speech: [], totalMs: 600000, speechMs: 5000, speechPct: 1, detectedAt: 0 } }));
    expect(talky).toBeGreaterThan(quiet);
  });
});

describe('fullScore / classifyImportance', () => {
  it('rates a substantive meeting transcript above the LLM gate', () => {
    const rec = mk({
      eventTitle: 'Planning',
      transcript: 'We reviewed the roadmap. Priya will send the deck by Friday and we should book the demo room. What about the budget?',
    });
    expect(fullScore(rec).score).toBeGreaterThanOrEqual(LLM_THRESHOLD);
    expect(classifyImportance(rec).worthLLM).toBe(true);
  });

  it('rates repetitive noise garbage below the gate', () => {
    const rec = mk({ transcript: 'thank you thank you thank you thank you thank you' });
    expect(fullScore(rec).score).toBeLessThan(LLM_THRESHOLD);
    expect(classifyImportance(rec).worthLLM).toBe(false);
  });

  it('scores an empty transcript at zero', () => {
    expect(fullScore(mk({ transcript: '' })).score).toBe(0);
  });

  it('leaves worthLLM null until transcribed', () => {
    expect(classifyImportance(mk({})).worthLLM).toBeNull();
  });
});

describe('priorityRank', () => {
  it('puts a calendar-matched clip ahead of a higher-scoring non-calendar one', () => {
    const cal = mk({ eventTitle: 'Sync', transcript: 'quick note' });
    const rich = mk({ transcript: 'We reviewed the roadmap and Priya will send the deck by Friday and book the room.' });
    expect(priorityRank(cal)).toBeGreaterThan(priorityRank(rich));
  });
});

describe('refineActionItems', () => {
  it('drops filler, short fragments, and verb-less items; keeps real to-dos', () => {
    const kept = refineActionItems([
      { id: '1', text: 'Send the deck to Priya by 4pm' },
      { id: '2', text: 'hmm' },
      { id: '3', text: 'the airport' },
      { id: '4', text: 'Q3' },
      { id: '5', text: 'Book the demo room for Friday' },
    ]);
    expect(kept.map((k) => k.id)).toEqual(['1', '5']);
  });

  it('dedups near-duplicates', () => {
    const kept = refineActionItems([
      { id: '1', text: 'Review the login PR' },
      { id: '2', text: 'review the login PR!' },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('1');
  });
});
