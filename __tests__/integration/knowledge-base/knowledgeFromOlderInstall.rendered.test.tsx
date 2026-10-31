/**
 * A knowledge-base PDF added by an older install is still read after the app is updated on iOS.
 *
 * Seen on the iPhone during release testing (2026-10-28): every knowledge-base row written before files had
 * document ids kept an absolute path into the app container of that day. iOS moves the app to a new
 * container on update, so the path named a folder that no longer existed, although the PDF itself had moved
 * into the current container. The row was never identified, the knowledge base said "Couldn't read", and
 * the project chat answered without the document.
 *
 * Product-correct outcome (the person's view): a project's PDF, added before the update, is still read
 * after it. A question the PDF answers cites the PDF, and the citation opens it at that page.
 *
 * Entry point: the REAL App, twice. First run, by gestures: pick the model, create the project, add the
 * PDF. Between runs the disk is turned into what an older version left on an updated iPhone (device state,
 * not our code): rag.db's row has no document id and its path points into the old container, and the
 * document index (documents.db) is gone, as before ids existed. Second run, by gestures: open the project,
 * start a chat, ask, tap the citation.
 *
 * Fakes (device boundary only, harness/knowledgeBaseApp + documentEngine): llama.rn, the native PDF
 * reader, op-sqlite (a real SQLite kept in files), the in-memory disk carried across the relaunch, the RAM
 * sensor and the document picker.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchProjectChatApp } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
jest.setTimeout(90000);

const PROJECT = 'Epic reading';
const PDF = { path: '/docs/Downloads/iliad-notes.pdf', name: 'iliad-notes.pdf', pages: 1 };
const PDF_TEXT = 'Achilles kills Hector outside the walls of Troy and drags his body behind a chariot.';
const QUESTION = 'Who killed Hector?';
const ANSWER = 'Achilles killed Hector outside the walls of Troy [S1].';
/** The app container an older install used. iOS gives the updated app a new one. */
const OLD_CONTAINER = '/var/mobile/Containers/Data/Application/F2899DBD-0000-4000-8000-000000000000/Documents';

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

/** What an older version left: rows with no document id, paths into its own container, no document index. */
function leaveAsOlderInstallDid(databases: string): void {
  const { DatabaseSync } = require('node:sqlite');
  const rag = new DatabaseSync(join(databases, 'rag.db'));
  const rows = rag.prepare('SELECT id, path FROM rag_documents').all() as Array<{ id: number; path: string }>;
  expect(rows).toHaveLength(1);
  for (const row of rows) {
    const relative = row.path.replace(/^file:\/\//, '').replace(/^\/docs\//, '');
    rag.prepare('UPDATE rag_documents SET document_id = NULL, path = ? WHERE id = ?')
      .run(`file://${OLD_CONTAINER}/${relative}`, row.id);
  }
  rag.close();
  const index = join(databases, 'documents.db');
  if (existsSync(index)) rmSync(index);
}

describe('a knowledge-base PDF from before an iOS update', () => {
  let databases: string;
  beforeEach(() => {
    databases = mkdtempSync(join(tmpdir(), 'offgrid-kb-upgrade-'));
  });
  afterEach(() => {
    rmSync(databases, { recursive: true, force: true });
  });

  it('is read after the update: the answer cites it and the citation opens it', async () => {
    const options = { sqlite: { persistAt: databases } };

    const first = await launchProjectChatApp(options);
    first.engine.seedPdf(PDF.path, [PDF_TEXT]);
    await first.chooseModel();
    await first.createProject(PROJECT);
    await first.addKnowledge([PDF]);
    const disk = await first.close();

    leaveAsOlderInstallDid(databases);

    const next = await launchProjectChatApp({ ...options, relaunchFrom: disk });
    const { view, rtl } = next;
    await next.openProject(PROJECT);
    rtl.fireEvent.press(view.getByTestId('project-tab-knowledge'));
    expect(view.getByText(PDF.name)).toBeTruthy();
    await next.newProjectChat();
    expect(view.queryAllByRole('link')).toHaveLength(0);

    await next.ask(QUESTION, /Achilles killed Hector/, turns());
    const citation = await rtl.waitFor(() => view.getByRole('link', { name: 'p. 1' }), { timeout: 8000 });
    expect(view.queryAllByText(/\[S1\]/)).toHaveLength(0);
    rtl.fireEvent.press(citation);
    const page = await rtl.waitFor(() => view.getByTestId('document-preview-page-1'), { timeout: 8000 });
    expect(view.getByText(PDF.name)).toBeTruthy();
    expect(rtl.within(page).getByText(PDF_TEXT)).toBeTruthy();
    await next.close();
  });
});
