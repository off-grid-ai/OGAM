import {
  legacyTurns,
  resolveLegacyProjectId,
} from '../../../../src/services/migrations/legacyMessageProjection';

describe('legacy content project references', () => {
  it('keeps a project link only when its project is available', () => {
    const availableProjectIds = new Set(['project-present']);

    expect(
      resolveLegacyProjectId('project-present', availableProjectIds),
    ).toBe('project-present');
    expect(resolveLegacyProjectId('project-missing', availableProjectIds)).toBe(
      null,
    );
    expect(resolveLegacyProjectId(undefined, availableProjectIds)).toBe(null);
  });

  it('does not restore a missing project link through migrated chat turns', () => {
    const messages = [
      {
        id: 'message-1',
        role: 'user',
        content: 'Saved conversation',
        timestamp: '2026-09-09T00:00:00.000Z',
      },
    ];

    const result = legacyTurns({
      conversationId: 'conversation-1',
      projectId: resolveLegacyProjectId(
        'project-missing',
        new Set<string>(),
      ),
      messages,
      now: '2026-09-09T00:00:00.000Z',
    });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).not.toHaveProperty('projectId');
    expect(result.turns[0]?.conversationId).toBe('conversation-1');
    expect(result.turns[0]?.userMessageId).toBe('message-1');
  });
});
