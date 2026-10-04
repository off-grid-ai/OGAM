import { operationWins, type Op } from '@offgrid/sync';
import { open } from '@op-engineering/op-sqlite';
import type {
  DeletionContinuation,
  DeletionContinuationResolverPort,
  DeletionRecoveryIdentity,
} from '@offgrid/application';

type OpRow = {
  op_id: string;
  kind: string;
  lamport: number;
  device_id: string;
  ts: number;
};

/** Read-only validation against the durable Mobile Sync op log. */
function mobilePersistedWinningOperationStatus(input: {
  entity: 'project' | 'conversation';
  entityId: string;
  operationId: string;
}): 'current' | 'superseded' | 'not_ready' {
  let rows: OpRow[];
  try {
    rows = open({ name: 'offgrid-sync.sqlite' }).executeSync(
      `SELECT op_id, kind, lamport, device_id, ts FROM sync_ops
       WHERE entity = ? AND entity_id = ?`,
      [input.entity, input.entityId],
    ).rows as unknown as OpRow[];
  } catch (cause) {
    throw Object.assign(
      new Error('Remote deletion winner history is unavailable.'),
      { cause },
    );
  }
  let winner: Op | undefined;
  for (const row of rows) {
    if (row.kind !== 'put' && row.kind !== 'delete') {
      throw new Error(`Sync operation ${row.op_id} has an invalid kind.`);
    }
    const operation: Op = {
      opId: row.op_id,
      entity: input.entity,
      entityId: input.entityId,
      kind: row.kind,
      lamport: row.lamport,
      deviceId: row.device_id,
      ts: row.ts,
    };
    if (!winner || operationWins(operation, winner)) winner = operation;
  }
  if (!winner) return 'not_ready';
  return winner.opId === input.operationId && winner.kind === 'delete'
    ? 'current'
    : 'superseded';
}

/** Restart resolver backed only by the hydrated durable Sync log. */
export const mobileDeletionContinuationResolver: DeletionContinuationResolverPort =
  {
    async resolve(identity: DeletionRecoveryIdentity) {
      const expectedWinner = Object.freeze({
        operationId: identity.remoteOperationId,
        entity: identity.entity,
        entityId: identity.entityId,
      });
      const status = (): 'current' | 'superseded' | 'not_ready' =>
        mobilePersistedWinningOperationStatus({
          entity: identity.entity,
          entityId: identity.entityId,
          operationId: identity.remoteOperationId,
        });
      try {
        const initial = status();
        if (initial !== 'current') return { status: initial };
        const isCurrent = (): boolean => status() === 'current';
        const continuation: DeletionContinuation = Object.freeze({
          ...expectedWinner,
          expectedWinner,
          isCurrent: () => isCurrent(),
        });
        return { status: 'current', continuation };
      } catch {
        return { status: 'not_ready' };
      }
    },
  };
