/**
 * T011 (GREEN guard, UI + boundary) — attaching a >5MB document to a project's knowledge base is rejected
 * with "Maximum size is 5MB", and no document is added.
 *
 * Real stack over the device boundary: mount the REAL KnowledgeBaseScreen, tap the REAL "Add Document"
 * button → the real handleAddDocument → real resolvePickedFileUri → real ragService.indexDocument → real
 * documentService.processDocumentFromPath, which stats the file (memfs) and enforces MAX_FILE_SIZE. The ONLY
 * fakes are device leaves: the document picker (@react-native-documents/picker), the filesystem (memfs), and
 * the OS alert (Alert.alert — a native dialog, asserted as the named device-boundary the user sees).
 *
 * The >5MB rejection's user-visible artifact is the on-screen index-error card (the same retriable card the
 * ABORT contract surfaces for any index failure); the KB list staying empty ("No documents yet") corroborates
 * that nothing was added. Falsify: a <5MB file does NOT surface the 5MB rejection message.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

async function mountKbWithPickedFile(sizeBytes: number) {
  const boundary = installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
  /* eslint-disable @typescript-eslint/no-var-requires */
  const React = require('react');
  const rtl = requireRTL();
  const picker = require('@react-native-documents/picker');
  const { useProjectStore } = require('../../../src/stores/projectStore');
  const { KnowledgeBaseScreen } = require('../../../src/screens/KnowledgeBaseScreen');
  /* eslint-enable @typescript-eslint/no-var-requires */

  // DEVICE BOUNDARY: the picked file on disk (memfs) at the exact size, and the picker returning it. iOS
  // 'import' path → resolvePickedFileUri strips file:// and returns the path directly (no keepLocalCopy).
  const uri = 'file:///docs/report.txt';
  boundary.fs!.seedFile('/docs/report.txt', sizeBytes);
  picker.pick.mockResolvedValue([{ uri, name: 'report.txt', size: sizeBytes }]);

  // Precondition: the project exists (a KB belongs to a project). This is a precondition, not the tested
  // doc-attach behavior — the attach is driven by the real gesture below.
  useProjectStore.setState({ projects: [{ id: 'p1', name: 'Research', description: '', systemPrompt: '', createdAt: 1, updatedAt: 1 }] });

  const view = rtl.render(React.createElement(KnowledgeBaseScreen, {}));
  await rtl.waitFor(() => { expect(view.queryByText('No documents yet')).not.toBeNull(); });
  return { view, rtl };
}

describe('T011 (rendered) — >5MB document is rejected from the knowledge base', () => {
  it('shows "Maximum size is 5MB" and adds no document', async () => {
    const { view, rtl } = await mountKbWithPickedFile(6 * MB); // over the 5MB limit

    // Real gesture: tap "Add Document" → the whole real attach→index pipeline runs over the boundary.
    rtl.fireEvent.press(view.getByText('Add Document'));

    // The user is told the file is too large — on the on-screen index-error card (the artifact they see).
    await rtl.waitFor(() => {
      expect(view.queryByTestId('kb-index-error-card')).not.toBeNull();
    }, { timeout: 4000 });
    expect(view.queryByText(/Maximum size is 5MB/)).not.toBeNull();
    // ...and nothing was added: the KB list still shows the empty state.
    expect(view.queryByText('No documents yet')).not.toBeNull();
  });

  it('falsify: a <5MB file does NOT surface the 5MB rejection', async () => {
    const { view, rtl } = await mountKbWithPickedFile(1 * MB); // under the limit
    rtl.fireEvent.press(view.getByText('Add Document'));
    // Whatever happens downstream (e.g. no embedding model present), the size guard did NOT fire — the
    // 5MB rejection message is never shown (the guard is size-specific).
    await rtl.waitFor(() => { expect(view.queryByTestId('kb-index-error-card')).not.toBeNull(); }).catch(() => {});
    expect(view.queryByText(/Maximum size is 5MB/)).toBeNull();
  });
});
