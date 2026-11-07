/**
 * T011 (GREEN guard, UI + boundary) — the knowledge base takes files up to 1 GB (they are read page by
 * page natively, never whole into memory); a larger file is refused on the screen and nothing is added.
 * The old 5 MB cap is gone: a 50 MB file is added like any other.
 *
 * Real stack over the device boundary (harness/knowledgeBaseApp): mount the REAL KnowledgeBaseScreen,
 * tap the REAL add button → real handleAddDocument → real resolvePickedFileUri → real knowledgeBase.addFile
 * → real documentService.attachDocument, which asks the filesystem (memfs) for the file's size. The only
 * fakes are device leaves: the document picker and the filesystem's reported size.
 *
 * The refusal's user-visible artifact is the on-screen index-error card; the list staying empty
 * ("No files yet") corroborates that nothing was added.
 */
import { openKnowledgeBase } from '../../harness/knowledgeBaseApp';

jest.unmock('@react-navigation/native');

const MB = 1024 * 1024;

describe('T011 (rendered) — a document over 1 GB is refused by the knowledge base', () => {
  it('shows "Maximum size is 1 GB" and adds no document', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedText('/docs/Downloads/archive.txt', 'too big', 1024 * MB + 1);

    await kb.addFiles([{ path: '/docs/Downloads/archive.txt', name: 'archive.txt', size: 1024 * MB + 1 }]);

    // The person is told the file is too large, on the card that names it - and nothing was added.
    expect(kb.view.getByTestId('kb-index-error-card')).toBeTruthy();
    expect(kb.view.getByText('Couldn\'t add "archive.txt"')).toBeTruthy();
    expect(kb.view.getByText(/Maximum size is 1 GB/)).toBeTruthy();
    expect(kb.view.getByText('No files yet')).toBeTruthy();
  });

  it('adds a 50 MB file (ten times the old limit) with no error', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedText('/docs/Downloads/manual.txt', 'Torque the bolts to 40 Nm.', 50 * MB);

    await kb.addFiles([{ path: '/docs/Downloads/manual.txt', name: 'manual.txt', size: 50 * MB }]);

    expect(kb.view.queryByTestId('kb-index-error-card')).toBeNull();
    const status = await kb.statusOf('/docs/Downloads/manual.txt');
    await kb.rtl.waitFor(() => expect(status.props.children).toMatch(/^50\.0 MB · 1 page$/));
  });

  it('a refused file can be retried from the card once the person picks a smaller one', async () => {
    const kb = await openKnowledgeBase();
    kb.engine.seedText('/docs/Downloads/archive.txt', 'too big', 1024 * MB + 1);
    kb.engine.seedText('/docs/Downloads/summary.txt', 'The archive in short.');
    await kb.addFiles([{ path: '/docs/Downloads/archive.txt', name: 'archive.txt' }]);
    expect(kb.view.getByTestId('kb-index-error-card')).toBeTruthy();

    const picker = require('@react-native-documents/picker');
    picker.pick.mockResolvedValue([{ uri: 'file:///docs/Downloads/summary.txt', name: 'summary.txt', size: 21 }]);
    kb.rtl.fireEvent.press(kb.view.getByTestId('kb-index-retry'));

    await kb.rtl.waitFor(() => expect(kb.view.getByText('summary.txt')).toBeTruthy());
    expect(kb.view.queryByTestId('kb-index-error-card')).toBeNull();
  });
});
