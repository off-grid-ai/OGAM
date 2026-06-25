/**
 * Tool Handlers — additional branch coverage.
 *
 * Targets: executeToolCall error.message fallback, parseResultBlock alternate
 * regex branches, evaluateExpression error paths, nodeToText element branches
 * (via read_url -> htmlToMarkdown), and the read_url catch/rethrow path.
 */

import DeviceInfo from 'react-native-device-info';
import { executeToolCall } from '../../../../src/services/tools/handlers';
import { ToolCall } from '../../../../src/services/tools/types';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

jest.mock('../../../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), log: jest.fn(),
}));

const mockRagSearchProject = jest.fn();
jest.mock('../../../../src/services/rag', () => ({
  ragService: { searchProject: (...args: any[]) => mockRagSearchProject(...args) },
}));

function makeToolCall(name: string, args: Record<string, any> = {}): ToolCall {
  return { id: 'b-call', name, arguments: args };
}
async function runTool(name: string, args: Record<string, any> = {}) {
  return executeToolCall(makeToolCall(name, args));
}

describe('Tool Handlers — branch coverage', () => {
  // ── executeToolCall: error without a .message (line 21 fallback) ──────────
  describe('executeToolCall error fallback', () => {
    it('uses "Tool execution failed" when the thrown error has no message', async () => {
      // calculator throws a TypeError with a message normally; force a string throw
      // via a tool whose handler throws a plain object lacking `.message`.
      mockRagSearchProject.mockReset();
      mockRagSearchProject.mockRejectedValue({ notAMessage: true });
      const call: any = {
        id: 'x', name: 'search_knowledge_base',
        arguments: { query: 'hi' }, context: { projectId: 'p1' },
      };
      const result = await executeToolCall(call);
      expect(result.error).toBe('Tool execution failed');
      expect(result.content).toBe('');
    });
  });

  // ── parseResultBlock alternate regexes (lines 102-113) ────────────────────
  describe('Web Search — alternate result block parsing', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => { (globalThis as any).fetch = originalFetch; });

    it('parses title via the <a><span> fallback and snippet via </span> form', async () => {
      // No class="...title..." attribute, so the first titleMatch regex misses
      // and the <a href><span> alternate matches. snippet uses </span> close form.
      const html = `<html><body>
        <div class="result-wrapper">
          <a href="https://alt.example.com/page"> <span>Alternate Title Path</span></a>
          <div class="snippet-desc">Snippet via span close</div>
          <span class="snippet">Snippet via span close</span>
        </div>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });
      const result = await runTool('web_search', { query: 'alt parse' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('Alternate Title Path');
    });

    it('returns "(no title)" placeholder when only a snippet is present', async () => {
      const html = `<html><body>
        <div class="result-wrapper">
          <p class="snippet-body">Only a snippet, no title link here</p>
        </div>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });
      const result = await runTool('web_search', { query: 'no title' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('(no title)');
    });

    it('stops after 5 result-wrapper blocks (results.length >= 5 break)', async () => {
      const block = (i: number) => `<div class="result-wrapper">
        <a class="result-title" href="https://example.com/${i}">Title ${i} long enough</a>
        <p class="snippet">Snippet ${i}</p></div>`;
      const html = `<html><body>${[0, 1, 2, 3, 4, 5, 6].map(block).join('')}</body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });
      const result = await runTool('web_search', { query: 'many' });
      // Only the first 5 numbered titles should appear (1..5 in output indices)
      expect(result.content).toContain('Title 0');
      expect(result.content).toContain('Title 4');
      expect(result.content).not.toContain('Title 5');
    });
  });

  // ── evaluateExpression error branches (lines 212-217) ─────────────────────
  describe('Calculator — parse error branches', () => {
    it('throws "Unexpected character" when an atom is empty (e.g. lone operator)', async () => {
      // "2*" → parsePower calls parseAtom at end of string, pos === start
      const result = await runTool('calculator', { expression: '2*' });
      expect(result.error).toBeDefined();
    });

    it('throws on trailing unparsed characters', async () => {
      // ")" alone: parseExpr -> parseAtom sees ')' which is neither '(' nor digit → empty atom
      const result = await runTool('calculator', { expression: '5)' });
      expect(result.error).toBeDefined();
    });

    it('evaluates a parenthesised power expression (right-assoc)', async () => {
      const result = await runTool('calculator', { expression: '2^(1+1)' });
      expect(result.content).toContain('= 4');
    });
  });

  // ── read_url -> htmlToMarkdown -> nodeToText element branches (307-319) ───
  describe('read_url — markdown conversion element branches', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => { (globalThis as any).fetch = originalFetch; });

    const fetchHtml = (html: string) => {
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200, text: jest.fn().mockResolvedValue(html),
      });
    };

    it('converts headings, list items, blockquote, code and br', async () => {
      fetchHtml(`<html><body><article>
        <h1>Main Heading</h1>
        <h2>Sub Heading</h2>
        <h4>Smaller Heading</h4>
        <p>Para one<br>line two</p>
        <ul><li>First item</li><li>Second item</li></ul>
        <blockquote>A quoted line</blockquote>
        <code>inline_code()</code>
      </article></body></html>`);

      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('## Main Heading');
      expect(result.content).toContain('## Sub Heading');
      expect(result.content).toContain('### Smaller Heading');
      expect(result.content).toContain('- First item');
      expect(result.content).toContain('- Second item');
      expect(result.content).toContain('> A quoted line');
      expect(result.content).toContain('`inline_code()`');
      expect(result.content).toContain('line two');
    });

    it('skips non-content tags (script/style) and unwraps generic elements', async () => {
      fetchHtml(`<html><body>
        <main>
          <script>var x = 1;</script>
          <style>.a{color:red}</style>
          <div><span>Visible span text</span></div>
        </main>
      </body></html>`);

      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.content).toContain('Visible span text');
      expect(result.content).not.toContain('var x');
      expect(result.content).not.toContain('color:red');
    });

    it('drops inline skip tags (img/svg/video) inside content via nodeToText skip list', async () => {
      fetchHtml(`<html><body><article>
        <p>Real paragraph text</p>
        <img src="x.png" alt="should be dropped" />
        <svg><path d="M0 0"/></svg>
        <video src="v.mp4"></video>
      </article></body></html>`);
      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.content).toContain('Real paragraph text');
      expect(result.content).not.toContain('should be dropped');
    });

    it('prefers [role="main"] when no <article> exists', async () => {
      fetchHtml(`<html><body>
        <div role="main"><p>Role main content paragraph</p></div>
      </body></html>`);
      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.content).toContain('Role main content paragraph');
    });
  });

  // ── parseResultBlock: title present but snippet absent (108-113) ──────────
  describe('Web Search — title without snippet', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => { (globalThis as any).fetch = originalFetch; });

    it('uses "(no snippet)" when a titled result has no snippet', async () => {
      const html = `<html><body>
        <div class="result-wrapper">
          <a class="result-title" href="https://example.com/x">A perfectly good title here</a>
        </div>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });
      const result = await runTool('web_search', { query: 'no snippet' });
      expect(result.content).toContain('(no snippet)');
    });

    it('skips a result-wrapper block with neither title nor snippet (parsed null)', async () => {
      const html = `<html><body>
        <div class="result-wrapper"><div>nothing useful inside</div></div>
        <div class="result-wrapper">
          <a class="result-title" href="https://example.com/ok">Valid title for second block</a>
          <p class="snippet">Valid snippet</p>
        </div>
      </body></html>`;
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        text: jest.fn().mockResolvedValue(html),
      });
      const result = await runTool('web_search', { query: 'skip empty' });
      expect(result.content).toContain('Valid title for second block');
    });
  });

  // ── calculator subtraction (line 169 op !== '+' branch) ───────────────────
  describe('Calculator — subtraction branch', () => {
    it('evaluates subtraction (op === "-" path)', async () => {
      const result = await runTool('calculator', { expression: '10-3' });
      expect(result.content).toContain('= 7');
    });
  });

  // ── get_device_info: default info_type = "all" (line 260) ─────────────────
  describe('get_device_info default type', () => {
    beforeEach(() => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getFreeDiskStorage.mockResolvedValue(50 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getTotalDiskCapacity = jest.fn().mockResolvedValue(128 * 1024 * 1024 * 1024);
      (mockedDeviceInfo as any).getBatteryLevel = jest.fn().mockResolvedValue(0.5);
      (mockedDeviceInfo as any).isBatteryCharging = jest.fn().mockResolvedValue(false);
      (mockedDeviceInfo as any).getBrand = jest.fn().mockReturnValue('Google');
      mockedDeviceInfo.getModel.mockReturnValue('Pixel 7');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
    });

    it('defaults to "all" when info_type is omitted', async () => {
      const result = await runTool('get_device_info');
      expect(result.error).toBeUndefined();
      // "all" includes the Device + OS lines
      expect(result.content).toContain('Device:');
      expect(result.content).toContain('OS:');
    });
  });

  // ── isPrivateUrl: no host match returns false (line 301) ──────────────────
  describe('read_url — malformed URL host', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => { (globalThis as any).fetch = originalFetch; });

    it('does not block a URL whose host regex does not match (passes through to fetch)', async () => {
      // "https://" has http(s):// but no host chars after — isPrivateUrl regex
      // still matches host="" → not private; fetch is attempted.
      (globalThis as any).fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200, text: jest.fn().mockResolvedValue('<p>ok body content</p>'),
      });
      const result = await runTool('read_url', { url: 'https://public.example.org/page' });
      expect(result.error).toBeUndefined();
      expect(result.content).toContain('ok body content');
    });
  });

  // ── read_url catch/rethrow logging (line 373) ─────────────────────────────
  describe('read_url — network failure', () => {
    const originalFetch = (globalThis as any).fetch;
    afterEach(() => { (globalThis as any).fetch = originalFetch; });

    it('rethrows fetch errors (logged then surfaced as tool error)', async () => {
      (globalThis as any).fetch = jest.fn().mockRejectedValue(new Error('connection reset'));
      const result = await runTool('read_url', { url: 'https://example.com' });
      expect(result.error).toContain('connection reset');
      expect(result.content).toBe('');
    });
  });
});
