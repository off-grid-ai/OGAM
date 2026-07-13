import {
  trimToolForSmallModel,
  truncateDescription,
  pruneToolNoise,
  SMALL_MODEL_TOOL_BUDGET,
} from '@offgrid/pro/mcp/schemaTrim';
import type { McpTool } from '@offgrid/pro/mcp/types';

// No mocks: schemaTrim is pure JSON-schema transformation. Every assertion drives
// the real implementation and checks the observable output shape/size.

const serializedSize = (tool: McpTool): number =>
  JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.inputSchema }).length;

const bigNotionTool = {
  name: 'notion-search',
  description: "Search the user's Notion workspace and connected sources. ".repeat(20),
  inputSchema: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, description: 'Semantic search query. '.repeat(20) },
      query_type: { type: 'string', enum: ['internal', 'user'] },
      filters: {
        type: 'object',
        properties: {
          created_date_range: {
            type: 'object',
            properties: {
              start_date: {
                type: 'string',
                format: 'date',
                pattern: '^\\d{4}-\\d\\d-\\d\\d$',
                description: 'x'.repeat(300),
              },
            },
            additionalProperties: {},
          },
        },
        additionalProperties: {},
      },
      teamspace_id: { type: 'string', description: 'y'.repeat(300) },
      page_url: { type: 'string', description: 'z'.repeat(300) },
    },
    required: ['query'],
    additionalProperties: {},
  },
} as unknown as McpTool;

describe('SMALL_MODEL_TOOL_BUDGET', () => {
  it('is the documented default cap', () => {
    expect(SMALL_MODEL_TOOL_BUDGET).toBe(800);
  });
});

describe('truncateDescription', () => {
  it('returns empty string for empty/falsy input (early return branch)', () => {
    expect(truncateDescription('')).toBe('');
    // @ts-expect-error exercising the falsy guard with a non-string
    expect(truncateDescription(undefined)).toBe('');
  });

  it('trims but keeps text at or under the cap unchanged', () => {
    expect(truncateDescription('  Short desc.  ')).toBe('Short desc.');
    const exactly160 = 'a'.repeat(160);
    expect(truncateDescription(exactly160)).toBe(exactly160);
  });

  it('keeps a short multi-sentence string unchanged (under the cap, early return wins)', () => {
    // Under 160 chars -> the length guard returns it verbatim; sentence-splitting never runs.
    const short = 'First sentence here. Then a bit more.';
    expect(truncateDescription(short)).toBe(short);
  });

  it('cuts an OVER-cap multi-sentence string to its first sentence', () => {
    // First sentence is short; the trailing filler pushes the whole string over 160,
    // so the sentence-splitting path runs and keeps only the first sentence + terminator.
    const desc = `First sentence here. ${  'trailing filler words that keep going and going '.repeat(6)}`;
    expect(desc.length).toBeGreaterThan(160);
    expect(truncateDescription(desc)).toBe('First sentence here.');
  });

  it('handles ! and ? as sentence terminators (only when over the cap)', () => {
    const bang = `Do it now! ${  'more explanatory text that keeps the sentence going for a while '.repeat(4)}`;
    expect(bang.length).toBeGreaterThan(160);
    expect(truncateDescription(bang)).toBe('Do it now!');

    const q = `Really? ${  'here is a great deal of follow up text that runs on well past the cap '.repeat(4)}`;
    expect(q.length).toBeGreaterThan(160);
    expect(truncateDescription(q)).toBe('Really?');
  });

  it('hard char-caps when the first sentence itself exceeds the cap (no early terminator)', () => {
    const long = 'x'.repeat(500);
    const out = truncateDescription(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out).toBe('x'.repeat(160));
  });

  it('hard char-caps when the first sentence ends AFTER the cap', () => {
    // First terminator sits past 160 chars, so firstSentence > MAX -> fall back to raw slice.
    const long = `${'x'.repeat(300)  }. tail`;
    const out = truncateDescription(long);
    expect(out.length).toBe(160);
  });

  it('treats a terminator with no following whitespace at end-of-string as a sentence end', () => {
    expect(truncateDescription('One sentence only.')).toBe('One sentence only.');
  });

  it('does NOT split on a period that is not followed by whitespace or end (e.g. a decimal)', () => {
    // "3.5" has no whitespace after the dot, so it is not a sentence boundary; whole short string kept.
    expect(truncateDescription('Version 3.5 is fine')).toBe('Version 3.5 is fine');
  });
});

