/**
 * KnowledgeBaseScreen — a project's files: adding them, seeing how far each has been read, switching one
 * off, removing one, opening one.
 *
 * Mounted on a REAL navigation stack over the REAL knowledge base and document engine
 * (harness/knowledgeBaseApp). Each row's status line is the person's only view of background reading:
 * "Reading 40%", "Indexing 16/20", "3 pages" or "Couldn't read" (KnowledgeDocumentInfo). Native leaves
 * only: the picker, the OS dialog, memfs, in-memory SQLite, the PDF reader and the embedding model.
 */
import { openKnowledgeBase } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');

const TOPICS = ['pumps', 'valves', 'seals', 'gaskets', 'bearings', 'filters', 'hoses', 'gauges', 'belts', 'fuses'];
/** Pages that read like a real manual: each one about something different (identical lines would be
 *  dropped as a running header, as they are in a real PDF). */
const pages = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      `Section ${i * 7 + 3}: inspecting the ${TOPICS[i % TOPICS.length]} of unit ${String.fromCharCode(65 + (i % 26))}${i}. ` +
      `Record the reading of gauge ${i * 13 + 1} and replace anything worn past ${i % 4} millimetres.`,
  );

describe('KnowledgeBaseScreen', () => {
  it('shows the project name, and an empty state until a file is added', async () => {
    const kb = await openKnowledgeBase({ projectName: 'Field Ops' });

    expect(kb.view.getByText('Field Ops')).toBeTruthy();
    expect(kb.view.getByText('No documents yet')).toBeTruthy();
  });

  it('lists an added file with its size, and its status reads the page count once it is read', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedPdf('/docs/Downloads/manual.pdf', pages(3));

    await kb.addFiles([{ path: '/docs/Downloads/manual.pdf', name: 'manual.pdf' }]);

    expect(kb.view.queryByText('No documents yet')).toBeNull();
    const status = await kb.statusOf('/docs/Downloads/manual.pdf');
    await kb.rtl.waitFor(() => expect(status.props.children).toMatch(/^\d+(\.\d)? (B|KB) · 3 pages$/));
  });

  it('adds several picked files at once', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedText('/docs/Downloads/a.txt', 'Alpha notes.');
    kb.engine.seedText('/docs/Downloads/b.txt', 'Beta notes.');

    await kb.addFiles([
      { path: '/docs/Downloads/a.txt', name: 'a.txt' },
      { path: '/docs/Downloads/b.txt', name: 'b.txt' },
    ]);

    expect(kb.view.getByText('a.txt')).toBeTruthy();
    expect(kb.view.getByText('b.txt')).toBeTruthy();
  });

  describe('a row says how far its file has been read', () => {
    it('"Reading …%" while pages are still coming in, then the page count', async () => {
      const kb = await openKnowledgeBase();
      // A long PDF: the reader parks before its second batch of pages.
      kb.engine.seedPdf('/docs/Downloads/book.pdf', pages(60));
      kb.engine.holdReadAt(50);

      await kb.addFiles([{ path: '/docs/Downloads/book.pdf', name: 'book.pdf' }]);
      const status = await kb.statusOf('/docs/Downloads/book.pdf');
      await kb.rtl.waitFor(() => expect(status.props.children).toMatch(/· Reading \d+%$/));
      expect(status.props.children).not.toMatch(/pages$/);

      await kb.rtl.act(async () => kb.engine.releaseRead());

      await kb.rtl.waitFor(() =>
        expect(kb.view.getByTestId(status.props.testID).props.children).toMatch(/· 60 pages$/),
      );
    });

    it('"Indexing done/total" while passages are being embedded', async () => {
      const kb = await openKnowledgeBase();
      // 20 one-passage pages: the first batch of 16 is embedded, then the model is parked.
      kb.engine.seedPdf('/docs/Downloads/manual.pdf', pages(20));
      kb.engine.holdEmbedding(16);

      await kb.addFiles([{ path: '/docs/Downloads/manual.pdf', name: 'manual.pdf' }]);
      const status = await kb.statusOf('/docs/Downloads/manual.pdf');
      await kb.rtl.waitFor(() => expect(status.props.children).toMatch(/· Indexing 16\/20$/));

      await kb.rtl.act(async () => kb.engine.releaseEmbedding());

      await kb.rtl.waitFor(() =>
        expect(kb.view.getByTestId(status.props.testID).props.children).toMatch(/· 20 pages$/),
      );
    });

    it('"Couldn\'t read" when the file cannot be opened', async () => {
      const kb = await openKnowledgeBase();
      kb.engine.seedText('/docs/Downloads/broken.pdf', 'damaged bytes');

      await kb.addFiles([{ path: '/docs/Downloads/broken.pdf', name: 'broken.pdf' }]);

      const status = await kb.statusOf('/docs/Downloads/broken.pdf');
      await kb.rtl.waitFor(() => expect(status.props.children).toMatch(/· Couldn't read$/));
    });
  });

  it('switches a file off and on, and the switch says which', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedText('/docs/Downloads/notes.txt', 'Field notes.');
    await kb.addFiles([{ path: '/docs/Downloads/notes.txt', name: 'notes.txt' }]);
    // One switch named for what it does; its on/off is its own checked state.
    const toggle = () => kb.view.getByRole('switch', { name: 'Use in answers: notes.txt' });
    expect(toggle()).toBeChecked();

    kb.rtl.fireEvent(toggle(), 'valueChange', false);

    await kb.rtl.waitFor(() => expect(toggle()).not.toBeChecked());

    kb.rtl.fireEvent(toggle(), 'valueChange', true);

    await kb.rtl.waitFor(() => expect(toggle()).toBeChecked());
  });

  it('removes a file after the person confirms, and keeps it when they cancel', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedText('/docs/Downloads/notes.txt', 'Field notes.');
    await kb.addFiles([{ path: '/docs/Downloads/notes.txt', name: 'notes.txt' }]);

    kb.rtl.fireEvent.press(kb.view.getByLabelText('Remove notes.txt'));
    expect(kb.dialogTitle()).toBe('Remove Document');
    await kb.answerDialog('Cancel');
    expect(kb.view.getByText('notes.txt')).toBeTruthy();

    kb.rtl.fireEvent.press(kb.view.getByLabelText('Remove notes.txt'));
    await kb.answerDialog('Remove');

    await kb.rtl.waitFor(() => expect(kb.view.getByText('No documents yet')).toBeTruthy());
    expect(kb.view.queryByText('notes.txt')).toBeNull();
  });

  it('opens a file\'s pages when its row is tapped', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedPdf('/docs/Downloads/manual.pdf', ['Setup steps.', 'Torque the bolts to 40 Nm.']);
    await kb.addFiles([{ path: '/docs/Downloads/manual.pdf', name: 'manual.pdf' }]);

    kb.rtl.fireEvent.press(kb.view.getByLabelText('Knowledge document manual.pdf'));

    await kb.rtl.waitFor(() => expect(kb.view.getByText('Torque the bolts to 40 Nm.')).toBeTruthy());
    expect(kb.view.getByText('Page 2')).toBeTruthy();
  });

  it('goes back to the project', async () => {
    const kb = await openKnowledgeBase();

    kb.rtl.fireEvent.press(kb.view.getByLabelText('Back'));

    await kb.rtl.waitFor(() => expect(kb.view.queryByTestId('knowledge-base-screen')).toBeNull());
    expect(kb.view.getByText('Open knowledge base')).toBeTruthy();
  });
});
