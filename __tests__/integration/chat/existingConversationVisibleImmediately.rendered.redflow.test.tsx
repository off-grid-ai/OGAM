import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

describe('opening an existing Mobile chat', () => {
  it('renders canonical project chat content after an application restart', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'ios' });
    const {currentMobileApplicationFixture} = require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const fixture = currentMobileApplicationFixture();
    if (!fixture) throw new Error('Mobile application fixture was not started.');
    const workspace = fixture.application.workspaceContent;

    const projectOutcome = await workspace.execute({
      type: 'create_project',
      name: 'Durable Research',
      description: 'Canonical project proof',
      systemPrompt: 'Keep the proof local.',
    });
    if (!projectOutcome.ok) throw new Error(projectOutcome.failure.message);
    const project = projectOutcome.value.changes.find(
      change => change.kind === 'put' && change.entity === 'project',
    );
    if (!project || project.kind !== 'put' || project.entity !== 'project') {
      throw new Error('The project command did not return its committed project.');
    }

    const conversationOutcome = await workspace.execute({
      type: 'create_conversation',
      title: 'Restart proof',
      modelId: fixture.selectedModelId('text'),
      projectId: project.record.id,
    });
    if (!conversationOutcome.ok) throw new Error(conversationOutcome.failure.message);
    const conversation = conversationOutcome.value.changes.find(
      change => change.kind === 'put' && change.entity === 'conversation',
    );
    if (!conversation || conversation.kind !== 'put' || conversation.entity !== 'conversation') {
      throw new Error('The conversation command did not return its committed conversation.');
    }

    const React = h.React;
    const {ProjectsScreen} = require('../../../src/screens/ProjectsScreen');
    const projects = h.rtl.render(React.createElement(ProjectsScreen, {}));
    await h.rtl.waitFor(() => {
      expect(projects.getByText('Durable Research')).toBeTruthy();
    });
    projects.unmount();

    require('../../harness/chatHarness').routeHolder.params = {
      projectId: project.record.id,
    };
    const {ProjectChatsScreen} = require('../../../src/screens/ProjectChatsScreen');
    const projectChats = h.rtl.render(React.createElement(ProjectChatsScreen, {}));
    await h.rtl.waitFor(() => {
      expect(projectChats.getByText('Restart proof')).toBeVisible();
    });
    projectChats.unmount();

    await fixture.restart();

    const reopenedProjects = h.rtl.render(React.createElement(ProjectsScreen, {}));
    await h.rtl.waitFor(() => {
      expect(reopenedProjects.getByText('Durable Research')).toBeTruthy();
    });
    reopenedProjects.unmount();

    const messageOutcome = await fixture.application.workspaceContent.execute({
      type: 'append_message',
      conversationId: conversation.record.id,
      portable: {role: 'assistant', content: 'The stored reply is ready.'},
    });
    if (!messageOutcome.ok) throw new Error(messageOutcome.failure.message);

    require('../../harness/chatHarness').routeHolder.params = {
      conversationId: conversation.record.id,
    };
    // Hold layout work until after the assertion. This proves that stored content
    // is visible on the first render and does not depend on a deferred frame.
    const deferredFrames: Array<(time: number) => void> = [];
    const originalRequestAnimationFrame = (globalThis as any).requestAnimationFrame;
    (globalThis as any).requestAnimationFrame = (callback: (time: number) => void) => {
      deferredFrames.push(callback);
      return deferredFrames.length;
    };

    try {
      const reopened = h.render();
      await h.rtl.waitFor(() => {
        expect(reopened.getByText('The stored reply is ready.')).toBeVisible();
      });
      expect(reopened.getByTestId('chat-message-list')).toBeVisible();
    } finally {
      (globalThis as any).requestAnimationFrame = originalRequestAnimationFrame;
      await h.rtl.act(async () => {
        deferredFrames.forEach(callback => callback(Date.now()));
      });
    }
  });
});