describe('trimToolForSmallModel — compact tools pass through', () => {
  it('returns the SAME object reference (identity) for a tool already under budget', () => {
    const small: McpTool = {
      name: 'echo',
      description: 'Echo text back',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    };
    // Under-budget branch returns the input unchanged (no copy, no mutation).
    expect(trimToolForSmallModel(small)).toBe(small);
  });

  it('respects a custom budget: a tool over the small budget can still be under a larger one', () => {
    const before = serializedSize(bigNotionTool);
    // With a budget bigger than the tool, it passes through untouched.
    expect(trimToolForSmallModel(bigNotionTool, before + 1)).toBe(bigNotionTool);
  });
});

describe('trimToolForSmallModel — oversized with required params (keepRequiredOnly path)', () => {
  it('reduces a bloated tool to required params only and under budget', () => {
    const trimmed = trimToolForSmallModel(bigNotionTool);
    expect(serializedSize(trimmed)).toBeLessThanOrEqual(SMALL_MODEL_TOOL_BUDGET);
    // Only the required param survives.
    expect(Object.keys(trimmed.inputSchema.properties ?? {})).toEqual(['query']);
    expect(trimmed.inputSchema.required).toEqual(['query']);
    // Optional params are gone entirely.
    expect(trimmed.inputSchema.properties?.query_type).toBeUndefined();
    expect((trimmed.inputSchema.properties as Record<string, unknown>)?.filters).toBeUndefined();
    expect((trimmed.inputSchema.properties as Record<string, unknown>)?.teamspace_id).toBeUndefined();
  });

  it('strips all aggressive noise + structural keys (small model can not follow refs)', () => {
    const json = JSON.stringify(trimToolForSmallModel(bigNotionTool).inputSchema);
    expect(json).not.toContain('$schema');
    expect(json).not.toContain('pattern');
    expect(json).not.toContain('additionalProperties');
    expect(json).not.toContain('minLength');
    expect(json).not.toContain('format');
  });

  it('truncates the bloated description', () => {
    expect(trimToolForSmallModel(bigNotionTool).description.length).toBeLessThanOrEqual(160);
  });

  it('does NOT mutate the input tool (purity)', () => {
    const before = JSON.stringify(bigNotionTool);
    trimToolForSmallModel(bigNotionTool);
    expect(JSON.stringify(bigNotionTool)).toBe(before);
  });

  it('drops a required key whose property is missing rather than inventing undefined', () => {
    const tool = {
      name: 'ghost-required',
      description: 'd'.repeat(50),
      inputSchema: {
        type: 'object',
        properties: {
          real: { type: 'string', description: 'q'.repeat(900) },
        },
        // "phantom" is required but has no property definition.
        required: ['real', 'phantom'],
      },
    } as unknown as McpTool;
    const trimmed = trimToolForSmallModel(tool);
    // keepRequiredOnly copies only keys that exist in properties.
    expect(Object.keys(trimmed.inputSchema.properties ?? {})).toEqual(['real']);
    // required list itself is preserved as-declared.
    expect(trimmed.inputSchema.required).toEqual(['real', 'phantom']);
  });

  it('drops $ref/$defs only in the aggressive on-device trim (forced with a tiny budget)', () => {
    const refTool = {
      name: 'ref-tool',
      description: 'Uses a $ref',
      inputSchema: {
        type: 'object',
        properties: { item: { $ref: '#/$defs/Item' } },
        $defs: { Item: { type: 'object', properties: { id: { type: 'string' } } } },
        required: ['item'],
      },
    } as unknown as McpTool;
    const aggressive = JSON.stringify(trimToolForSmallModel(refTool, 10).inputSchema);
    expect(aggressive).not.toContain('$ref');
    expect(aggressive).not.toContain('$defs');
  });
});

