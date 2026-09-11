/**
 * A person can create a project, start and reopen its chat, then delete the
 * project without leaving a stale project label on the chat.
 *
 * The real project, chat, and navigation screens run over the real Mobile
 * application composition. Only SQLite and HTTP are supplied at their
 * external boundaries. Shared Workspace Content owns every durable project
 * and conversation transition in this journey.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';

jest.unmock('@react-navigation/native');

describe('Mobile project workspace journey', () => {
  beforeEach(async () => {
    const boundary = installNativeBoundary({ fs: true });
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
      id: 'project-journey-model',
      name: 'Project Journey Model',
    });
  });

  afterEach(async () => {
    requireRTL().cleanup();
    const { stopMobileApplication } =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    await stopMobileApplication();
  });

  it('creates, reopens, and unfiles a chat when its project is deleted', async () => {
    const rtl = requireRTL();
    const { renderProductionApp } =
      require('../../harness/productionNavigation') as typeof import('../../harness/productionNavigation');
    const view = renderProductionApp(rtl);

    await view.findByTestId('home-screen', {}, { timeout: 20_000 });
    rtl.fireEvent.press(view.getByTestId('projects-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('projects-tab')).toBeSelected(),
    );
    const emptyProjects = rtl.within(view.getByTestId('projects-screen'));
    expect(emptyProjects.getByText('No Projects Yet')).toBeTruthy();
    rtl.fireEvent.press(emptyProjects.getByText('New'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('project-edit-screen')).toBeVisible(),
    );

    rtl.fireEvent.changeText(
      view.getByTestId('project-edit-name'),
      'Field Research',
    );
    rtl.fireEvent.changeText(
      view.getByTestId('project-edit-description'),
      'Notes from local interviews',
    );
    rtl.fireEvent.changeText(
      view.getByTestId('project-edit-system-prompt'),
      'Keep each finding linked to its source.',
    );
    rtl.fireEvent.press(view.getByTestId('project-edit-save'));

    await rtl.waitFor(() =>
      expect(view.getByTestId('projects-tab')).toBeSelected(),
    );
    const projectList = rtl.within(view.getByTestId('projects-screen'));
    expect(projectList.getByText('Field Research')).toBeTruthy();
    expect(projectList.getByText('Notes from local interviews')).toBeTruthy();
    expect(projectList.getByText('0')).toBeTruthy();

    rtl.fireEvent.press(projectList.getByText('Field Research'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('project-detail-screen')).toBeVisible(),
    );
    expect(
      rtl
        .within(view.getByTestId('project-detail-screen'))
        .getByText('No chats yet'),
    ).toBeTruthy();

    rtl.fireEvent.press(view.getByTestId('project-start-chat'));
    await rtl.waitFor(() => expect(view.getByText('New Chat')).toBeVisible());

    rtl.fireEvent.press(view.getByLabelText('Back'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('project-detail-screen')).toBeVisible(),
    );
    const projectDetail = view.getByTestId('project-detail-screen');
    const createdChat = rtl.within(projectDetail).getByText('New Conversation');
    expect(createdChat).toBeTruthy();

    rtl.fireEvent.press(createdChat);
    await rtl.waitFor(() => expect(view.getByText('New Chat')).toBeVisible());
    rtl.fireEvent.press(view.getByLabelText('Back'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('project-detail-screen')).toBeVisible(),
    );
    expect(
      rtl
        .within(await view.findByTestId('project-detail-screen'))
        .getByText('New Conversation'),
    ).toBeTruthy();

    rtl.fireEvent.press(view.getByText('Delete Project'));
    expect(
      await view.findByText(
        'Delete "Field Research"? This will not delete the chats associated with this project.',
      ),
    ).toBeTruthy();
    rtl.fireEvent.press(view.getByText('Delete'));

    await rtl.waitFor(() =>
      expect(view.getByTestId('projects-tab')).toBeSelected(),
    );
    expect(
      rtl
        .within(view.getByTestId('projects-screen'))
        .getByText('No Projects Yet'),
    ).toBeTruthy();
    expect(view.queryByText('Field Research')).toBeNull();

    rtl.fireEvent.press(view.getByTestId('chats-tab'));
    await rtl.waitFor(() =>
      expect(view.getByTestId('chats-tab')).toBeSelected(),
    );
    expect(await view.findByText('New Conversation')).toBeTruthy();
    expect(view.queryByText('Field Research')).toBeNull();
  });
});
