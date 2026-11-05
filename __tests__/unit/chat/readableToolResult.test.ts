/**
 * A search tool's JSON result reads as a short list of sources, not raw JSON (hand test 4: the step
 * opened to `{"search_id": …, "results": [{"excerpts": ["…\n…"]}]}`).
 */
import { readableToolResult } from '../../../src/components/ChatMessage/components/ToolMessages';

describe('readableToolResult', () => {
  it('turns a search JSON into titled, linked sources with a short excerpt', () => {
    const json = JSON.stringify({
      search_id: 'search_1',
      results: [{ url: 'https://weather.example/delhi', title: 'Weather for New Delhi', excerpts: ['Observed: Haze,\n82F. Feels like 83F.'] }],
    });
    expect(readableToolResult(json)).toBe('1. [Weather for New Delhi](https://weather.example/delhi)\n   Observed: Haze, 82F. Feels like 83F.');
  });

  it('keeps plain text as it came', () => {
    expect(readableToolResult('1. [A](https://a)\n   b')).toBe('1. [A](https://a)\n   b');
  });

  it('lays out other JSON with line breaks', () => {
    expect(readableToolResult('{"temp":82}')).toBe('{\n  "temp": 82\n}');
  });
});
