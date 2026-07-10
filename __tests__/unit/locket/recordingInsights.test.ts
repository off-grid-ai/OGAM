/**
 * Unit tests for the insights generation service: the lenient section parser,
 * the extractive/LLM action-item merge, and the generateInsights router
 * (extractive floor + model-missing behaviour). The store and the shared
 * summarizer are mocked so only the service logic is exercised.
 */

// `mock`-prefixed so babel allows referencing inside the hoisted factory.
const mockIsBackendReady = jest.fn();
const mockSummarize = jest.fn();
const mockUpdateRecording = jest.fn();
const mockStore: { recordings: unknown[]; updateRecording: jest.Mock } = {
  recordings: [],
  updateRecording: mockUpdateRecording,
};

jest.mock('@offgrid/core/services', () => ({
  __esModule: true,
  NO_PREAMBLE_WITH_HEADINGS: '',
  transcriptSummarizer: {
    isBackendReady: () => mockIsBackendReady(),
    summarize: (...args: unknown[]) => mockSummarize(...args),
  },
}));

jest.mock('@offgrid/core/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../../../pro/locket/stores', () => ({
  useRecordingsStore: { getState: () => mockStore },
}));

import {
  parseInsights,
  mergeActionItems,
  generateInsights,
} from '../../../pro/locket/services/recordingInsights';
import { SummaryModelMissingError } from '../../../pro/locket/services/recordingSummary';
import type { ExtractedActionItem } from '../../../pro/locket/services/recordingInsightsExtractive';

const NOW = new Date(2026, 6, 8, 17, 0, 0).getTime();

describe('parseInsights', () => {
  it('parses well-formed labelled sections', () => {
    const out = parseInsights('TITLE: Payments sync\nSUMMARY: We shipped the API.\nACTIONS:\n- Email the deck\n- Call the vendor');
    expect(out.title).toBe('Payments sync');
    expect(out.summary).toBe('We shipped the API.');
    expect(out.actions).toEqual(['Email the deck', 'Call the vendor']);
  });

  it('tolerates missing sections', () => {
    const out = parseInsights('SUMMARY: Just a quick note.');
    expect(out.title).toBeUndefined();
    expect(out.summary).toBe('Just a quick note.');
    expect(out.actions).toEqual([]);
  });

  it('filters a lone "none" action', () => {
    const out = parseInsights('TITLE: Chat\nSUMMARY: Casual.\nACTIONS:\nnone');
    expect(out.actions).toEqual([]);
  });

  it('handles varied bullet styles', () => {
    const out = parseInsights('ACTIONS:\n* one\n1. two\n- three');
    expect(out.actions).toEqual(['one', 'two', 'three']);
  });

  it('treats header-less text as the summary', () => {
    const out = parseInsights('The team agreed to ship on Friday.');
    expect(out.summary).toBe('The team agreed to ship on Friday.');
    expect(out.actions).toEqual([]);
  });

  it('is case-insensitive on headers', () => {
    const out = parseInsights('title: Hi\nsummary: There.\nactions:\n- do it');
    expect(out.title).toBe('Hi');
    expect(out.actions).toEqual(['do it']);
  });
});

describe('mergeActionItems', () => {
  const extractive: ExtractedActionItem[] = [{ id: 'ai-1', text: 'Call Sam at 4pm', dueAt: NOW + 1000 }];

  it('appends new LLM actions', () => {
    const merged = mergeActionItems(extractive, ['Email the deck'], NOW);
    expect(merged).toHaveLength(2);
    expect(merged[1].text).toBe('Email the deck');
  });

  it('drops an LLM action that duplicates an extractive one (normalized)', () => {
    const merged = mergeActionItems(extractive, ['call sam at 4pm!'], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('ai-1'); // the extractive item is kept
  });

  it('parses a due time on a new LLM action', () => {
    const merged = mergeActionItems([], ['follow up tomorrow'], NOW);
    expect(merged[0].dueAt).toBeDefined();
  });
});

describe('generateInsights router', () => {
  const REC_ID = 'rec-1';
  const withRecording = (extra: Record<string, unknown> = {}) => {
    mockStore.recordings = [
      { id: REC_ID, transcript: 'Kickoff meeting. Remind me to call Sam at 4pm.', ...extra },
    ];
  };

  beforeEach(() => {
    mockIsBackendReady.mockReset();
    mockSummarize.mockReset();
    mockUpdateRecording.mockReset();
  });

  it('rejects when there is no transcript', async () => {
    mockStore.recordings = [{ id: REC_ID, transcript: '' }];
    await expect(generateInsights(REC_ID, NOW)).rejects.toThrow(/transcribe/i);
  });

  it('writes the extractive floor and throws when no backend is ready', async () => {
    withRecording();
    mockIsBackendReady.mockReturnValue(false);
    await expect(generateInsights(REC_ID, NOW)).rejects.toBeInstanceOf(SummaryModelMissingError);
    const floor = mockUpdateRecording.mock.calls.find((c) => c[1].insightsSource === 'extractive');
    expect(floor).toBeDefined();
    expect(floor?.[1].actionItems.length).toBeGreaterThan(0);
    expect(floor?.[1].title).toBe('Kickoff meeting');
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it('runs the LLM and merges when a backend is ready', async () => {
    withRecording();
    mockIsBackendReady.mockReturnValue(true);
    mockSummarize.mockResolvedValue('TITLE: Kickoff\nSUMMARY: We discussed scope.\nACTIONS:\n- Email the deck');
    await generateInsights(REC_ID, NOW);
    const done = mockUpdateRecording.mock.calls.find((c) => c[1].summaryStatus === 'done');
    expect(done).toBeDefined();
    expect(done?.[1].insightsSource).toBe('on-device');
    expect(done?.[1].summary).toBe('We discussed scope.');
    // extractive "call Sam" + LLM "Email the deck" = 2.
    expect(done?.[1].actionItems).toHaveLength(2);
  });

  it('marks the recording errored if the LLM throws', async () => {
    withRecording();
    mockIsBackendReady.mockReturnValue(true);
    mockSummarize.mockRejectedValue(new Error('backend blew up'));
    await expect(generateInsights(REC_ID, NOW)).rejects.toThrow(/blew up/);
    const errored = mockUpdateRecording.mock.calls.find((c) => c[1].summaryStatus === 'error');
    expect(errored).toBeDefined();
  });
});
