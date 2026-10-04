/**
 * A person creates a project, opens its Knowledge Base, and adds a document.
 *
 * The first native embedding attempt fails. The real Shared RAG workflow rolls the
 * document back and the screen keeps a visible retry action. The second picker and
 * embedding attempt succeeds, and the document appears in the reactive list.
 *
 * Every Off Grid layer is real: routes, screens, hooks, the Mobile composition root,
 * Shared application policy, extraction, chunking, and persistence adapters. The
 * test controls only device leaves: document picking, files, SQLite, and embedding.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { doMockRealSqlite } from '../../harness/sqliteFake';
import {
  renderProductionApp,
  seedReturningUserWithTextModel,
} from '../../harness/productionNavigation';

jest.unmock('@react-navigation/native');

afterEach(async () => {
  requireRTL().cleanup();
  const { stopMobileApplication } =
    require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
  await stopMobileApplication();
});

describe('project Knowledge Base journey', () => {
  it('shows an embedding failure, then adds and lists the document after retry', async () => {
    const boundary = installNativeBoundary({
      fs: true,
      llama: true,
      ram: {
        platform: 'ios',
        totalBytes: 8 * 1024 * 1024 * 1024,
        availBytes: 6 * 1024 * 1024 * 1024,
      },
    });
    doMockRealSqlite();

    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await seedReturningUserWithTextModel(boundary, { engine: 'llama' });

    const modelPath = `${
      boundary.fs!.DocumentDirectoryPath
    }/all-MiniLM-L6-v2-Q8_0.gguf`;
    boundary.fs!.seedFile(modelPath, 25 * 1024 * 1024);
    boundary.fs!.seedTextFile(
      '/docs/research-notes.txt',
      'Aster Bay opens its public archive every Thursday. '.repeat(40),
    );

    const picker = require('@react-native-documents/picker');
    picker.pick.mockResolvedValue([
      {
        uri: 'file:///docs/research-notes.txt',
        name: 'research-notes.txt',
        type: 'text/plain',
        size: 2_040,
      },
    ]);

    // Native embedding is the uncontrollable device boundary. One OOM followed
    // by success models the recovery that the visible Retry action must drive.
    const nativeEmbeddingContext = await boundary.llama!.module.initLlama({
      model: modelPath,
      embedding: true,
    });
    nativeEmbeddingContext.embedding.mockRejectedValueOnce(
      new Error('OOM: embedding model ran out of memory'),
    );

    const rtl = requireRTL();
    const view = renderProductionApp(rtl);
    const user = rtl.userEvent.setup();

    await user.press(
      await view.findByTestId('projects-tab', undefined, { timeout: 15_000 }),
    );
    await rtl.waitFor(() =>
      expect(view.getByTestId('projects-tab')).toBeSelected(),
    );
    await view.findByTestId('projects-screen');
    await user.press(view.getByText('Create Project'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('project-edit-screen')).toBeVisible(),
    );
    rtl.fireEvent.changeText(
      view.getByTestId('project-edit-name'),
      'Field Research',
    );
    rtl.fireEvent.changeText(
      view.getByTestId('project-edit-system-prompt'),
      'Use only the project sources.',
    );
    rtl.fireEvent.press(view.getByTestId('project-edit-save'));

    const projectRow = await view.findByLabelText('Field Research');
    rtl.fireEvent.press(projectRow);
    await view.findByTestId('project-detail-screen');
    rtl.fireEvent.press(view.getByTestId('project-knowledge-base-open'));

    await view.findByTestId('knowledge-base-screen');
    await view.findByText('No documents yet');
    rtl.fireEvent.press(view.getByText('Add Document'));

    const failure = await view.findByTestId('kb-index-error-card');
    expect(failure).toBeVisible();
    expect(view.getByText(/research-notes\.txt/)).toBeVisible();
    expect(view.getByText(/Embedding failed/)).toBeVisible();
    expect(view.getByText('No documents yet')).toBeVisible();

    rtl.fireEvent.press(view.getByTestId('kb-index-retry'));

    expect(await view.findByText('research-notes.txt')).toBeVisible();
    await rtl.waitFor(() => {
      expect(view.queryByTestId('kb-index-error-card')).toBeNull();
      expect(view.queryByText('No documents yet')).toBeNull();
    });
  });
});
