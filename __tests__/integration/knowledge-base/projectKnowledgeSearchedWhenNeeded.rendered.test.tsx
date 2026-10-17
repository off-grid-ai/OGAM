/**
 * Project knowledge is searched when the question needs it, not read on every message (ba6bbd1a4), and
 * the answer cites the page it came from (5c12cc2fe).
 *
 * Product-correct outcome (the person's view): they add a PDF to a project's knowledge base and wait
 * until it has been read. In a chat of that project they ask something the PDF has nothing to do with:
 * the answer comes with no citation, and the PDF was not handed to the model. Then they ask what the PDF
 * answers: the model searches the knowledge base, the answer cites the page as a link, and tapping the
 * link opens the PDF (by its name) at that page.
 *
 * Entry point: the REAL App. Every step is a gesture: pick the model on Home, create the project on the
 * Projects tab, open its knowledge base, pick the PDF, go back, start a chat, type and send, tap the
 * citation.
 *
 * Fakes (device boundary only, harness/knowledgeBaseApp + documentEngine): llama.rn (it answers the
 * second question with a search_knowledge_base tool call in the OpenAI shape the device sends, then the
 * cited answer), the native PDF reader, op-sqlite (a real SQLite with FTS5), the in-memory disk, the RAM
 * sensor and the OS document picker. What llama.rn was asked is read off its own record: it is the only
 * place "the PDF was not handed to the model" can be seen.
 */
import { launchProjectChatApp } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
jest.setTimeout(60000);

const PDF_PATH = '/docs/Downloads/zenland-atlas.pdf';
const PDF_NAME = 'zenland-atlas.pdf';
const PAGE_ONE = 'Zenland is an island nation in the northern sea. Its winters are long and dark.';
const PAGE_TWO = 'The capital of Zenland is Quixotic City, founded by fishermen in 1412.';
const PAGE_THREE = 'Zenland exports smoked herring, wool and wind power to its neighbours.';

describe('project knowledge in a project chat', () => {
  it('is left out of an unrelated question, and a question it answers cites the page that opens at that page', async () => {
    const app = await launchProjectChatApp();
    const { view, rtl, engine } = app;
    engine.seedPdf(PDF_PATH, [PAGE_ONE, PAGE_TWO, PAGE_THREE]);

    await app.chooseModel();
    await app.createProject('Zenland trip');
    await app.addKnowledge([{ path: PDF_PATH, name: PDF_NAME, pages: 3 }]);
    await app.newProjectChat();

    // An unrelated question: answered with no citation and no knowledge-base search, and the PDF's
    // text never reached the model.
    await app.ask('What is the capital of France?', 'The capital of France is Paris.', [
      { text: 'The capital of France is Paris.' },
    ]);
    expect(view.queryAllByRole('link')).toHaveLength(0);
    expect(view.queryByTestId('tool-result-label-search_knowledge_base')).toBeNull();
    expect(app.prompts().join('\n')).not.toMatch(/Quixotic|herring|northern sea/);

    // A question the PDF answers: the model searches the knowledge base, then cites what it found.
    await app.ask('What is the capital of Zenland?', /Quixotic City/, [
      {
        text: '',
        toolCalls: [{
          id: 'call_kb_0',
          type: 'function',
          function: { name: 'search_knowledge_base', arguments: JSON.stringify({ query: 'capital of Zenland' }) },
        }] as never,
      },
      { text: 'The capital of Zenland is Quixotic City [S1].' },
    ]);
    const citation = await rtl.waitFor(() => view.getByRole('link', { name: 'p. 2' }), { timeout: 8000 });
    expect(view.queryAllByText(/\[S1\]/)).toHaveLength(0);
    expect(view.queryByTestId('document-preview-page-2')).toBeNull();

    // Tapping the citation opens the PDF, by its name, at the cited page.
    rtl.fireEvent.press(citation);
    const page = await rtl.waitFor(() => view.getByTestId('document-preview-page-2'), { timeout: 8000 });
    expect(view.getByText(PDF_NAME)).toBeTruthy();
    expect(rtl.within(page).getByText(PAGE_TWO)).toBeTruthy();
    // The cited page is the one marked (its own background); the others are not.
    const { StyleSheet } = require('react-native');
    const background = (testID: string) => StyleSheet.flatten(view.getByTestId(testID).props.style).backgroundColor;
    expect(background('document-preview-page-2')).toBeDefined();
    expect(background('document-preview-page-1')).toBeUndefined();

    await app.close();
  });
});