describe('trimToolForSmallModel — oversized with NO required params (dropOptionalToBudget path)', () => {
  it('budget-trims (keeps some optional params) rather than emptying properties', () => {
    const allOptional = {
      name: 'all-optional',
      description: 'x'.repeat(50),
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'string', description: 'y'.repeat(400) },
          b: { type: 'string', description: 'z'.repeat(400) },
        },
      },
    } as unknown as McpTool;
    const trimmed = trimToolForSmallModel(allOptional);
    expect(Object.keys(trimmed.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
    expect(serializedSize(trimmed)).toBeLessThanOrEqual(SMALL_MODEL_TOOL_BUDGET);
  });

  it('drops the LARGEST optional param first, keeping a small one that fits', () => {
    // Enums are PRESERVED (not noise), so a huge enum list survives pruning and stays
    // the biggest optional — it must be the one dropped, while the cheap param survives.
    const hugeEnum = Array.from({ length: 120 }, (_, i) => `value_option_number_${i}`);
    const tool = {
      name: 'sized',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: {
          huge: { type: 'string', enum: hugeEnum },
          tiny: { type: 'string' },
        },
      },
    } as unknown as McpTool;
    // Sanity: the tool really is over budget so the drop loop must run.
    expect(serializedSize(tool)).toBeGreaterThan(SMALL_MODEL_TOOL_BUDGET);
    const trimmed = trimToolForSmallModel(tool);
    // The oversized "huge" is removed; the cheap "tiny" survives.
    expect((trimmed.inputSchema.properties as Record<string, unknown>)?.huge).toBeUndefined();
    expect((trimmed.inputSchema.properties as Record<string, unknown>)?.tiny).toBeDefined();
    expect(serializedSize(trimmed)).toBeLessThanOrEqual(SMALL_MODEL_TOOL_BUDGET);
  });

  it('keeps optional params it does not need to drop once already under budget (break branch)', () => {
    // Two moderate optionals: after aggressive-noise prune + description truncation the tool
    // may already fit, so the drop loop should break WITHOUT deleting either param.
    const tool = {
      name: 'moderate',
      description: 'short',
      inputSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          a: { type: 'string', pattern: 'p'.repeat(500), format: 'q'.repeat(500) },
          b: { type: 'string', minLength: 1 },
        },
      },
    } as unknown as McpTool;
    const trimmed = trimToolForSmallModel(tool);
    const keys = Object.keys(trimmed.inputSchema.properties ?? {});
    // Noise stripping alone brought it under budget, so BOTH optionals stay.
    expect(keys).toEqual(expect.arrayContaining(['a', 'b']));
    expect(serializedSize(trimmed)).toBeLessThanOrEqual(SMALL_MODEL_TOOL_BUDGET);
  });

  it('treats a non-array `required` as no required params (falls to budget trim)', () => {
    // `required` present but malformed (not an array) -> pruned.required is [], so the
    // trim takes the dropOptionalToBudget branch and normalizes required to [] internally.
    const tool = {
      name: 'bad-required',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: {
          a: { type: 'string', enum: Array.from({ length: 120 }, (_, i) => `opt_${i}`) },
          b: { type: 'string' },
        },
        required: 'query', // malformed: a string, not an array
      },
    } as unknown as McpTool;
    expect(serializedSize(tool)).toBeGreaterThan(SMALL_MODEL_TOOL_BUDGET);
    const trimmed = trimToolForSmallModel(tool);
    // Budget trim kept the small optional and dropped the big one; never emptied everything.
    expect(Object.keys(trimmed.inputSchema.properties ?? {}).length).toBeGreaterThan(0);
    expect(serializedSize(trimmed)).toBeLessThanOrEqual(SMALL_MODEL_TOOL_BUDGET);
  });

  it('returns schema untouched by drop when it has no properties object', () => {
    // Oversized purely by description, schema has no `properties`, empty required.
    const tool = {
      name: 'no-props',
      description: 'D'.repeat(2000),
      inputSchema: { type: 'object' },
    } as unknown as McpTool;
    const trimmed = trimToolForSmallModel(tool);
    // dropOptionalToBudget early-returns the schema unchanged (no properties to drop).
    expect(trimmed.inputSchema).toEqual({ type: 'object' });
    // Description still truncated by the trim itself.
    expect(trimmed.description.length).toBeLessThanOrEqual(160);
  });
});

