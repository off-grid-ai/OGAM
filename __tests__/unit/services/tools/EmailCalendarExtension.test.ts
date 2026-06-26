/**
 * EmailCalendarExtension Unit Tests
 *
 * The email + calendar tools are pro-gated and implemented in the pro package
 * as a ToolExtension. These tests cover the tool definitions, enabled-state
 * filtering (read from the core enabledTools setting), and execution against a
 * mocked calendar native module and mailto link.
 */

import { Linking } from 'react-native';
import type { ToolCall } from '../../../../src/services/tools/types';
import type { ToolExtension } from '../../../../src/services/tools/extensions';

let mockEnabledTools: string[] = [];
jest.mock('@offgrid/core/stores', () => ({
  useAppStore: { getState: () => ({ settings: { enabledTools: mockEnabledTools } }) },
}));

const mockSaveEvent = jest.fn();
const mockRequestPermissions = jest.fn();
const mockFetchAllEvents = jest.fn();
jest.mock('react-native-calendar-events', () => ({
  __esModule: true,
  default: {
    saveEvent: (...args: any[]) => mockSaveEvent(...args),
    requestPermissions: (...args: any[]) => mockRequestPermissions(...args),
    fetchAllEvents: (...args: any[]) => mockFetchAllEvents(...args),
  },
}));

// The implementation lives in the private pro submodule, which is not checked
// out in the open-core CI. Load it dynamically via a computed path (so tsc does
// not try to resolve the absent module) and skip the suite when it is missing.
// jest hoists the jest.mock calls above this, so the mocks are already registered.
function loadProExtension(): ToolExtension | null {
  const proPath = ['..', '..', '..', '..', 'pro', 'tools', 'EmailCalendarExtension'].join('/');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(proPath).EmailCalendarExtension as ToolExtension;
  } catch {
    return null;
  }
}

const proExtension = loadProExtension();
const EmailCalendarExtension = proExtension ?? ({} as ToolExtension);
const describeIfPro = proExtension ? describe : describe.skip;

const mockOpenURL = jest.spyOn(Linking, 'openURL');

function call(name: string, args: Record<string, any> = {}): ToolCall {
  return { id: `c-${name}`, name, arguments: args };
}

describeIfPro('EmailCalendarExtension', () => {
  beforeEach(() => {
    mockEnabledTools = [];
    mockOpenURL.mockReset().mockResolvedValue(undefined as never);
    mockSaveEvent.mockReset().mockResolvedValue('evt-1');
    mockRequestPermissions.mockReset().mockResolvedValue('authorized');
    mockFetchAllEvents.mockReset().mockResolvedValue([]);
  });

  describe('definitions and gating', () => {
    it('advertises the three tools to the main picker', () => {
      const ids = EmailCalendarExtension.getToolDefinitions!().map(t => t.id);
      expect(ids).toEqual(['send_email', 'create_calendar_event', 'read_calendar_events']);
    });

    it('canHandle matches only its own tools', () => {
      expect(EmailCalendarExtension.canHandle('send_email')).toBe(true);
      expect(EmailCalendarExtension.canHandle('create_calendar_event')).toBe(true);
      expect(EmailCalendarExtension.canHandle('web_search')).toBe(false);
    });

    it('exposes schemas only for the enabled subset', () => {
      mockEnabledTools = ['send_email'];
      const schemas = EmailCalendarExtension.getOpenAISchemas!();
      expect(schemas.map((s: any) => s.function.name)).toEqual(['send_email']);
    });

    it('returns no schemas or hint when nothing is enabled', () => {
      expect(EmailCalendarExtension.getOpenAISchemas!()).toEqual([]);
      expect(EmailCalendarExtension.getSystemPromptHint()).toBe('');
    });

    it('hint lists only enabled tools', () => {
      mockEnabledTools = ['create_calendar_event'];
      const hint = EmailCalendarExtension.getSystemPromptHint();
      expect(hint).toContain('create_calendar_event');
      expect(hint).not.toContain('send_email');
    });

    it('reports 0 from enabledToolCount to avoid double counting', () => {
      mockEnabledTools = ['send_email', 'create_calendar_event'];
      expect(EmailCalendarExtension.enabledToolCount()).toBe(0);
    });

    it('does not parse or strip text (core handles the standard format)', () => {
      expect(EmailCalendarExtension.parseToolCalls('hello')).toEqual([]);
      expect(EmailCalendarExtension.stripFromVisibleText('hello')).toBe('hello');
    });
  });

  describe('execute: send_email', () => {
    it('opens the mail app and reports the recipient', async () => {
      const res = await EmailCalendarExtension.execute(
        call('send_email', { to: 'a@b.com', subject: 'Hi', body: 'Yo' }),
      );
      expect(res.error).toBeUndefined();
      expect(mockOpenURL).toHaveBeenCalledWith(expect.stringContaining('mailto:'));
      expect(res.content).toContain('a@b.com');
    });

    it('errors when the to address is missing', async () => {
      const res = await EmailCalendarExtension.execute(call('send_email', {}));
      expect(res.error).toContain('Missing required parameter: to');
    });

    it('errors when the mail app cannot be opened', async () => {
      mockOpenURL.mockRejectedValue(new Error('no app'));
      const res = await EmailCalendarExtension.execute(call('send_email', { to: 'a@b.com' }));
      expect(res.error).toContain('mail app');
    });
  });

  describe('execute: calendar', () => {
    it('creates an event after requesting write permission', async () => {
      const res = await EmailCalendarExtension.execute(
        call('create_calendar_event', {
          title: 'Sync',
          start_date: '2026-07-01T10:00:00.000Z',
          end_date: '2026-07-01T11:00:00.000Z',
        }),
      );
      expect(res.error).toBeUndefined();
      expect(mockRequestPermissions).toHaveBeenCalledWith(false);
      expect(mockSaveEvent).toHaveBeenCalledWith(
        'Sync',
        expect.objectContaining({ startDate: '2026-07-01T10:00:00.000Z' }),
      );
    });

    it('errors when calendar permission is denied', async () => {
      mockRequestPermissions.mockResolvedValue('denied');
      const res = await EmailCalendarExtension.execute(
        call('create_calendar_event', { title: 'Sync', start_date: '2026-07-01T10:00:00.000Z' }),
      );
      expect(res.error).toBe('Calendar permission denied');
      expect(mockSaveEvent).not.toHaveBeenCalled();
    });

    it('errors on an invalid start_date', async () => {
      const res = await EmailCalendarExtension.execute(
        call('create_calendar_event', { title: 'X', start_date: 'nope' }),
      );
      expect(res.error).toContain('Invalid start_date');
    });

    it('reads and formats events', async () => {
      mockFetchAllEvents.mockResolvedValue([
        { title: 'Lunch', startDate: '2026-07-01T12:00:00.000Z', endDate: '2026-07-01T13:00:00.000Z', location: 'Cafe' },
      ]);
      const res = await EmailCalendarExtension.execute(call('read_calendar_events', {}));
      expect(res.content).toContain('Lunch');
      expect(res.content).toContain('Cafe');
    });

    it('reports when no events are found', async () => {
      const res = await EmailCalendarExtension.execute(call('read_calendar_events', {}));
      expect(res.content).toContain('No calendar events found');
    });
  });

  it('returns an Unknown tool error for names it does not own', async () => {
    const res = await EmailCalendarExtension.execute(call('web_search', { query: 'x' }));
    expect(res.error).toContain('Unknown tool');
  });
});
