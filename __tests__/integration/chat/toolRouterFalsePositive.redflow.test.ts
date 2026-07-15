/**
 * RED-FLOW (integration) — Q4: the on-device tool router force-selects a tool whose NAME merely appears
 * as a substring of the router model's prose, and the "none" branch never runs when a name is present.
 *
 * Drives the REAL selectRelevantTools (litertToolSelector) — the only faked boundary is the model text
 * (the `generate` callback), i.e. what the router LLM would say. This is the router's real substring
 * logic (litertToolSelector.ts:55-62): `raw.includes(name)` selects on any mention, and
 * `selected.length > 0` returns BEFORE the `'none'` check — so a decline that names the tool selects it.
 *
 * DOCUMENTED EXCEPTION to the UI-driven standard: this bug lives in a PURE FUNCTION (selectRelevantTools,
 * a router/parser). The hygiene standard tests pure functions at the unit layer underneath, and driving it
 * through ChatScreen does NOT faithfully reproduce it — the on-device routing path only runs under specific
 * conditions (MCP enabled + tool count over TOOL_SELECTION_THRESHOLD); through the real ChatScreen with a
 * default tool set the router returns all tools without invoking this substring path, so a "rendered"
 * variant would assert a code path it never actually exercises. So the FUNCTION is the faithful surface.
 * (A prior render-only variant was removed for exactly this reason — it could not honestly drive the bug.)
 */
import { selectRelevantTools } from '../../../src/services/litertToolSelector';

const TOOLS = [
  { type: 'function', function: { name: 'calculator', description: 'Evaluate a math expression' } },
  { type: 'function', function: { name: 'web_search', description: 'Search the web' } },
] as never[];

describe('Q4 — tool router false-positive (red-flow)', () => {
  it('selects NO tool when the router declines but happens to name one', async () => {
    // The router model declines ("none") yet mentions "calculator" in its prose.
    const generate = async () => 'None of these tools apply — the calculator is not needed for a greeting.';
    const selected = await selectRelevantTools('hello there', TOOLS, generate);

    // Correct: the router said none → []. Today the substring match on "calculator" wins (and short-
    // circuits before the 'none' branch) → ['calculator'] → RED.
    expect(selected).toEqual([]);
  });

  it('control: when the router names ONLY the tool it wants, that tool is selected', async () => {
    const generate = async () => 'Use web_search to answer this.';
    const selected = await selectRelevantTools('what is the weather in Paris', TOOLS, generate);
    expect(selected).toEqual(['web_search']);
  });
});
