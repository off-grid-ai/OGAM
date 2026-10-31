/**
 * toolEmbeddingRouter — picks the tools a turn offers the model by embedding the question and each tool
 * on the on-device MiniLM model, and keeps tool vectors on disk so a relaunch does not re-embed them.
 *
 * Real: the router, embeddingService (bundled model copy, load through the residency lock, vector checks),
 * the documents store, AsyncStorage persistence. Faked (device): llama.rn's embedding context, which answers
 * by meaning over a few topics, react-native-fs and SQLite (harness/embeddingDevice).
 */
import { launchEmbeddingDevice, type EmbeddingDevice } from '../../harness/embeddingDevice';

const CACHE_KEY = 'tool-embedding-cache-v1';

const tool = (name: string, description: string) => ({ function: { name, description } });

// 12 tools, so routing runs (topK 4 < 12).
const TOOLS = [
  tool('notion-search', 'Search pages in your Notion workspace'),
  tool('notion-fetch', 'Read a Notion page'),
  tool('notion-update-page', 'Change a Notion page'),
  tool('notion-get-users', 'List the people in a Notion workspace'),
  tool('calendar-events', 'Show events on your calendar'),
  tool('calendar-create', 'Add an event to your calendar'),
  tool('mail-inbox', 'Show mail in your inbox'),
  tool('mail-send', 'Send a mail message'),
  tool('weather-forecast', 'The weather forecast for a city'),
  tool('maps-route', 'Directions between two places'),
  tool('github-issues', 'Issues in a GitHub repository'),
  tool('slack-post', 'Post a message in a Slack channel'),
];
const textOf = (t: { function: { name: string; description: string } }) =>
  `${t.function.name}: ${t.function.description}`;

// MiniLM answers by meaning: a text points along the topics whose words it uses.
const TOPICS = [
  ['notion', 'page', 'pages', 'workspace'],
  ['calendar', 'event', 'events'],
  ['mail', 'inbox', 'message'],
  ['weather', 'forecast', 'city'],
  ['maps', 'directions', 'places'],
  ['github', 'issues', 'repository'],
  ['slack', 'channel', 'post'],
];

const QUESTION = 'look at my notion page';

function launch(): { device: EmbeddingDevice; router: typeof import('../../../src/services/toolEmbeddingRouter') } {
  const device = launchEmbeddingDevice({ topics: TOPICS });
  return { device, router: require('../../../src/services/toolEmbeddingRouter') };
}

function storage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
}

/** The router writes its cache a second after the last new vector; wait for that write to land. */
async function persisted(): Promise<Record<string, { h: string; v: number[] }>> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const raw = await storage().getItem(CACHE_KEY);
    if (raw) return JSON.parse(raw);
    if (Date.now() > deadline) throw new Error('the tool embedding cache was never written');
    await new Promise(r => setTimeout(r, 50));
  }
}

describe('toolEmbeddingRouter (F6 — persistent embedding cache)', () => {
  beforeEach(async () => {
    await storage().clear();
  });

  it('on a cold cache embeds the question once and each tool once, and keeps the tools the question is about', async () => {
    const { device, router } = launch();

    const picked = await router.selectToolsByEmbedding(QUESTION, TOOLS, 4);

    expect(device.embedded).toEqual([QUESTION, ...TOOLS.map(textOf)]);
    expect(picked.sort()).toEqual(['notion-fetch', 'notion-get-users', 'notion-search', 'notion-update-page']);
  });

  it('keeps tool vectors across a relaunch, so only the question is embedded again', async () => {
    const first = launch();
    await first.router.selectToolsByEmbedding(QUESTION, TOOLS, 4);
    expect(Object.keys(await persisted()).sort()).toEqual(TOOLS.map(t => t.function.name).sort());

    const { device, router } = launch(); // relaunch: fresh memory, same disk
    expect(device.embedded).toEqual([]);
    const picked = await router.selectToolsByEmbedding(QUESTION, TOOLS, 4);

    expect(device.embedded).toEqual([QUESTION]);
    expect(picked).toHaveLength(4);
  });

  it('re-embeds a tool whose description changed (content-hash keyed)', async () => {
    await launch().router.selectToolsByEmbedding(QUESTION, TOOLS, 4);
    await persisted();

    const { device, router } = launch();
    const changed = [tool('notion-search', 'Look up the weather forecast for a city'), ...TOOLS.slice(1)];
    await router.selectToolsByEmbedding(QUESTION, changed, 4);

    expect(device.embedded).toEqual([QUESTION, textOf(changed[0])]);
  });

  it('drops a stored vector with a NaN on relaunch and embeds that tool again', async () => {
    await launch().router.selectToolsByEmbedding(QUESTION, TOOLS, 4);
    const stored = await persisted();
    // A NaN slips in through stale or garbled storage. Kept, it would poison every cosine score with NaN.
    stored['mail-send'] = { ...stored['mail-send'], v: [Number.NaN, ...stored['mail-send'].v.slice(1)] };
    await storage().setItem(CACHE_KEY, JSON.stringify(stored));

    const { device, router } = launch();
    const picked = await router.selectToolsByEmbedding(QUESTION, TOOLS, 4);

    expect(device.embedded).toEqual([QUESTION, textOf(TOOLS[7])]);
    expect(picked.sort()).toEqual(['notion-fetch', 'notion-get-users', 'notion-search', 'notion-update-page']);
  });

  it('offers every tool and embeds nothing when there are no more tools than topK', async () => {
    const { device, router } = launch();

    expect(await router.selectToolsByEmbedding('x', TOOLS.slice(0, 3), 4))
      .toEqual(['notion-search', 'notion-fetch', 'notion-update-page']);
    expect(device.embedded).toEqual([]);
  });

  it('offers every tool and embeds nothing for a blank question', async () => {
    const { device, router } = launch();

    expect(await router.selectToolsByEmbedding('   ', TOOLS, 4)).toEqual(TOOLS.map(t => t.function.name));
    expect(device.embedded).toEqual([]);
  });
});
