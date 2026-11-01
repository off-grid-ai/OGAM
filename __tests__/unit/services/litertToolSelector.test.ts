/**
 * selectRelevantTools — the LiteRT tool router: a tools-free pass that asks the on-device model which tools
 * a request needs.
 *
 * Real: the router, liteRTService (its throwaway routing session), activeModelService (the model loads
 * through the residency lock), the stores. Faked (device, harness/generationDevice): the LiteRT native
 * module, which answers the routing pass with the scripted reply.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

const tools = [
  { function: { name: 'notion-search', description: 'Search Notion.\nsecond line ignored' } },
  { function: { name: 'web_search', description: 'Search the web' } },
  { function: { name: 'calculator', description: undefined } },
];

let d: GenerationDevice;
let select: (text: string, list: typeof tools) => Promise<string[] | null>;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
  d = await launchGeneration({ engine: 'litert' });
  select = require('../../../src/services/litertToolSelector').selectRelevantTools;
});

/** The native model answers the routing pass with `reply`. */
const routerSays = (reply: string) => d.boundary.litert.scriptTurn({ content: reply });
const routingSends = () => d.boundary.litert.calls.sendMessage.slice(1); // after the load's warmup turn

describe('selectRelevantTools', () => {
  it('returns the one tool the model named', async () => {
    routerSays('notion-search');
    expect(await select('find my notes', tools)).toEqual(['notion-search']);
  });

  it('matches several names, whatever the formatting or case', async () => {
    routerSays('Use: WEB_SEARCH, calculator.');
    expect(await select('weather then add', tools)).toEqual(['web_search', 'calculator']);
  });

  it('returns [] (no tool needed) when the model says "none"', async () => {
    routerSays('none');
    expect(await select('hello', tools)).toEqual([]);
  });

  it('returns null (send every tool) when the reply names no tool and is not "none"', async () => {
    routerSays('I think you should use the thing');
    expect(await select('do something', tools)).toBeNull();
  });

  it('returns null without asking the model for no tools or a blank request', async () => {
    expect(await select('hi', [])).toBeNull();
    expect(await select('   ', tools)).toBeNull();
    expect(routingSends()).toHaveLength(0);
  });

  it('asks on a fresh, tools-free session with a name: description catalog, first lines capped', async () => {
    routerSays('none');
    const longTool = [{ function: { name: 'big', description: 'x'.repeat(300) } }];

    await select('q', longTool as any);

    const [prompt] = routingSends().at(-1) as [string];
    expect(prompt).toContain('big:');
    expect(prompt).toContain('x'.repeat(100));
    expect(prompt).not.toContain('x'.repeat(101)); // the first line is capped at 100 characters
    const reset = d.boundary.litert.calls.resetConversation.at(-1)!;
    expect(reset[4]).toBe(''); // no tools on the routing session
    expect(String(reset[0])).toContain('tool router');
  });
});
