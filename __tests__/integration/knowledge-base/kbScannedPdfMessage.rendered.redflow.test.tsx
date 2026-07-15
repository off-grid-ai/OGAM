/**
 * T010 / DEV (RED, UI + boundary) — attaching a scanned/image PDF (no text layer) to the knowledge base
 * must tell the user clearly it's a scanned/no-text-layer PDF, not the vague "Could not extract text".
 *
 * Device finding: a scanned PDF ([WIRE-PDF] textLength:0) surfaced "could not extract text from document" —
 * "correct, but unclear — could say 'scanned PDF / no text layer, no OCR'". Product-correct: a clear message
 * naming the cause (scanned / no text layer).
 *
 * Real stack: mount the REAL KnowledgeBaseScreen, tap "Add Document" → real handleAddDocument → real
 * ragService.indexDocument → real documentService.processDocumentFromPath → real pdfExtractor. The only fakes
 * are device leaves: the picker, memfs, and the native PDFExtractorModule (returns '' = a scanned page). The
 * user-visible artifact is the on-screen index-error card (the same retriable card the ABORT contract
 * surfaces for any index failure). RED on HEAD: the message is the vague one, not one that names the
 * scanned/no-text-layer cause. Falsify: the fix greens it by emitting a clear scanned-PDF message.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T010 (rendered) — scanned/no-text-layer PDF must show a clear message (DEV)', () => {
  it('the extraction-failure alert names the scanned/no-text-layer cause, not a vague message', async () => {
    const boundary = installNativeBoundary({ fs: true, ram: { platform: 'ios', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const RN = require('react-native');
    // DEVICE BOUNDARY: the native PDF extractor. A scanned/image PDF has no text layer → extractText returns
    // '' (exactly [WIRE-PDF] textLength:0). Set BEFORE requiring the screen so pdfExtractor captures it.
    RN.NativeModules.PDFExtractorModule = { extractText: jest.fn(async () => '') };
    const picker = require('@react-native-documents/picker');
    const { useProjectStore } = require('../../../src/stores/projectStore');
    const { KnowledgeBaseScreen } = require('../../../src/screens/KnowledgeBaseScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    boundary.fs!.seedFile('/docs/scan.pdf', 200 * 1024); // a small scanned PDF (under 5MB)
    picker.pick.mockResolvedValue([{ uri: 'file:///docs/scan.pdf', name: 'scan.pdf', size: 200 * 1024 }]);
    useProjectStore.setState({ projects: [{ id: 'p1', name: 'Research', description: '', systemPrompt: '', createdAt: 1, updatedAt: 1 }] });

    const view = rtl.render(React.createElement(KnowledgeBaseScreen, {}));
    await rtl.waitFor(() => { expect(view.queryByText('No documents yet')).not.toBeNull(); });

    // Real gesture: attach the scanned PDF.
    rtl.fireEvent.press(view.getByText('Add Document'));

    // Precondition: the extraction genuinely failed and the on-screen error card appeared (flow reached failure).
    await rtl.waitFor(() => { expect(view.queryByTestId('kb-index-error-card')).not.toBeNull(); }, { timeout: 4000 });
    // SPEC: the message names the scanned / no-text-layer cause. RED on HEAD: it is the vague
    // "Could not extract text from document" instead.
    expect(view.queryByText(/scanned|no text layer|OCR/i)).not.toBeNull();
  });
});
