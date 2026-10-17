/**
 * A knowledge-base search reads each passage's vector from that passage's own bytes, before and after
 * a relaunch (944555dc0, 040867359: a BLOB can be a view into a larger, pooled buffer; decoding the
 * whole buffer gives a passage its neighbour's vector).
 *
 * Product-correct outcome (the person's view): a project has two PDFs, one about an orchard (A) and one
 * about a lighthouse (B). They ask a question about B in words B does not use, so only the meaning of
 * the passages can find it. The answer cites B, and its citation opens B. After the app restarts, the
 * same question in a new chat of the project again cites B, never A.
 *
 * Entry point: the REAL App, twice. Every step is a gesture: pick the model, create the project, add
 * both PDFs to its knowledge base, start a chat, ask, tap the citation; quit; start the app again over
 * the same disk and databases, open the project, start a chat, ask, tap the citation.
 *
 * Fakes (device boundary only, harness/knowledgeBaseApp + documentEngine): llama.rn (the chat model
 * calls search_knowledge_base, then answers citing [S1]; the embedding model answers by meaning, topic
 * by topic), the native PDF reader, op-sqlite (a real SQLite kept in files, so the relaunch reads what
 * the first run wrote), the in-memory disk (carried across the relaunch), the RAM sensor and the
 * document picker. The BLOB shape is the axis: each BLOB its own ArrayBuffer (op-sqlite 15.2.5,
 * cpp/utils.cpp builds a fresh ArrayBuffer per value) and Uint8Array views into one pooled buffer.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchProjectChatApp } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
jest.setTimeout(90000);

const PROJECT = 'Coast trip';
const ORCHARD = { path: '/docs/Downloads/orchard-notes.pdf', name: 'orchard-notes.pdf', pages: 1 };
const LIGHTHOUSE = { path: '/docs/Downloads/lighthouse-log.pdf', name: 'lighthouse-log.pdf', pages: 1 };
const ORCHARD_TEXT = 'The orchard apple harvest starts in September and the fruit is pressed for cider.';
const LIGHTHOUSE_TEXT = 'The lighthouse keeper shares the lamp room with a ginger cat called Pickles.';
/** What the embedding model treats as one meaning. The question below shares no word with either PDF. */
const TOPICS = [
  ['orchard', 'apple', 'harvest', 'fruit', 'cider', 'trees'],
  ['lighthouse', 'beacon', 'keeper', 'lamp', 'cat', 'animal', 'pet'],
];
const QUESTION = 'Which animal lives at the beacon?';
const ANSWER = 'A ginger cat called Pickles lives there [S1].';

/** The model searches the knowledge base with the question, then answers citing the first passage. */
const turns = () => [
  {
    text: '',
    toolCalls: [{
      id: 'call_kb_0',
      type: 'function',
      function: { name: 'search_knowledge_base', arguments: JSON.stringify({ query: QUESTION }) },
    }] as never,
  },
  { text: ANSWER },
];

describe.each([
  ['each BLOB is its own ArrayBuffer', false],
  ['BLOBs are views into one pooled buffer', true],
])('knowledge search by meaning across a relaunch, %s', (_shape, pooledBlobs) => {
  let databases: string;
  beforeEach(() => {
    databases = mkdtempSync(join(tmpdir(), 'offgrid-kb-'));
  });
  afterEach(() => {
    rmSync(databases, { recursive: true, force: true });
  });

  it('cites the lighthouse PDF, not the orchard PDF, before and after the app restarts', async () => {
    const options = { sqlite: { persistAt: databases, pooledBlobs }, topics: TOPICS };

    /** Ask the question; the citation opens the PDF it came from. Returns the name shown on top. */
    const askAndOpenCitation = async (app: Awaited<ReturnType<typeof launchProjectChatApp>>) => {
      const { view, rtl } = app;
      expect(view.queryAllByRole('link')).toHaveLength(0);
      await app.ask(QUESTION, /ginger cat called Pickles/, turns());
      const citation = await rtl.waitFor(() => view.getByRole('link', { name: 'p. 1' }), { timeout: 8000 });
      expect(view.queryAllByText(/\[S1\]/)).toHaveLength(0);
      rtl.fireEvent.press(citation);
      const page = await rtl.waitFor(() => view.getByTestId('document-preview-page-1'), { timeout: 8000 });
      return { page, view, rtl };
    };

    // First run: two PDFs in the project's knowledge base, then the question.
    const first = await launchProjectChatApp(options);
    first.engine.seedPdf(ORCHARD.path, [ORCHARD_TEXT]);
    first.engine.seedPdf(LIGHTHOUSE.path, [LIGHTHOUSE_TEXT]);
    await first.chooseModel();
    await first.createProject(PROJECT);
    await first.addKnowledge([ORCHARD, LIGHTHOUSE]);
    await first.newProjectChat();
    {
      const { page, view, rtl } = await askAndOpenCitation(first);
      expect(view.getByText(LIGHTHOUSE.name)).toBeTruthy();
      expect(rtl.within(page).getByText(LIGHTHOUSE_TEXT)).toBeTruthy();
      expect(view.queryByText(ORCHARD.name)).toBeNull();
    }
    const disk = await first.close();

    // Relaunch: a fresh app over the same disk, databases and saved settings. Nothing is seeded again.
    const next = await launchProjectChatApp({ ...options, relaunchFrom: disk });
    await next.openProject(PROJECT);
    expect(next.view.getByText(ORCHARD.name)).toBeTruthy();
    expect(next.view.getByText(LIGHTHOUSE.name)).toBeTruthy();
    await next.newProjectChat();
    {
      const { page, view, rtl } = await askAndOpenCitation(next);
      expect(view.getByText(LIGHTHOUSE.name)).toBeTruthy();
      expect(rtl.within(page).getByText(LIGHTHOUSE_TEXT)).toBeTruthy();
      expect(view.queryByText(ORCHARD.name)).toBeNull();
    }
    await next.close();
  });
});
