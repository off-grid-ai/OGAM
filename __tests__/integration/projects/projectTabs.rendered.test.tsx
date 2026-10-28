/**
 * A project shows its chats and its knowledge base as two tabs, not two stacked halves.
 *
 * Product-correct outcome (the person's view): opening a project lands on Chats, with how many chats
 * and how many documents it has on the two tabs. Tapping Knowledge base shows only the knowledge base,
 * with its Add action; tapping Chats brings the chats back. A document added to the knowledge base
 * shows up in that tab's count.
 *
 * Entry point: the REAL App. Every step is a gesture: pick the model, create the project, tap the tabs,
 * open the knowledge base, pick a PDF, go back.
 *
 * Fakes (device boundary only, harness/knowledgeBaseApp + documentEngine): llama.rn, the native PDF
 * reader, op-sqlite, the in-memory disk, the RAM sensor and the OS document picker.
 */
import { launchProjectChatApp } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
jest.setTimeout(60000);

const PDF_PATH = '/docs/Downloads/trip-notes.pdf';

describe('project screen tabs', () => {
  it('opens on Chats, switches to the knowledge base and back, and counts what each holds', async () => {
    const app = await launchProjectChatApp();
    const { view, rtl, engine } = app;
    engine.seedPdf(PDF_PATH, ['Day one: the ferry leaves at nine.']);

    await app.chooseModel();
    await app.createProject('Island trip');

    // Lands on Chats; both tabs say how much they hold.
    expect(view.getByTestId('project-tab-chats')).toHaveProp('accessibilityState', { selected: true });
    expect(view.getByTestId('project-chats-count')).toHaveTextContent('0');
    expect(view.getByTestId('project-knowledge-base-count')).toHaveTextContent('0');
    // A hidden tab is left out of the queries, as it is out of the person's sight.
    expect(view.getByTestId('project-start-chat')).toBeVisible();
    expect(view.queryByTestId('kb-add-document')).toBeNull();

    // Knowledge base tab: only the knowledge base shows.
    rtl.fireEvent.press(view.getByTestId('project-tab-knowledge'));
    expect(view.getByTestId('project-tab-knowledge')).toHaveProp('accessibilityState', { selected: true });
    expect(view.getByTestId('kb-add-document')).toBeVisible();
    expect(view.queryByTestId('project-start-chat')).toBeNull();

    // A document added there is counted on its tab.
    await app.addKnowledge([{ path: PDF_PATH, name: 'trip-notes.pdf', pages: 1 }]);
    await rtl.waitFor(() => expect(view.getByTestId('project-knowledge-base-count')).toHaveTextContent('1'));

    // Back to Chats.
    rtl.fireEvent.press(view.getByTestId('project-tab-chats'));
    expect(view.getByTestId('project-start-chat')).toBeVisible();
    expect(view.queryByTestId('kb-add-document')).toBeNull();

    await app.close();
  });
});