describe('pruneToolNoise — grammar-safe for ANY backend', () => {
  it('strips the grammar-breaking annotation keywords', () => {
    const json = JSON.stringify(pruneToolNoise(bigNotionTool).inputSchema);
    expect(json).not.toContain('$schema');
    expect(json).not.toContain('additionalProperties');
    expect(json).not.toContain('pattern');
    expect(json).not.toContain('format');
    expect(json).not.toContain('minLength');
  });

  it('KEEPS every param (including optionals) and preserves enums + nesting', () => {
    const pruned = pruneToolNoise(bigNotionTool);
    const keys = Object.keys(pruned.inputSchema.properties ?? {});
    expect(keys).toEqual(expect.arrayContaining(['query', 'query_type', 'filters', 'teamspace_id', 'page_url']));
    expect(pruned.inputSchema.required).toEqual(['query']);
    expect(pruned.inputSchema.properties?.query_type).toEqual({ type: 'string', enum: ['internal', 'user'] });
  });

  it('truncates the bloated description', () => {
    expect(pruneToolNoise(bigNotionTool).description.length).toBeLessThanOrEqual(160);
  });

  it('PRESERVES $ref/$defs (structural, not noise) so referenced schemas stay valid', () => {
    const refTool = {
      name: 'ref-tool',
      description: 'Uses a $ref',
      inputSchema: {
        type: 'object',
        properties: { item: { $ref: '#/$defs/Item' } },
        $defs: { Item: { type: 'object', properties: { id: { type: 'string' } } } },
        required: ['item'],
      },
    } as unknown as McpTool;
    const json = JSON.stringify(pruneToolNoise(refTool).inputSchema);
    expect(json).toContain('$ref');
    expect(json).toContain('$defs');
  });

  it('recurses into arrays, pruning noise inside array elements (array branch of pruneNode)', () => {
    const tool = {
      name: 'array-tool',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            // anyOf is an array of subschemas; each carries noise that must be stripped.
            anyOf: [
              { type: 'string', pattern: 'abc', minLength: 2 },
              { type: 'number', minimum: 0 },
            ],
          },
        },
      },
    } as unknown as McpTool;
    const json = JSON.stringify(pruneToolNoise(tool).inputSchema);
    expect(json).not.toContain('pattern');
    expect(json).not.toContain('minLength');
    expect(json).not.toContain('minimum');
    // Real structure inside the array subschemas is kept.
    expect(json).toContain('"type":"number"');
    expect(json).toContain('"type":"string"');
  });

  it('does NOT mutate the input (purity)', () => {
    const before = JSON.stringify(bigNotionTool);
    pruneToolNoise(bigNotionTool);
    expect(JSON.stringify(bigNotionTool)).toBe(before);
  });
});

describe('pruneNode primitive/leaf handling (via public API)', () => {
  it('leaves primitive property values and enum arrays untouched', () => {
    const tool = {
      name: 'prims',
      description: 'd',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['a', 'b'] },
          count: { type: 'integer' },
        },
        required: ['mode'],
      },
    } as unknown as McpTool;
    const pruned = pruneToolNoise(tool);
    expect(pruned.inputSchema.properties?.mode).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect((pruned.inputSchema.properties as Record<string, unknown>)?.count).toEqual({ type: 'integer' });
  });
});
