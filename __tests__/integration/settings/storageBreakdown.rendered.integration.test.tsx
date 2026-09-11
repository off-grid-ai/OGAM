/**
 * Storage is reached through production navigation and reads the real Shared
 * workspace projection. Native filesystem and SQLite are the only faked
 * external boundaries.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import {
  renderProductionApp,
  seedReturningUserWithTextModel,
} from '../../harness/productionNavigation';

jest.unmock('@react-navigation/native');

describe('storage settings journey', () => {
  afterEach(async () => {
    requireRTL().cleanup();
    const { stopMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    await stopMobileApplication();
  });

  it('shows the complete breakdown without duplicate model lists and opens Auto Setup', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const { doMockRealSqlite } =
      require('../../harness/sqliteFake') as typeof import('../../harness/sqliteFake');
    doMockRealSqlite();

    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
    await seedReturningUserWithTextModel(boundary, {
      id: 'storage-breakdown-model',
      name: 'Storage Breakdown Model',
    });

    const rtl = requireRTL();
    const view = renderProductionApp(rtl);
    await view.findByTestId('home-screen', {}, { timeout: 20_000 });

    const { getMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    const project = await getMobileApplication().workspaceContent.execute({
      type: 'create_project',
      name: 'Storage Project',
      description: 'Project count proof',
      systemPrompt: 'Keep this project local.',
    });
    if (!project.ok) throw new Error(project.failure.message);

    rtl.fireEvent.press(view.getByTestId('settings-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('settings-tab')).toBeSelected(),
    );
    rtl.fireEvent.press(await view.findByText('Storage'));

    const storage = rtl.within(
      await view.findByTestId('storage-settings-screen'),
    );
    expect(storage.getByText('LLM Models')).toBeVisible();
    expect(storage.getByText('Image Models')).toBeVisible();
    expect(storage.getByText('Transcription Models')).toBeVisible();
    expect(storage.getByText('Speech Models')).toBeVisible();
    expect(storage.getByText('Model Storage')).toBeVisible();
    expect(storage.getByText('Conversations')).toBeVisible();
    expect(storage.getByText('Projects')).toBeVisible();
    expect(storage.getByText('Orphaned Files')).toBeVisible();
    expect(storage.queryByText('Storage Breakdown Model')).toBeNull();

    rtl.fireEvent.press(storage.getByTestId('storage-auto-setup'));
    expect(
      await view.findByTestId('auto-setup-screen', {}, { timeout: 20_000 }),
    ).toBeVisible();
  });
});
