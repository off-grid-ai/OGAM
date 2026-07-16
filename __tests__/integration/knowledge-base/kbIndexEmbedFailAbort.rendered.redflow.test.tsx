/**
 * RED-FLOW (rendered, UI + boundary) — product decision (user-ratified): when a document's EMBEDDING step
 * fails mid-index, the add-document operation must ABORT (roll back — the doc is NOT left half-indexed),
 * show the user a CLEAR error, and offer a RETRY. It must NOT silently "continue without embeddings".
 *
 * Real stack, real gestures, boundary fakes only: mount the REAL KnowledgeBaseScreen, tap the real "Add
 * Document" button → real handleAddDocument → real ragService.indexDocument → real documentService (memfs
 * + PDF extractor stub) → real chunker → real ragDatabase over a REAL in-memory sqlite → real
 * embeddingService.load() + embedBatch(). The ONLY faked leaves are device boundaries: the picker, memfs,
 * op-sqlite backed by node:sqlite, and the embedding model's native context (initLlama → a context whose
 * native `embedding()` REJECTS = the real on-device OOM). Nothing under src/ is jest.mocked.
 *
 * The user-perceived outcome under test (the ABORT contract):
 *   1. a CLEAR error is shown on the screen (an error card naming the failed document + a message),
 *   2. the document is NOT added to the KB list (rollback → no half-indexed entry), and
 *   3. a RETRY affordance is available.
 *
 * RED on HEAD: the screen surfaces the failure only through a fire-and-forget OS Alert — there is no
 * rendered error card and no in-UI retry affordance. So the `kb-index-error-card` / `kb-index-retry`
 * surfaces are absent → RED. (The rollback seam itself already lands: the doc does NOT appear — that half
 * is guarded by indexDocumentRollback.redflow. This test indicts the UNSURFACED error + missing retry.)
 *
 * Falsify (the happy inverse, in the second case): with embedding SUCCEEDING, the same gesture indexes the
 * doc and it appears in the list, and NO error card / retry is shown — so the error surface is a genuine
 * observed transition tied to the failure, not an always-present element.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('KB index embed-failure ABORT (rendered, red-flow)', () => {
  it('shows a clear error + a retry affordance and does NOT add the doc when embedding fails', async () => {
    const boundary = installNativeBoundary({ fs: true, llama: true, ram: { platform: 'ios', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
    doMockRealSqlite();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const RNFS = require('react-native-fs');
    const picker = require('@react-native-documents/picker');
    const { useProjectStore } = require('../../../src/stores/projectStore');
    const { KnowledgeBaseScreen } = require('../../../src/screens/KnowledgeBaseScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    // DEVICE BOUNDARY: the embedding model's native context. Load succeeds, but the native embedding call
    // rejects — exactly the on-device OOM the ABORT contract exists for. Everything above (embeddingService,
    // ragService.indexDocument rollback, the DB) runs REAL.
    boundary.llama!.module.initLlama = jest.fn(async () => ({
      embedding: jest.fn(async () => { throw new Error('OOM: embedding model ran out of memory'); }),
      release: jest.fn(async () => {}),
      completion: jest.fn(async () => ({ text: '' })),
      model: { nParams: 1_000_000, chatTemplates: { jinja: {} } },
    }));

    const docs = boundary.fs!.DocumentDirectoryPath;
    await RNFS.writeFile(`${docs}/all-MiniLM-L6-v2-Q8_0.gguf`, 'GGUF');
    await RNFS.writeFile('/docs/report.txt', 'The quarterly report. '.repeat(200));
    picker.pick.mockResolvedValue([{ uri: 'file:///docs/report.txt', name: 'report.txt', size: 4096 }]);
    useProjectStore.setState({ projects: [{ id: 'p1', name: 'Research', description: '', systemPrompt: '', createdAt: 1, updatedAt: 1 }] });

    const view = rtl.render(React.createElement(KnowledgeBaseScreen, {}));
    await rtl.waitFor(() => { expect(view.queryByText('No documents yet')).not.toBeNull(); });

    // Real gesture: attach the document → the whole real index+embed pipeline runs and the embed OOMs.
    rtl.fireEvent.press(view.getByText('Add Document'));

    // 1. A CLEAR error is surfaced ON THE SCREEN (not a vanished OS alert): an error card that names the doc.
    await rtl.waitFor(() => { expect(view.queryByTestId('kb-index-error-card')).not.toBeNull(); }, { timeout: 6000 });
    expect(view.getByTestId('kb-index-error-card')).toBeTruthy();
    expect(view.queryByText(/report\.txt/)).not.toBeNull();

    // 2. The doc is NOT added to the KB list (rollback → no half-indexed entry). The empty state persists.
    expect(view.queryByText('No documents yet')).not.toBeNull();

    // 3. A RETRY affordance is available.
    expect(view.queryByTestId('kb-index-retry')).not.toBeNull();
  });

  it('(falsify) with embedding succeeding, the doc indexes and appears with NO error card / retry', async () => {
    const boundary = installNativeBoundary({ fs: true, llama: true, ram: { platform: 'ios', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
    doMockRealSqlite();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const RNFS = require('react-native-fs');
    const picker = require('@react-native-documents/picker');
    const { useProjectStore } = require('../../../src/stores/projectStore');
    const { KnowledgeBaseScreen } = require('../../../src/screens/KnowledgeBaseScreen');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const docs = boundary.fs!.DocumentDirectoryPath;
    await RNFS.writeFile(`${docs}/all-MiniLM-L6-v2-Q8_0.gguf`, 'GGUF');
    await RNFS.writeFile('/docs/report.txt', 'The quarterly report. '.repeat(200));
    picker.pick.mockResolvedValue([{ uri: 'file:///docs/report.txt', name: 'report.txt', size: 4096 }]);
    useProjectStore.setState({ projects: [{ id: 'p1', name: 'Research', description: '', systemPrompt: '', createdAt: 1, updatedAt: 1 }] });

    const view = rtl.render(React.createElement(KnowledgeBaseScreen, {}));
    await rtl.waitFor(() => { expect(view.queryByText('No documents yet')).not.toBeNull(); });

    rtl.fireEvent.press(view.getByText('Add Document'));

    // Happy inverse: the doc indexes and appears; no error surface is shown.
    await rtl.waitFor(() => { expect(view.queryByText('report.txt')).not.toBeNull(); }, { timeout: 6000 });
    expect(view.queryByTestId('kb-index-error-card')).toBeNull();
    expect(view.queryByTestId('kb-index-retry')).toBeNull();
  });
});
