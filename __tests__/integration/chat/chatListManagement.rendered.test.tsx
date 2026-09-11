/**
 * Search and bulk delete run from the real Chats route over the real Shared
 * workspace-content projection and durable conversation deletion workflow.
 * Only native device services and SQLite are supplied at their boundaries.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

describe('Mobile chat list management', () => {
  let boundary: ReturnType<typeof installNativeBoundary>;

  beforeEach(async () => {
    boundary = installNativeBoundary({ fs: true });
    const { doMockRealSqlite } =
      require('../../harness/sqliteFake') as typeof import('../../harness/sqliteFake');
    doMockRealSqlite();

    const AsyncStorage =
      require('@react-native-async-storage/async-storage').default ??
      require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();

    const { seedReturningUserWithTextModel } =
      require('../../harness/productionNavigation') as typeof import('../../harness/productionNavigation');
    await seedReturningUserWithTextModel(boundary, {
      id: 'chat-list-management-model',
      name: 'Chat List Management Model',
    });
  });

  afterEach(async () => {
    requireRTL().cleanup();
    const { stopMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    await stopMobileApplication();
  });

  it('searches and bulk deletes chats from the canonical projection', async () => {
    const rtl = requireRTL();
    const { renderProductionApp } =
      require('../../harness/productionNavigation') as typeof import('../../harness/productionNavigation');
    const view = renderProductionApp(rtl);

    await view.findByTestId('home-screen', {}, { timeout: 20_000 });
    const { getMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    const workspaceContent = getMobileApplication().workspaceContent;

    const createConversation = async (title: string) => {
      const outcome = await workspaceContent.execute({
        type: 'create_conversation',
        title,
      });
      if (!outcome.ok) throw new Error(outcome.failure.message);
      const change = outcome.value.changes.find(
        item => item.kind === 'put' && item.entity === 'conversation',
      );
      if (!change || change.kind !== 'put' || change.entity !== 'conversation') {
        throw new Error('The conversation command did not publish its record.');
      }
      return change.record.id;
    };

    const planningId = await createConversation('Planning notes');
    const researchId = await createConversation('Research review');
    const gallery = getMobileApplication().generatedImages;
    if (!gallery || !boundary.fs) {
      throw new Error('The generated-image boundary was not composed.');
    }
    const planningImagePath = `${boundary.fs.DocumentDirectoryPath}/generated_images/planning.png`;
    boundary.fs.seedFile(planningImagePath, 1024);
    const image = await gallery.create({
      id: 'planning-image',
      contentId: 'planning-image',
      conversationId: planningId,
      prompt: 'Planning diagram',
      width: 512,
      height: 512,
      steps: 8,
      seed: 42,
      modelId: 'image-model',
      createdAt: '2026-09-09T00:00:00.000Z',
      local: { path: planningImagePath, fileName: 'planning.png' },
    });
    if (!image.ok) throw new Error(image.failure.message);

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chats-tab')).toBeSelected(),
    );
    const chats = rtl.within(view.getByTestId('chats-screen'));
    await rtl.waitFor(() => {
      expect(chats.getByText('Planning notes')).toBeTruthy();
      expect(chats.getByText('Research review')).toBeTruthy();
    });

    rtl.fireEvent.changeText(chats.getByTestId('chat-search'), 'research');
    expect(chats.getByText('Research review')).toBeTruthy();
    expect(chats.queryByText('Planning notes')).toBeNull();
    rtl.fireEvent.changeText(chats.getByTestId('chat-search'), 'missing');
    expect(chats.getByTestId('chat-search-empty')).toBeTruthy();
    rtl.fireEvent.press(chats.getByTestId('chat-search-clear'));

    rtl.fireEvent.press(chats.getByTestId('chat-bulk-delete-action'));
    rtl.fireEvent.press(chats.getByTestId(`conversation-select-${planningId}`));
    rtl.fireEvent.press(chats.getByTestId(`conversation-select-${researchId}`));
    rtl.fireEvent.press(chats.getByLabelText('Delete 2 selected chats'));

    expect(
      await view.findByText(
        'Delete 2 selected chats? This will also delete all images generated in the selected chats.',
      ),
    ).toBeTruthy();
    boundary.diffusion.holdNextDelete();
    rtl.fireEvent.press(view.getByText('Delete'));

    await rtl.waitFor(() => expect(boundary.diffusion.deleteHeld()).toBe(true));
    expect(
      rtl
        .within(chats.getByTestId(`conversation-select-${planningId}`))
        .getByTestId('chat-delete-loading'),
    ).toBeTruthy();
    expect(
      rtl
        .within(chats.getByTestId(`conversation-select-${researchId}`))
        .queryByTestId('chat-delete-loading'),
    ).toBeNull();
    expect(chats.getByTestId('chat-bulk-delete-action')).toBeDisabled();
    boundary.diffusion.releaseDelete();

    await rtl.waitFor(() => {
      expect(workspaceContent.snapshot().conversations).toHaveLength(0);
      expect(chats.getByText('No Chats Yet')).toBeTruthy();
    });
  });
});
