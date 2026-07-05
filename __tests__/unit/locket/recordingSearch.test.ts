/**
 * Unit tests for transcript-aware recording search (recordingSearch.ts).
 */
import {
  countOccurrences,
  extractSnippet,
  matchRecording,
  searchRecordings,
  highlightSegments,
  findSegmentSeekMs,
} from '../../../pro/locket/utils/recordingSearch';
import type { Recording } from '../../../pro/locket/stores/recordingsStore';

function rec(partial: Partial<Recording>): Recording {
  return {
    id: partial.id ?? 'r1',
    path: partial.path ?? '/x/rec-1.wav',
    startedAt: partial.startedAt ?? 1_000,
    endedAt: partial.endedAt ?? 2_000,
    durationMs: partial.durationMs ?? 1_000,
    sizeBytes: partial.sizeBytes ?? 1_000,
    ...partial,
  } as Recording;
}

describe('countOccurrences', () => {
  it('counts non-overlapping hits', () => {
    expect(countOccurrences('the budget and the budget again', 'budget')).toBe(2);
  });
  it('returns 0 for no hit and for empty needle', () => {
    expect(countOccurrences('nothing here', 'budget')).toBe(0);
    expect(countOccurrences('anything', '')).toBe(0);
  });
});

describe('extractSnippet', () => {
  it('adds ellipses when trimmed on both sides', () => {
    const text = `${'a'.repeat(60)}budget${'b'.repeat(60)}`;
    const idx = text.toLowerCase().indexOf('budget');
    const s = extractSnippet(text, idx, 'budget'.length);
    expect(s.startsWith('...')).toBe(true);
    expect(s.endsWith('...')).toBe(true);
    expect(s).toContain('budget');
  });
  it('omits leading ellipsis when the hit is near the start', () => {
    const s = extractSnippet('budget talk here', 0, 'budget'.length);
    expect(s.startsWith('...')).toBe(false);
    expect(s).toContain('budget');
  });
});

describe('matchRecording', () => {
  it('matches transcript and returns a snippet + hit count, ranked as transcript', () => {
    const r = rec({ transcript: 'we should finalize the budget before the budget review' });
    const m = matchRecording(r, 'budget');
    expect(m?.field).toBe('transcript');
    expect(m?.transcriptHits).toBe(2);
    expect(m?.snippet).toContain('budget');
  });
  it('matches title with no snippet when transcript does not hit', () => {
    const r = rec({ name: 'Budget meeting', transcript: 'unrelated words' });
    const m = matchRecording(r, 'budget');
    expect(m?.field).toBe('title');
    expect(m?.snippet).toBeNull();
    expect(m?.transcriptHits).toBe(0);
  });
  it('matches people when neither transcript nor title hit', () => {
    const r = rec({
      transcript: 'nope',
      attendees: [{ name: 'Sam Rivera', email: 'sam@x.com' }],
    });
    const m = matchRecording(r, 'rivera');
    expect(m?.field).toBe('people');
  });
  it('returns null when nothing matches', () => {
    expect(matchRecording(rec({ transcript: 'hello' }), 'budget')).toBeNull();
  });
});

describe('searchRecordings', () => {
  it('ranks transcript matches before title/people matches', () => {
    const titleHit = rec({ id: 'title', name: 'Budget sync', transcript: 'x' });
    const transcriptHit = rec({ id: 'tr', transcript: 'the budget is set' });
    const results = searchRecordings([titleHit, transcriptHit], 'budget');
    expect(results.map((m) => m.recording.id)).toEqual(['tr', 'title']);
  });
  it('is case-insensitive and returns [] for empty query', () => {
    const r = rec({ transcript: 'The BUDGET' });
    expect(searchRecordings([r], 'budget')).toHaveLength(1);
    expect(searchRecordings([r], '  ')).toHaveLength(0);
  });
});

describe('findSegmentSeekMs', () => {
  const segs = [
    { text: 'welcome everyone', startMs: 0, endMs: 2000 },
    { text: 'lets discuss the budget', startMs: 2000, endMs: 5000 },
    { text: 'and the budget again', startMs: 5000, endMs: 8000 },
  ];
  it('returns the startMs of the first segment containing the query', () => {
    expect(findSegmentSeekMs(segs, 'budget')).toBe(2000);
  });
  it('is case-insensitive', () => {
    expect(findSegmentSeekMs(segs, 'BUDGET')).toBe(2000);
  });
  it('returns null when no segment matches or no segments given', () => {
    expect(findSegmentSeekMs(segs, 'nothere')).toBeNull();
    expect(findSegmentSeekMs(undefined, 'budget')).toBeNull();
    expect(findSegmentSeekMs([], 'budget')).toBeNull();
  });
});

describe('matchRecording - seekMs', () => {
  it('sets seekMs from the matching segment on a transcript hit', () => {
    const r = rec({
      transcript: 'lets discuss the budget now',
      transcriptSegments: [
        { text: 'lets discuss the budget now', startMs: 4200, endMs: 9000 },
      ],
    });
    expect(matchRecording(r, 'budget')?.seekMs).toBe(4200);
  });
  it('leaves seekMs null when the transcript has no timed segments', () => {
    const r = rec({ transcript: 'the budget is set' });
    const m = matchRecording(r, 'budget');
    expect(m?.field).toBe('transcript');
    expect(m?.seekMs).toBeNull();
  });
});

describe('highlightSegments', () => {
  it('splits into match/non-match runs preserving original casing', () => {
    const segs = highlightSegments('The Budget is the Budget', 'budget');
    const matched = segs.filter((s) => s.match).map((s) => s.text);
    expect(matched).toEqual(['Budget', 'Budget']);
    // Reassembling yields the original text.
    expect(segs.map((s) => s.text).join('')).toBe('The Budget is the Budget');
  });
  it('returns the whole string as a single non-match run for empty query', () => {
    expect(highlightSegments('hello', '')).toEqual([{ text: 'hello', match: false }]);
  });
});
