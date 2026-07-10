/**
 * QA matrix: on-device two-pass tool routing (selectRelevantTools).
 *
 * This is the first pass that decides which MCP/ext tools a small on-device model
 * (litert, or llama on iOS) is handed for the real generation pass. It drives the
 * REAL selector with an injected router-generate fn (the only boundary faked), so
 * a delete/inversion of the routing logic fails these tests.
 *
 * Cells: router names a tool · router says "none" · router reply unreadable ·
 * empty inputs. Each asserts the terminal routing decision (which names survive),
 * which is what the tool loop then prefills.
 */

import { selectRelevantTools } from '../../../src/services/litertToolSelector';

const TOOLS = [
  { function: { name: 'search_web', description: 'search the web' } },
  { function: { name: 'create_calendar_event', description: 'add a calendar event' } },
];

describe('selectRelevantTools routing decision', () => {
  it('router names one tool → only that tool is routed', async () => {
    const gen = async () => 'search_web';
    expect(await selectRelevantTools('look this up', TOOLS, gen)).toEqual(['search_web']);
  });

  it('router names several → all named tools are routed', async () => {
    const gen = async () => 'search_web, create_calendar_event';
    expect(await selectRelevantTools('q', TOOLS, gen)).toEqual(['search_web', 'create_calendar_event']);
  });

  it('router says "none" → empty selection (send no MCP tools)', async () => {
    const gen = async () => 'none';
    expect(await selectRelevantTools('just chat', TOOLS, gen)).toEqual([]);
  });

  it('router reply is unreadable prose naming no known tool → null (caller falls back to all)', async () => {
    const gen = async () => 'I am not sure which to use';
    expect(await selectRelevantTools('q', TOOLS, gen)).toBeNull();
  });

  it('empty tool list → null (nothing to route)', async () => {
    const gen = async () => 'search_web';
    expect(await selectRelevantTools('q', [], gen)).toBeNull();
  });

  it('blank user text → null (no query to route on)', async () => {
    const gen = async () => 'search_web';
    expect(await selectRelevantTools('   ', TOOLS, gen)).toBeNull();
  });
});
