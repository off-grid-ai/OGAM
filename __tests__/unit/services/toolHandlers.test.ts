/**
 * Tool Handlers Unit Tests
 *
 * Tests for the read_url and search_knowledge_base tool handlers.
 */

import { executeToolCall } from '../../../src/services/tools/handlers';
import { Linking } from 'react-native';

// Mock fetch globally
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

const mockOpenURL = jest.spyOn(Linking, 'openURL');

// Mock RAG service for search_knowledge_base tests
const mockSearchProject = jest.fn();
jest.mock('../../../src/services/rag', () => ({
  ragService: { searchProject: (...args: any[]) => mockSearchProject(...args) },
}));

// Mock react-native-calendar-events
jest.mock('react-native-calendar-events', () => ({
  requestPermissions: jest.fn(),
  saveEvent: jest.fn(),
  fetchAllEvents: jest.fn(),
}));
const RNCalendarEvents = require('react-native-calendar-events');

describe('read_url handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches URL and strips HTML tags', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });

    const result = await executeToolCall({
      id: 'call_1',
      name: 'read_url',
      arguments: { url: 'https://example.com' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('World');
    expect(result.content).not.toContain('<');
  });

  it('rejects invalid URL without http/https', async () => {
    const result = await executeToolCall({
      id: 'call_2',
      name: 'read_url',
      arguments: { url: 'ftp://example.com' },
    });

    expect(result.error).toContain('Invalid URL');
  });

  it('returns error for missing url parameter', async () => {
    const result = await executeToolCall({
      id: 'call_3',
      name: 'read_url',
      arguments: {},
    });

    expect(result.error).toContain('Missing required parameter: url');
  });

  it('truncates content exceeding 4000 characters', async () => {
    const longContent = 'A'.repeat(5000);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => longContent,
    });

    const result = await executeToolCall({
      id: 'call_4',
      name: 'read_url',
      arguments: { url: 'https://example.com/long' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('[Content truncated]');
    expect(result.content.length).toBeLessThan(5000);
  });

  it('handles HTTP error responses', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await executeToolCall({
      id: 'call_5',
      name: 'read_url',
      arguments: { url: 'https://example.com/missing' },
    });

    expect(result.error).toContain('404');
  });

  it('handles fetch timeout/abort', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted'));

    const result = await executeToolCall({
      id: 'call_6',
      name: 'read_url',
      arguments: { url: 'https://example.com/slow' },
    });

    expect(result.error).toContain('aborted');
  });

  it('returns message for empty page content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>   </body></html>',
    });

    const result = await executeToolCall({
      id: 'call_7',
      name: 'read_url',
      arguments: { url: 'https://example.com/empty' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('no readable content');
  });

  it('strips surrounding quotes and angle brackets from URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<p>Content</p>',
    });

    const result = await executeToolCall({
      id: 'call_9',
      name: 'read_url',
      arguments: { url: '"https://example.com"' },
    });

    expect(result.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com',
      expect.any(Object),
    );
  });

  it.each([
    'http://localhost/admin',
    'http://127.0.0.1:8080/secret',
    'http://10.0.0.1/internal',
    'http://192.168.1.1/router',
    'http://169.254.169.254/latest/meta-data',
  ])('blocks private/loopback URL: %s', async (privateUrl) => {
    const result = await executeToolCall({
      id: 'call_ssrf', name: 'read_url', arguments: { url: privateUrl },
    });
    expect(result.error).toContain('Blocked');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes durationMs in result', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '<p>Test</p>',
    });

    const result = await executeToolCall({
      id: 'call_8',
      name: 'read_url',
      arguments: { url: 'https://example.com' },
    });

    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
  });
});

