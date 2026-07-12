/**
 * T118 (GREEN guard, UI) — the embedding model lazy-loads on the first real embed() and co-resides as a
 * reclaimable SIDECAR: after a document is indexed into a project's knowledge base, the model selector's
 * "In Memory" section lists `resident-item-embedding`.
 *
 * Real stack, real gestures, boundary fakes only: mount the REAL KnowledgeBaseScreen, tap the real "Add
 * Document" button → real ragService.indexDocument → real documentService (memfs) → chunk → real
 * embeddingService.load() (registers `type:'embedding'` residency) → real embed() → real ragDatabase writes
 * to a REAL in-memory sqlite engine. The only fakes are device leaves: the picker, memfs, the embedding
 * model's native context (llama fake's `embedding()` → device-shaped 384-dim vector), and op-sqlite backed by
 * node:sqlite. Residency is validated through the SAME model-selector In Memory UI as T111–T117 —
 * not getResidents().
 *
 * Precondition: before indexing, In Memory does NOT list the embedding model — so its appearance after the
 * real embed is a genuine observed transition (the lazy-load), not an always-present surface. Falsify:
 * skipping the index leaves the embedding model absent from In Memory.
 */
import { installNativeBoundary, requireRTL, MB } from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: { projectId: 'p1' } }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('T118 (rendered) — embedding model co-resides as a sidecar after a KB index (In Memory UI)', () => {
  it('lists resident-item-embedding once a document has been embedded into the knowledge base', async () => {
    // installNativeBoundary resets modules + fakes the device leaves; doMockRealSqlite then backs op-sqlite
    // with a REAL node:sqlite engine WITHOUT a second reset (composed), so ragDatabase runs real SQL.
    const boundary = installNativeBoundary({ fs: true, llama: true, ram: { platform: 'ios', totalBytes: 8 * 1024 * MB, availBytes: 6 * 1024 * MB } });
    doMockRealSqlite();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const React = require('react');
    const rtl = requireRTL();
    const RNFS = require('react-native-fs');
    const picker = require('@react-native-documents/picker');
    const { useProjectStore } = require('../../../src/stores/projectStore');
    const { KnowledgeBaseScreen } = require('../../../src/screens/KnowledgeBaseScreen');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    /* eslint-enable @typescript-eslint/no-var-requires */

    const docs = boundary.fs!.DocumentDirectoryPath;
    // DEVICE BOUNDARY: the embedding model file present on disk → ensureModelCopied skips the asset copy and
    // returns this path for initLlama({embedding:true}). And a real text document to index.
    await RNFS.writeFile(`${docs}/all-MiniLM-L6-v2-Q8_0.gguf`, 'GGUF');
    await RNFS.writeFile('/docs/notes.txt', 'The capital of Zenland is Quixotic City. Bananas are yellow. The weather is mild today.');
    picker.pick.mockResolvedValue([{ uri: 'file:///docs/notes.txt', name: 'notes.txt', size: 90 }]);
    useProjectStore.setState({ projects: [{ id: 'p1', name: 'Research', description: '', systemPrompt: '', createdAt: 1, updatedAt: 1 }] });

    const openSelector = () => rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {}, isLoading: false, currentModelPath: null,
    }));

    // Precondition (via the SAME real UI): the embedding model is NOT in memory before any embed.
    const before = openSelector();
    await rtl.act(async () => { await new Promise(r => setTimeout(r, 350)); });
    expect(before.queryByTestId('resident-item-embedding')).toBeNull();
    before.unmount();

    // Real gesture: attach the document → the whole real index+embed pipeline runs (lazy-loads the embedding
    // model, which registers as a resident sidecar and stays loaded).
    const kb = rtl.render(React.createElement(KnowledgeBaseScreen, {}));
    await rtl.waitFor(() => { expect(kb.queryByText('No documents yet')).not.toBeNull(); });
    rtl.fireEvent.press(kb.getByText('Add Document'));
    await rtl.waitFor(() => { expect(kb.queryByText('notes.txt')).not.toBeNull(); }, { timeout: 6000 });

    // Result via the In Memory UI: the embedding model co-resides as a sidecar.
    const after = openSelector();
    await rtl.waitFor(() => { expect(after.queryByTestId('resident-item-embedding')).not.toBeNull(); }, { timeout: 4000 });
  });
});
