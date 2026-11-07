/**
 * A project's page shows what it knows (its instructions and its files) and its chats on one page;
 * the files open their own screen.
 *
 * Product-correct outcome (the person's view): a new project shows its instructions, asks for a file,
 * and counts no chats. Its files row opens the Files screen; a file added there is counted on the page
 * when the person comes back. New chat starts a chat in the project, and the page then counts it.
 *
 * Entry point: the REAL App. Every step is a gesture: pick the model, create the project, open its
 * files, pick a PDF, go back, start a chat, go back.
 *
 * Fakes (device boundary only, harness/knowledgeBaseApp + documentEngine): llama.rn, the native PDF
 * reader, op-sqlite, the in-memory disk, the RAM sensor and the OS document picker.
 */
import { launchProjectChatApp } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');
jest.mock('react-native-bootsplash', () => ({ hide: jest.fn(async () => {}) }), { virtual: true });
jest.setTimeout(60000);

const PDF_PATH = '/docs/Downloads/trip-notes.pdf';

describe('a project page', () => {
  it('shows its instructions and files, opens the files on their own screen, and counts its chats', async () => {
    const app = await launchProjectChatApp();
    const { view, rtl, engine } = app;
    engine.seedPdf(PDF_PATH, ['Day one: the ferry leaves at nine.']);

    await app.chooseModel();
    await app.createProject('Island trip');

    // What it knows: the instructions it was made with, and no file yet. No chats yet.
    expect(view.getByText('What it knows')).toBeTruthy();
    expect(view.getByTestId('project-instructions')).toHaveProp(
      'accessibilityLabel',
      'Instructions: Answer from the project documents.',
    );
    expect(view.getByTestId('project-knowledge-base-count')).toHaveTextContent('Add a file');
    expect(view.getByTestId('project-chats-count')).toHaveTextContent('Chats · 0');
    expect(view.getByText("Start a chat. It follows this project's instructions.")).toBeTruthy();

    // The files row opens the Files screen; a file added there is counted back on the page.
    await app.addKnowledge([{ path: PDF_PATH, name: 'trip-notes.pdf', pages: 1 }]);
    await rtl.waitFor(() => expect(view.getByTestId('project-knowledge-base-count')).toHaveTextContent('1 file'));
    expect(view.getByText('Chats here answer from it.')).toBeTruthy();

    // New chat starts a chat in the project; back on the page it is counted and listed.
    await app.newProjectChat();
    const backs = view.getAllByLabelText('Back');
    rtl.fireEvent.press(backs[backs.length - 1]);
    await rtl.waitFor(() => expect(view.queryByTestId('chat-input')).toBeNull());
    await rtl.waitFor(() => expect(view.getByTestId('project-chats-count')).toHaveTextContent('Chats · 1'));
    expect(view.queryByText("Start a chat. It follows this project's instructions.")).toBeNull();

    await app.close();
  });
});
