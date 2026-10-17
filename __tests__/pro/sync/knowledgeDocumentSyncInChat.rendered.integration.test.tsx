/**
 * A document synced from Desktop is usable in the project's chat.
 *
 * Pro 5c268777 / e2a9c9ec: a knowledge-base file that arrives from another device used to land as a
 * file with no text, so the phone's model could not use it. It now goes through the phone's own
 * document engine, with visible progress, exactly like a file added on the phone.
 * (knowledgeDocumentSync.integration covers staging and indexing; this covers USING it.)
 *
 * SPEC (OGAM user's view): I put a PDF into a project on my Mac. On my phone the project shows it
 * being read, then read. I ask the project's chat about it; the answer cites the file, and tapping the
 * citation opens the page with the file's text.
 *
 * The real App on the real navigation stack. Device boundaries only: the Desktop is the paired-peer op
 * injector (a real shared sync engine on the in-memory TCP boundary that streams the file and sends
 * the project and document ops), the native PDF reader and MiniLM embedding model
 * (harness/documentEngine, over real in-memory SQLite with FTS5), the memfs disk, and llama.rn.
 */
import type { LicensedMesh } from '../../harness/licensedMesh';
import type { DocumentEngineBoundary } from '../../harness/documentEngine';

jest.unmock('@react-navigation/native');
jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeTcpBoundary(),
}));
jest.mock('react-native-zeroconf', () => ({
  __esModule: true,
  default: require('../../utils/nativeSyncBoundaries').createNativeDiscoveryBoundary(),
}));

type ProHarness = typeof import('../../harness/proHarness');
type App = Awaited<ReturnType<ProHarness['launchLicensedApp']>>;
type Peer = Awaited<ReturnType<ProHarness['startPairedPeer']>>;

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const FILE_NAME = 'launch-brief.pdf';
const BETA_PAGE = 'The OGAD launch brief says the private beta begins on Thursday in Lisbon.';
// Long enough that reading it takes more than one native batch, so its progress can be seen.
const PAGES = [
  BETA_PAGE,
  ...Array.from({ length: 59 }, (_, i) => `Appendix ${i + 2}: seating plan, row ${i + 2}, chairs and tables.`),
];
const ANSWER = 'The private beta begins on Thursday [S1].';

describe('a knowledge document synced from Desktop, in the project chat', () => {
  let mesh: LicensedMesh;
  let app: App | undefined;
  let desktop: Peer | undefined;

  beforeEach(() => {
    const { createLicensedMesh } = require('../../harness/licensedMesh');
    mesh = createLicensedMesh();
    mesh.reset();
  });

  afterEach(async () => {
    await desktop?.stop();
    desktop = undefined;
    await app?.close();
    app = undefined;
    mesh.restore();
  });

  it('shows the file being read, then read, and the chat answer cites it and opens its text', async () => {
    const { launchLicensedApp, startPairedPeer } = require('../../harness/proHarness') as ProHarness;
    let engine: DocumentEngineBoundary | undefined;
    app = await launchLicensedApp({
      mesh,
      secrets: new Map(),
      configure: boundary => {
        const { installDocumentEngine } = require('../../harness/documentEngine');
        engine = installDocumentEngine(boundary.fs!, { llama: boundary.llama!.module });
      },
    });
    const { view, rtl } = app;

    // The model is chosen on Home, as a person does before chatting.
    rtl.fireEvent.press(view.getByTestId('browse-models-button'));
    rtl.fireEvent.press(await view.findByTestId('text-model-row-m'));
    await rtl.waitFor(() => expect(view.queryByTestId('text-model-row-m')).toBeNull());

    // Pair the Desktop by the code on the Sync screen.
    desktop = await startPairedPeer({ mesh, device: { id: 'desktop-kb-chat-peer', name: 'Studio Mac' } });
    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    rtl.fireEvent.press(await view.findByTestId('open-sync-settings'));
    const phoneId = await desktop.pairWithPhone(view);
    rtl.fireEvent.press(view.getByLabelText('Back'));

    // The Desktop puts the PDF into a project: the file first, then the project and the document.
    const sync = require('@offgrid/sync');
    const { pdfFile } = require('../../harness/documentEngine');
    const descriptor = {
      syncId: DOCUMENT_ID, projectId: PROJECT_ID, name: FILE_NAME,
      createdAt: '2026-10-15T08:00:00.000Z', enabled: true,
    };
    // Hold the native reader part-way, so the reading is on screen while it happens.
    engine!.holdReadAt(50);
    await rtl.act(async () => {
      await desktop!.sendFile(phoneId, {
        fileName: FILE_NAME,
        bytes: new Uint8Array(Buffer.from(pdfFile(PAGES))),
        mimeType: sync.KNOWLEDGE_DOCUMENT_MIME,
        metadata: sync.createKnowledgeDocumentTransferMetadata(descriptor),
      });
      desktop!.record('project', PROJECT_ID, 'put', {
        name: 'OGAD', description: 'Launch documents', system_prompt: 'Use the launch brief.',
        icon: null, include_memory: 1,
        created_at: descriptor.createdAt, updated_at: descriptor.createdAt,
      });
      desktop!.record(sync.KNOWLEDGE_DOCUMENT_ENTITY, DOCUMENT_ID, 'put',
        sync.createKnowledgeDocumentStateFields(descriptor));
    });

    // The project shows the file being read...
    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    rtl.fireEvent.press(await view.findByText('OGAD', {}, { timeout: 8000 }));
    await view.findByTestId('project-detail-screen');
    await view.findByText(FILE_NAME, {}, { timeout: 8000 });
    await rtl.waitFor(() => expect(view.getByText(/Reading \d+%/)).toBeTruthy(), { timeout: 8000 });
    expect(view.queryByText(/· 60 pages$/)).toBeNull();

    // ...then read.
    engine!.releaseRead();
    await rtl.waitFor(() => expect(view.getByText(/· 60 pages$/)).toBeTruthy(), { timeout: 8000 });
    expect(view.queryByText(/Reading \d+%/)).toBeNull();

    // Ask in the project's chat. BEFORE: no answer, no citation.
    rtl.fireEvent.press(view.getByTestId('project-start-chat'));
    await view.findByTestId('chat-input');
    expect(view.queryByText('p. 1')).toBeNull();
    app.boundary.llama!.scriptCompletion({ text: ANSWER });
    rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'When does the private beta begin?');
    rtl.fireEvent.press(view.getByTestId('send-button'));
    await rtl.waitFor(() => expect(view.queryByTestId('stop-button')).toBeNull(), { timeout: 8000 });

    // The answer cites the synced file's page, as a link and not the raw tag.
    const link = await view.findByText('p. 1', {}, { timeout: 8000 });
    expect(view.getByText(/The private beta begins on Thursday/)).toBeTruthy();
    expect(view.queryByText(/\[S1\]/)).toBeNull();

    // The citation opens the file at that page, showing its text.
    expect(view.queryByTestId('document-preview-page-1')).toBeNull();
    rtl.fireEvent.press(link);
    const page = await view.findByTestId('document-preview-page-1', {}, { timeout: 8000 });
    expect(rtl.within(page).getByText(BETA_PAGE)).toBeTruthy();
    expect(view.getByText(FILE_NAME)).toBeTruthy();
  }, 90_000);
});