describe('search_knowledge_base handler', () => {
  beforeEach(() => {
    mockSearchProject.mockReset();
  });

  it('returns error when no projectId in context', async () => {
    const result = await executeToolCall({
      id: 'call_kb_1',
      name: 'search_knowledge_base',
      arguments: { query: 'test' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('No project context');
  });

  it('returns error for missing query parameter', async () => {
    const result = await executeToolCall({
      id: 'call_kb_2',
      name: 'search_knowledge_base',
      arguments: {},
      context: { projectId: 'proj-1' },
    });

    expect(result.error).toContain('Missing required parameter: query');
  });

  it('returns error for empty query string', async () => {
    const result = await executeToolCall({
      id: 'call_kb_3',
      name: 'search_knowledge_base',
      arguments: { query: '   ' },
      context: { projectId: 'proj-1' },
    });

    expect(result.error).toContain('Missing required parameter: query');
  });

  it('returns no results message when search finds nothing', async () => {
    mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });

    const result = await executeToolCall({
      id: 'call_kb_4',
      name: 'search_knowledge_base',
      arguments: { query: 'nonexistent topic' },
      context: { projectId: 'proj-1' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('No results found');
    expect(result.content).toContain('nonexistent topic');
  });

  it('returns formatted chunks when search finds matches', async () => {
    mockSearchProject.mockResolvedValue({
      chunks: [
        { doc_id: 1, name: 'guide.pdf', content: 'Machine learning basics', position: 0, score: 0.95 },
        { doc_id: 1, name: 'guide.pdf', content: 'Neural network architecture', position: 1, score: 0.8 },
      ],
      truncated: false,
    });

    const result = await executeToolCall({
      id: 'call_kb_5',
      name: 'search_knowledge_base',
      arguments: { query: 'machine learning' },
      context: { projectId: 'proj-1' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toContain('[1] guide.pdf (part 1)');
    expect(result.content).toContain('Machine learning basics');
    expect(result.content).toContain('[2] guide.pdf (part 2)');
    expect(result.content).toContain('Neural network architecture');
    expect(result.content).toContain('---');
  });

  it('trims whitespace from query', async () => {
    mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });

    await executeToolCall({
      id: 'call_kb_6',
      name: 'search_knowledge_base',
      arguments: { query: '  trimmed query  ' },
      context: { projectId: 'proj-1' },
    });

    expect(mockSearchProject).toHaveBeenCalledWith('proj-1', 'trimmed query');
  });

  it('includes durationMs in result', async () => {
    mockSearchProject.mockResolvedValue({ chunks: [], truncated: false });

    const result = await executeToolCall({
      id: 'call_kb_7',
      name: 'search_knowledge_base',
      arguments: { query: 'test' },
      context: { projectId: 'proj-1' },
    });

    expect(result.durationMs).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
  });
});

describe('calendar handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    RNCalendarEvents.requestPermissions.mockResolvedValue('authorized');
    RNCalendarEvents.saveEvent.mockResolvedValue('event-id-123');
    RNCalendarEvents.fetchAllEvents.mockResolvedValue([]);
  });

  describe('create_calendar_event', () => {
    it('throws when calendar package is unavailable', async () => {
      const origFn = RNCalendarEvents.requestPermissions;
      delete RNCalendarEvents.requestPermissions;
      const result = await executeToolCall({
        id: 'cal_1',
        name: 'create_calendar_event',
        arguments: { title: 'Meeting', start_date: '2025-01-01T10:00:00Z', end_date: '2025-01-01T11:00:00Z' },
      });
      RNCalendarEvents.requestPermissions = origFn;
      expect(result.error).toContain('Calendar package not available');
    });

    it('throws when calendar permission is denied', async () => {
      RNCalendarEvents.requestPermissions.mockResolvedValue('denied');
      const result = await executeToolCall({
        id: 'cal_2',
        name: 'create_calendar_event',
        arguments: { title: 'Meeting', start_date: '2025-01-01T10:00:00Z', end_date: '2025-01-01T11:00:00Z' },
      });
      expect(result.error).toContain('Calendar permission denied');
    });

    it('throws on invalid date format', async () => {
      const result = await executeToolCall({
        id: 'cal_3',
        name: 'create_calendar_event',
        arguments: { title: 'Meeting', start_date: 'not-a-date', end_date: '2025-01-01T11:00:00Z' },
      });
      expect(result.error).toContain('Invalid date format');
    });

    it('creates event and returns success message', async () => {
      const result = await executeToolCall({
        id: 'cal_4',
        name: 'create_calendar_event',
        arguments: { title: 'Meeting', start_date: '2025-01-01T10:00:00Z', end_date: '2025-01-01T11:00:00Z' },
      });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('Meeting');
    });

    it('includes location suffix when location is provided', async () => {
      const result = await executeToolCall({
        id: 'cal_5',
        name: 'create_calendar_event',
        arguments: { title: 'Standup', start_date: '2025-01-01T09:00:00Z', end_date: '2025-01-01T09:30:00Z', location: 'Room 4' },
      });
      expect(result.content).toContain('at Room 4');
      expect(RNCalendarEvents.saveEvent).toHaveBeenCalledWith('Standup', expect.objectContaining({ location: 'Room 4' }));
    });

    it('passes notes to saveEvent when provided', async () => {
      const result = await executeToolCall({
        id: 'cal_6',
        name: 'create_calendar_event',
        arguments: { title: 'Review', start_date: '2025-01-02T14:00:00Z', end_date: '2025-01-02T15:00:00Z', notes: 'Bring slides' },
      });
      expect(result.error).toBeUndefined();
      expect(RNCalendarEvents.saveEvent).toHaveBeenCalledWith('Review', expect.objectContaining({ notes: 'Bring slides' }));
    });
  });

  describe('read_calendar_events', () => {
    it('returns no-events message when calendar is empty', async () => {
      RNCalendarEvents.fetchAllEvents.mockResolvedValue([]);
      const result = await executeToolCall({
        id: 'cal_7',
        name: 'read_calendar_events',
        arguments: { start_date: '2025-01-01T00:00:00Z', end_date: '2025-01-07T00:00:00Z' },
      });
      expect(result.content).toContain('No calendar events found');
    });

    it('uses current date when no start_date provided', async () => {
      RNCalendarEvents.fetchAllEvents.mockResolvedValue([]);
      const result = await executeToolCall({
        id: 'cal_8',
        name: 'read_calendar_events',
        arguments: {},
      });
      expect(result.error).toBeUndefined();
      expect(RNCalendarEvents.fetchAllEvents).toHaveBeenCalledTimes(1);
    });

    it('throws on invalid start date', async () => {
      const result = await executeToolCall({
        id: 'cal_9',
        name: 'read_calendar_events',
        arguments: { start_date: 'bad-date' },
      });
      expect(result.error).toContain('Invalid start date');
    });

    it('throws on invalid end date', async () => {
      const result = await executeToolCall({
        id: 'cal_10',
        name: 'read_calendar_events',
        arguments: { start_date: '2025-01-01T00:00:00Z', end_date: 'bad-date' },
      });
      expect(result.error).toContain('Invalid end date');
    });

    it('formats events with location and notes', async () => {
      RNCalendarEvents.fetchAllEvents.mockResolvedValue([
        { title: 'Sprint Review', startDate: '2025-01-03T10:00:00Z', endDate: '2025-01-03T11:00:00Z', location: 'Conf Room', notes: 'Bring laptop' },
      ]);
      const result = await executeToolCall({
        id: 'cal_11',
        name: 'read_calendar_events',
        arguments: { start_date: '2025-01-01T00:00:00Z', end_date: '2025-01-07T00:00:00Z' },
      });
      expect(result.content).toContain('Sprint Review');
      expect(result.content).toContain('Location: Conf Room');
      expect(result.content).toContain('Notes: Bring laptop');
    });

    it('formats events without location and notes', async () => {
      RNCalendarEvents.fetchAllEvents.mockResolvedValue([
        { title: 'Daily Standup', startDate: '2025-01-03T09:00:00Z', endDate: null },
      ]);
      const result = await executeToolCall({
        id: 'cal_12',
        name: 'read_calendar_events',
        arguments: { start_date: '2025-01-01T00:00:00Z', end_date: '2025-01-07T00:00:00Z' },
      });
      expect(result.content).toContain('Daily Standup');
      expect(result.content).toContain('unknown');
      expect(result.content).not.toContain('Location:');
    });
  });
});

describe('web_search handler', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns error for missing query parameter', async () => {
    const result = await executeToolCall({ id: 'ws_1', name: 'web_search', arguments: {} });
    expect(result.error).toContain('Missing required parameter: query');
  });

  it('returns no-results message when search returns empty HTML', async () => {
    mockFetch.mockResolvedValue({ text: async () => '<html><body>Nothing here</body></html>' });
    const result = await executeToolCall({ id: 'ws_2', name: 'web_search', arguments: { query: 'xyzzy' } });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('No results found');
  });

  it('returns formatted results when search finds matches', async () => {
    const html = [
      '<div class="result-wrapper">',
      '<a href="https://example.com/page">Click me</a>',
      '<a class="title-link" href="https://example.com/page"><span class="title">Example Title</span></a>',
      '<p class="snippet">This is a snippet about the result</p>',
      '</div>',
    ].join('');
    mockFetch.mockResolvedValue({ text: async () => html });
    const result = await executeToolCall({ id: 'ws_3', name: 'web_search', arguments: { query: 'example' } });
    expect(result.error).toBeUndefined();
    expect(result.content).toBeDefined();
  });
});

