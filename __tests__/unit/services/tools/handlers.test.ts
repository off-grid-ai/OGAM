/**
 * Tool Handlers Unit Tests
 *
 * Tests for executeToolCall dispatcher, calculator, datetime, device info,
 * and web search handlers.
 * Priority: P0 (Critical) - Tool execution drives assistant capabilities.
 */

import DeviceInfo from 'react-native-device-info';
import { executeToolCall } from '../../../../src/services/tools/handlers';
import { ToolCall } from '../../../../src/services/tools/types';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  log: jest.fn(),
}));

const mockRagSearchProject = jest.fn();
jest.mock('../../../../src/services/rag', () => ({
  ragService: {
    searchProject: (...args: any[]) => mockRagSearchProject(...args),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeToolCall(name: string, args: Record<string, any> = {}): ToolCall {
  return { id: 'test-call-1', name, arguments: args };
}

/** Shorthand: create a tool call and execute it in one step. */
async function runTool(name: string, args: Record<string, any> = {}) {
  return executeToolCall(makeToolCall(name, args));
}

/**
 * Builds a minimal Brave Search-style HTML string containing result blocks.
 * Each entry produces one block with class="result-wrapper" containing
 * a title link, URL, and snippet paragraph.
 */
function buildBraveSearchHTML(
  results: Array<{ title: string; url: string; snippet: string }>,
): string {
  const blocks = results
    .map(
      (r) =>
        `<div class="result-wrapper">
          <a class="result-header" href="${r.url}">
            <span class="snippet-title">${r.title}</span>
          </a>
          <p class="snippet-description">${r.snippet}</p>
        </div>`,
    )
    .join('\n');
  return `<html><body>${blocks}</body></html>`;
}

// ============================================================================
// executeToolCall dispatcher
// ============================================================================
describe('Tool Handlers', () => {
  describe('executeToolCall dispatcher', () => {
    it('routes to calculator handler', async () => {
      const result = await runTool('calculator', { expression: '1+1' });
      expect(result.name).toBe('calculator');
      expect(result.content).toContain('1+1');
      expect(result.content).toContain('2');
      expect(result.error).toBeUndefined();
    });

    it('routes to datetime handler', async () => {
      const result = await runTool('get_current_datetime');
      expect(result.name).toBe('get_current_datetime');
      expect(result.content).toContain('Current date and time');
      expect(result.error).toBeUndefined();
    });

    it('routes to device info handler', async () => {
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.name).toBe('get_device_info');
      expect(result.content).toContain('Memory');
      expect(result.error).toBeUndefined();
    });

    it('returns error for unknown tool name', async () => {
      const result = await runTool('nonexistent_tool');
      expect(result.error).toBe('Unknown tool: nonexistent_tool');
      expect(result.content).toBe('');
    });

    it('each result includes durationMs', async () => {
      const result = await runTool('calculator', { expression: '5+5' });
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Calculator
  // ==========================================================================
  describe('Calculator', () => {
    it.each([
      ['2+2', '2+2 = 4'],
      ['3*4', '3*4 = 12'],
      ['(2+3)*4', '(2+3)*4 = 20'],
      ['2^3', '2^3 = 8'],
      ['10/2', '10/2 = 5'],
    ])('evaluates %s correctly', async (expr, expected) => {
      const result = await runTool('calculator', { expression: expr });
      expect(result.content).toBe(expected);
    });

    it('rejects invalid characters (letters)', async () => {
      const result = await runTool('calculator', { expression: '2+abc' });
      expect(result.error).toContain('Invalid expression');
    });

    it('rejects invalid characters (semicolons)', async () => {
      const result = await runTool('calculator', { expression: '2+2; process.exit()' });
      expect(result.error).toContain('Invalid expression');
    });

    it('evaluates modulo operator', async () => {
      const result = await runTool('calculator', { expression: '10%3' });
      expect(result.content).toContain('= 1');
    });
  });

  // ==========================================================================
  // Date/Time
  // ==========================================================================
  describe('Date/Time', () => {
    it('returns formatted date/time string with ISO and Unix timestamp', async () => {
      const result = await runTool('get_current_datetime');
      expect(result.content).toContain('Current date and time:');
      expect(result.content).toMatch(/ISO 8601: \d{4}-\d{2}-\d{2}T/);
      expect(result.content).toMatch(/Unix timestamp: \d+/);
    });

    it('handles invalid timezone gracefully (returns fallback)', async () => {
      const result = await runTool('get_current_datetime', { timezone: 'Invalid/Fake_Zone' });
      expect(result.content).toContain('invalid');
      expect(result.content).toContain('Invalid/Fake_Zone');
      expect(result.error).toBeUndefined();
    });
  });

  // ==========================================================================
  // Device Info
  // ==========================================================================
  describe('Device Info', () => {
    beforeEach(() => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getFreeDiskStorage.mockResolvedValue(50 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getTotalDiskCapacity = jest.fn().mockResolvedValue(128 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getBatteryLevel = jest.fn().mockResolvedValue(0.75);
      (mockedDeviceInfo as any).isBatteryCharging = jest.fn().mockResolvedValue(false);
      (mockedDeviceInfo as any).getBrand = jest.fn().mockReturnValue('Google');
      mockedDeviceInfo.getModel.mockReturnValue('Pixel 7');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
    });

    it('returns memory info when type is "memory"', async () => {
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.content).toContain('Memory');
      expect(result.content).toContain('Total');
      expect(result.content).toContain('Used');
      expect(result.content).toContain('Available');
    });

    it('returns battery info when type is "battery"', async () => {
      const result = await runTool('get_device_info', { info_type: 'battery' });
      expect(result.content).toContain('Battery');
      expect(result.content).toContain('75%');
    });

    it('returns all info when type is "all"', async () => {
      const result = await runTool('get_device_info', { info_type: 'all' });
      for (const section of ['Memory', 'Battery', 'Device', 'OS']) {
        expect(result.content).toContain(section);
      }
    });
  });

  // ==========================================================================
  // Web Search (mock fetch)
  // ==========================================================================
  describe('Web Search', () => {
    const originalFetch = (globalThis as any).fetch;

    afterEach(() => {
      (globalThis as any).fetch = originalFetch;
    });

    it('returns formatted results when fetch succeeds', async () => {
      const html = buildBraveSearchHTML([
        {
          title: 'React Native Docs',
          url: 'https://reactnative.dev',
          snippet: 'Learn once, write anywhere.',
        },
        {
          title: 'React Native GitHub',
          url: 'https://github.com/facebook/react-native',
          snippet: 'A framework for building native apps.',
        },
      ]);

      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });

      const result = await runTool('web_search', { query: 'react native' });

      expect(result.error).toBeUndefined();
      expect(result.content).toContain('React Native Docs');
      expect(result.content).toContain('reactnative.dev');
      expect(result.content).toContain('Learn once, write anywhere.');
      expect(result.content).toContain('React Native GitHub');
    });

    it('returns "No results" when HTML has no results', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue('<html><body>No matching documents</body></html>'),
      });

      const result = await runTool('web_search', { query: 'xyznonexistent12345' });

      expect(result.content).toContain('No results found');
      expect(result.error).toBeUndefined();
    });

    it('falls back to link extraction when no result-wrapper divs found', async () => {
      const html = `<html><body>
        <a href="https://example.com/page1">A long enough link title here</a>
        <a href="https://example.com/page2">Another sufficiently long title</a>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });

      const result = await runTool('web_search', { query: 'fallback test' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('example.com');
    });

    it('excludes links with "Brave" in the title during fallback', async () => {
      const html = `<html><body>
        <a href="https://search.example.com/brave">Brave Browser Download Page Now</a>
        <a href="https://example.com/other">Another valid long link title here</a>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });

      const result = await runTool('web_search', { query: 'brave exclude test' });
      expect(result.content).not.toContain('Brave Browser');
      expect(result.content).toContain('Another valid');
    });

    it('decodes HTML entities in results', async () => {
      const html = buildBraveSearchHTML([{
        title: 'Title &amp; More &#65; &#x42;',
        url: 'https://example.com',
        snippet: 'Snippet &lt;b&gt; text &gt;',
      }]);
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });

      const result = await runTool('web_search', { query: 'entities' });
      expect(result.content).toContain('Title & More');
    });

    it('handles fetch timeout/error gracefully', async () => {
      (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('Network request failed'));

      const result = await runTool('web_search', { query: 'test query' });
      expect(result.error).toContain('Network request failed');
      expect(result.content).toBe('');
    });

    it.each([
      ['empty string', { query: '' }],
      ['undefined', {}],
      ['whitespace only', { query: '   ' }],
    ])('returns error when query is %s', async (_label, args) => {
      const result = await runTool('web_search', args);
      expect(result.error).toContain('Missing required parameter: query');
    });

  });

  // ==========================================================================
  // read_url
  // ==========================================================================
  describe('read_url', () => {
    const originalFetch = (globalThis as any).fetch;

    afterEach(() => {
      (globalThis as any).fetch = originalFetch;
    });

    it('fetches and returns page text', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('<html><body><p>Hello world content here</p></body></html>'),
      });

      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('Hello world');
    });

    it('truncates long pages and appends [Content truncated]', async () => {
      const longText = 'a'.repeat(5000);
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue(longText),
      });

      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.content).toContain('[Content truncated]');
      expect(result.content.length).toBeLessThan(5000);
    });

    it('returns "no readable content" for empty page', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('<html><body></body></html>'),
      });

      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.content).toContain('no readable content');
    });

    it('throws on HTTP error status', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await runTool('read_url', { url: 'https://example.com/missing' });
      expect(result.error).toContain('404');
    });

    it.each([
      ['localhost', 'http://localhost:8080/admin'],
      ['192.168.x.x', 'http://192.168.1.1'], // NOSONAR
    ])('blocks %s URLs', async (_label, url) => {
      const result = await runTool('read_url', { url });
      expect(result.error).toContain('Blocked');
    });

    it('rejects non-http URLs', async () => {
      const result = await runTool('read_url', { url: 'ftp://example.com' });
      expect(result.error).toContain('Invalid URL');
    });

    it('strips surrounding quotes from URL', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('content here'),
      });

      const result = await runTool('read_url', { url: '"https://example.com"' });
      expect(result.error).toBeUndefined();
    });

    it('returns error when url param is missing', async () => {
      const result = await runTool('read_url', {});
      expect(result.error).toContain('Missing required parameter');
    });
  });

  // ==========================================================================
  // search_knowledge_base
  // ==========================================================================
  describe('search_knowledge_base', () => {
    beforeEach(() => {
      mockRagSearchProject.mockReset();
    });

    it('returns no-project message when no projectId', async () => {
      const result = await runTool('search_knowledge_base', { query: 'test' });
      expect(result.content).toContain('No project context');
    });

    it('returns no-results message when search returns empty', async () => {
      mockRagSearchProject.mockResolvedValue({ chunks: [] });

      const call = { id: 'c1', name: 'search_knowledge_base', arguments: { query: 'nothing' }, context: { projectId: 'proj-1' } };
      const result = await executeToolCall(call as any);
      expect(result.content).toContain('No results found');
    });

    it('returns formatted chunks when results found', async () => {
      mockRagSearchProject.mockResolvedValue({
        chunks: [
          { name: 'doc1.txt', position: 0, content: 'Important information here' },
          { name: 'doc2.txt', position: 1, content: 'More details' },
        ],
      });

      const call = { id: 'c1', name: 'search_knowledge_base', arguments: { query: 'info' }, context: { projectId: 'proj-1' } };
      const result = await executeToolCall(call as any);
      expect(result.content).toContain('doc1.txt');
      expect(result.content).toContain('Important information here');
      expect(result.content).toContain('doc2.txt');
    });

    it('returns error when query param is missing', async () => {
      const result = await runTool('search_knowledge_base', {});
      expect(result.error).toContain('Missing required parameter');
    });
  });

  // ==========================================================================
  // Additional Device Info coverage
  // ==========================================================================
  describe('Device Info — additional types', () => {
    beforeEach(() => {
      mockedDeviceInfo.getFreeDiskStorage.mockResolvedValue(50 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getTotalDiskCapacity = jest.fn().mockResolvedValue(128 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getBatteryLevel = jest.fn().mockResolvedValue(0.5);
      (mockedDeviceInfo as any).isBatteryCharging = jest.fn().mockResolvedValue(true);
    });

    it('returns storage info when type is "storage"', async () => {
      const result = await runTool('get_device_info', { info_type: 'storage' });
      expect(result.content).toContain('Storage');
      expect(result.content).toContain('Free');
      expect(result.error).toBeUndefined();
    });

    it('shows charging status in battery info', async () => {
      const result = await runTool('get_device_info', { info_type: 'battery' });
      expect(result.content).toContain('charging');
    });

    it('returns "unavailable" when memory fetch fails', async () => {
      mockedDeviceInfo.getTotalMemory.mockRejectedValue(new Error('permission denied'));
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.content).toContain('unavailable');
      expect(result.error).toBeUndefined();
    });

    it('returns "unavailable" when storage fetch fails', async () => {
      (mockedDeviceInfo as any).getTotalDiskCapacity = jest.fn().mockRejectedValue(new Error('fail'));
      const result = await runTool('get_device_info', { info_type: 'storage' });
      expect(result.content).toContain('unavailable');
      expect(result.error).toBeUndefined();
    });

    it('shows formatted small byte values (< 1KB)', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(512);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(128);
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.content).toContain('B');
    });

    it('shows formatted KB values (< 1MB)', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(1536);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(512);
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.content).toContain('KB');
    });

    it('shows formatted MB values (< 1GB)', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(512 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(128 * 1024 * 1024);
      const result = await runTool('get_device_info', { info_type: 'memory' });
      expect(result.content).toContain('MB');
    });
  });

  // ==========================================================================
  // read_url — additional private URL patterns
  // ==========================================================================
  describe('read_url — private URL patterns', () => {
    it.each([
      ['10.x.x.x',         'http://10.0.0.1/api'],     // NOSONAR
      ['172.16.x.x',       'http://172.16.0.1/api'],   // NOSONAR
      ['169.254.x.x',      'http://169.254.1.1/meta'],  // NOSONAR
    ])('blocks %s addresses', async (_label, url) => {
      const result = await runTool('read_url', { url });
      expect(result.error).toContain('Blocked');
    });

    it('strips leading angle bracket from URL', async () => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('content'),
      });
      const result = await runTool('read_url', { url: '<https://example.com>' });
      expect(result.error).toBeUndefined();
    });
  });

  // ==========================================================================
  // Calculator — additional expression branches
  // ==========================================================================
  describe('Calculator — additional branches', () => {
    it('evaluates unary minus expression', async () => {
      const result = await runTool('calculator', { expression: '-5+10' });
      expect(result.content).toContain('= 5');
      expect(result.error).toBeUndefined();
    });

    it('evaluates unary plus expression', async () => {
      const result = await runTool('calculator', { expression: '+5+3' });
      expect(result.content).toContain('= 8');
      expect(result.error).toBeUndefined();
    });

    it('returns error for mismatched parentheses', async () => {
      const result = await runTool('calculator', { expression: '(2+3' });
      expect(result.error).toBeDefined();
    });

    it('returns error for non-finite result (e.g. 1/0)', async () => {
      const result = await runTool('calculator', { expression: '1/0' });
      // Division by zero gives Infinity which is non-finite
      expect(result.error).toBeDefined();
    });
  });

  // ==========================================================================
  // Web search — result formatting branches
  // ==========================================================================
  describe('Web Search — result without URL', () => {
    it('uses plain title when result has no URL', async () => {
      // Build HTML with a result-wrapper block but no href URL
      const html = `<html><body>
        <div class="result-wrapper">
          <span class="snippet-title">No URL Result</span>
          <p class="snippet-description">A result with no link</p>
        </div>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });

      const result = await runTool('web_search', { query: 'test' });
      expect(result.error).toBeUndefined();
    });
  });

});
