import { createWorkspaceContentApplication } from '@offgrid/application';
import { installRealSqlite } from '../../harness/sqliteFake';

it('reopens an atomic message-holder removal receipt after commit', async () => {
  installRealSqlite();
  const { MobileWorkspaceContentRepository } =
    require('../../../src/services/adapters/workspaceContent/mobileWorkspaceContentRepository') as typeof import('../../../src/services/adapters/workspaceContent/mobileWorkspaceContentRepository');
  const repository = new MobileWorkspaceContentRepository();
  let id = 0;
  const content = createWorkspaceContentApplication({
    repository,
    newId: () => `content-${++id}`,
    now: () => 1,
  });
  expect((await content.start()).ok).toBe(true);
  expect(
    (await content.execute({ type: 'create_conversation', title: 'Chat' })).ok,
  ).toBe(true);
  const conversationId = content.snapshot().conversations[0].id;
  expect(
    (
      await content.execute({
        type: 'append_message',
        conversationId,
        portable: {
          role: 'user',
          content: [{ type: 'image', contentId: 'shared-1' }],
        },
      })
    ).ok,
  ).toBe(true);
  const messageId = content.snapshot().messages[0].id;
  expect(
    (
      await content.execute({
        type: 'update_message_local',
        messageId,
        local: { contentLocations: [{ index: 0, uri: 'file:///image.png' }] },
      })
    ).ok,
  ).toBe(true);

  const beforeRemoval = content.snapshot();
  const receipt = await repository.removeMessageHolderWithReceipt({
    messageId,
    deletionOperationId: 'shared-delete-1',
    syncId: 'shared-1',
    expectedRevision: beforeRemoval.revision,
    expectedPreimage: beforeRemoval.messages[0].local ?? null,
  });
  expect((await content.refresh()).ok).toBe(true);
  expect(receipt).toEqual(
    expect.objectContaining({
      status: 'removed',
      preimage: {
        contentLocations: [{ contentId: 'shared-1', uri: 'file:///image.png' }],
      },
    }),
  );

  const reopened = new MobileWorkspaceContentRepository();
  await expect(
    reopened.removeMessageHolderWithReceipt({
      messageId,
      deletionOperationId: 'shared-delete-1',
      syncId: 'shared-1',
      expectedRevision: beforeRemoval.revision,
      expectedPreimage: beforeRemoval.messages[0].local ?? null,
    }),
  ).resolves.toEqual(receipt);
  expect((await reopened.read()).messages[0].local?.contentLocations).toEqual(
    [],
  );
  await expect(
    reopened.restoreMessageHolderFromReceipt({
      messageId,
      deletionOperationId: 'shared-delete-1',
      syncId: 'shared-1',
      preimage: receipt.preimage,
    }),
  ).resolves.toEqual(expect.objectContaining({ ok: true, status: 'restored' }));
  await expect(
    reopened.restoreMessageHolderFromReceipt({
      messageId,
      deletionOperationId: 'shared-delete-1',
      syncId: 'shared-1',
      preimage: receipt.preimage,
    }),
  ).resolves.toEqual(
    expect.objectContaining({ ok: true, status: 'already_restored' }),
  );

  const reopenedContent = createWorkspaceContentApplication({
    repository: reopened,
    newId: () => `reopened-${++id}`,
    now: () => 2,
  });
  expect((await reopenedContent.start()).ok).toBe(true);
  const beforeSecond = reopenedContent.snapshot();
  const secondReceipt = await reopened.removeMessageHolderWithReceipt({
    messageId,
    deletionOperationId: 'shared-delete-2',
    syncId: 'shared-1',
    expectedRevision: beforeSecond.revision,
    expectedPreimage: beforeSecond.messages[0].local ?? null,
  });
  expect((await reopenedContent.refresh()).ok).toBe(true);
  expect(
    (
      await reopenedContent.execute({
        type: 'create_conversation',
        title: 'Other',
      })
    ).ok,
  ).toBe(true);
  await expect(
    reopened.restoreMessageHolderFromReceipt({
      messageId,
      deletionOperationId: 'shared-delete-2',
      syncId: 'shared-1',
      preimage: secondReceipt.preimage,
    }),
  ).resolves.toEqual(expect.objectContaining({ ok: true, status: 'restored' }));
  expect((await reopenedContent.refresh()).ok).toBe(true);
  expect(
    (
      await reopenedContent.execute({
        type: 'create_conversation',
        title: 'Later',
      })
    ).ok,
  ).toBe(true);
  await expect(
    reopened.restoreMessageHolderFromReceipt({
      messageId,
      deletionOperationId: 'shared-delete-2',
      syncId: 'shared-1',
      preimage: secondReceipt.preimage,
    }),
  ).resolves.toEqual(
    expect.objectContaining({ ok: true, status: 'already_restored' }),
  );

  expect(
    (
      await reopenedContent.execute({
        type: 'append_message',
        conversationId,
        messageId: 'legacy-message',
        portable: {
          role: 'user',
          content: [{ type: 'image', contentId: 'shared-legacy' }],
        },
      })
    ).ok,
  ).toBe(true);
  const { openWorkspaceContentDatabase } =
    require('../../../src/services/adapters/workspaceContent/workspaceContentDatabase') as typeof import('../../../src/services/adapters/workspaceContent/workspaceContentDatabase');
  openWorkspaceContentDatabase().executeSync(
    `INSERT INTO workspace_content_local_message_state (message_id, state_json)
     VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET state_json = excluded.state_json`,
    [
      'legacy-message',
      JSON.stringify({
        contentLocations: [{ index: 0, uri: 'file:///legacy.png' }],
      }),
    ],
  );
  const legacyBefore = await reopened.read();
  const legacyReceipt = await reopened.removeMessageHolderWithReceipt({
    messageId: 'legacy-message',
    deletionOperationId: 'legacy-delete',
    syncId: 'shared-legacy',
    expectedRevision: legacyBefore.revision,
    expectedPreimage:
      legacyBefore.messages.find(message => message.id === 'legacy-message')
        ?.local ?? null,
  });
  expect(legacyReceipt.preimage).toEqual({
    contentLocations: [{ index: 0, uri: 'file:///legacy.png' }],
  });
  const legacyReopened = new MobileWorkspaceContentRepository();
  await expect(
    legacyReopened.removeMessageHolderWithReceipt({
      messageId: 'legacy-message',
      deletionOperationId: 'legacy-delete',
      syncId: 'shared-legacy',
      expectedRevision: legacyBefore.revision,
      expectedPreimage: legacyReceipt.preimage,
    }),
  ).resolves.toEqual(legacyReceipt);
  await expect(
    legacyReopened.restoreMessageHolderFromReceipt({
      messageId: 'legacy-message',
      deletionOperationId: 'legacy-delete',
      syncId: 'shared-legacy',
      preimage: legacyReceipt.preimage,
    }),
  ).resolves.toEqual(expect.objectContaining({ ok: true, status: 'restored' }));
  await reopenedContent.stop();
  await content.stop();
});