describe('send_email handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenURL.mockResolvedValue(undefined);
  });

  it('opens mail app with to, subject, and body', async () => {
    const result = await executeToolCall({
      id: 'se_1',
      name: 'send_email',
      arguments: { to: 'test@example.com', subject: 'Hello', body: 'World' },
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('test@example.com');
    expect(result.content).toContain('Hello');
    expect(mockOpenURL).toHaveBeenCalledWith(expect.stringContaining('mailto:'));
  });

  it('opens mail app with only the to address when no subject or body', async () => {
    const result = await executeToolCall({
      id: 'se_2',
      name: 'send_email',
      arguments: { to: 'user@example.com' },
    });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('user@example.com');
    expect(mockOpenURL).toHaveBeenCalledWith(expect.stringContaining('mailto:'));
  });

  it('returns error when mail app cannot be opened', async () => {
    mockOpenURL.mockRejectedValue(new Error('No mail app'));
    const result = await executeToolCall({
      id: 'se_3',
      name: 'send_email',
      arguments: { to: 'fail@example.com' },
    });
    expect(result.error).toContain('mail app');
  });

  it('returns error for missing to parameter', async () => {
    const result = await executeToolCall({ id: 'se_4', name: 'send_email', arguments: {} });
    expect(result.error).toContain('Missing required parameter: to');
  });
});
