import type { ContentPersistencePreflight } from './contentPersistencePreflight';

type ActiveMigrationPhase =
  | 'preparing'
  | 'copying'
  | 'verifying'
  | 'committing';

interface MigrationStateBase {
  runId: string;
  sequence: number;
  progress: number;
  retryEligible: boolean;
}

export type ContentMigrationState =
  | (MigrationStateBase & {
      state: 'idle';
      progress: 0;
      retryEligible: false;
      resumeRequired: boolean;
    })
  | (MigrationStateBase & {
      state: 'preparing';
      retryEligible: false;
    })
  | (MigrationStateBase & {
      state: 'copying';
      retryEligible: false;
      copied: number;
      total: number;
    })
  | (MigrationStateBase & {
      state: 'verifying';
      retryEligible: false;
    })
  | (MigrationStateBase & {
      state: 'committing';
      retryEligible: false;
    })
  | (MigrationStateBase & {
      state: 'completed';
      progress: 1;
      retryEligible: false;
    })
  | (MigrationStateBase & {
      state: 'failed';
      failedFrom: ActiveMigrationPhase;
      error: string;
    });

interface MigrationEventBase {
  runId: string;
  sequence: number;
}

export type ContentMigrationEvent =
  | (MigrationEventBase & { type: 'start' })
  | (MigrationEventBase & { type: 'prepared' })
  | (MigrationEventBase & {
      type: 'copy-progress';
      copied: number;
      total: number;
    })
  | (MigrationEventBase & { type: 'copied' })
  | (MigrationEventBase & { type: 'verified' })
  | (MigrationEventBase & { type: 'committed' })
  | (MigrationEventBase & { type: 'failed'; error: string })
  | (MigrationEventBase & { type: 'retry'; nextRunId: string });

const PREPARING_PROGRESS = 0.05;
const COPYING_START_PROGRESS = 0.1;
const COPYING_END_PROGRESS = 0.75;
const VERIFYING_PROGRESS = 0.8;
const COMMITTING_PROGRESS = 0.95;

function bounded(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.min(maximum, Math.max(minimum, value));
}

function activePhase(state: ContentMigrationState): ActiveMigrationPhase | null {
  switch (state.state) {
    case 'preparing':
    case 'copying':
    case 'verifying':
    case 'committing':
      return state.state;
    default:
      return null;
  }
}

function retryFailedMigration(
  state: Extract<ContentMigrationState, { state: 'failed' }>,
  event: ContentMigrationEvent,
): ContentMigrationState {
  if (
    event.type !== 'retry' ||
    !state.retryEligible ||
    event.nextRunId.length === 0
  ) {
    return state;
  }
  return {
    state: 'preparing',
    runId: event.nextRunId,
    sequence: 0,
    progress: PREPARING_PROGRESS,
    retryEligible: false,
  };
}

function failActiveMigration(
  state: ContentMigrationState,
  event: Extract<ContentMigrationEvent, { type: 'failed' }>,
): ContentMigrationState {
  const failedFrom = activePhase(state);
  if (failedFrom === null || event.error.length === 0) {
    return state;
  }
  return {
    state: 'failed',
    runId: state.runId,
    sequence: event.sequence,
    progress: state.progress,
    retryEligible: true,
    failedFrom,
    error: event.error,
  };
}

/**
 * Create the restart state from read-only preflight facts.
 *
 * A partial target starts idle and must run the full verified transaction again. A durable complete
 * marker has terminal precedence over legacy rows that may still await later cleanup.
 */
export function createContentMigrationState(
  preflight: ContentPersistencePreflight,
  runId: string,
): ContentMigrationState {
  if (preflight.state === 'current') {
    return {
      state: 'completed',
      runId,
      sequence: 0,
      progress: 1,
      retryEligible: false,
    };
  }

  if (preflight.state === 'blocked') {
    return {
      state: 'failed',
      runId,
      sequence: 0,
      progress: 0,
      retryEligible: false,
      failedFrom: 'preparing',
      error: preflight.detail,
    };
  }

  return {
    state: 'idle',
    runId,
    sequence: 0,
    progress: 0,
    retryEligible: false,
    resumeRequired: preflight.reason === 'migration-interrupted',
  };
}

/** Pure transition function. Invalid, duplicate, out-of-order, and stale-run events are ignored. */
export function reduceContentMigrationState(
  state: ContentMigrationState,
  event: ContentMigrationEvent,
): ContentMigrationState {
  if (
    event.runId !== state.runId ||
    event.sequence <= state.sequence ||
    state.state === 'completed'
  ) {
    return state;
  }

  if (state.state === 'failed') {
    return retryFailedMigration(state, event);
  }

  if (event.type === 'failed') {
    return failActiveMigration(state, event);
  }

  if (state.state === 'idle' && event.type === 'start') {
    return {
      state: 'preparing',
      runId: state.runId,
      sequence: event.sequence,
      progress: PREPARING_PROGRESS,
      retryEligible: false,
    };
  }

  if (state.state === 'preparing' && event.type === 'prepared') {
    return {
      state: 'copying',
      runId: state.runId,
      sequence: event.sequence,
      progress: COPYING_START_PROGRESS,
      retryEligible: false,
      copied: 0,
      total: 0,
    };
  }

  if (state.state === 'copying' && event.type === 'copy-progress') {
    const total = Math.max(0, Math.floor(bounded(event.total, 0, Number.MAX_SAFE_INTEGER)));
    const copied = Math.floor(bounded(event.copied, 0, total));
    const fraction = total === 0 ? 0 : copied / total;
    return {
      ...state,
      sequence: event.sequence,
      progress:
        COPYING_START_PROGRESS +
        fraction * (COPYING_END_PROGRESS - COPYING_START_PROGRESS),
      copied,
      total,
    };
  }

  if (state.state === 'copying' && event.type === 'copied') {
    return {
      state: 'verifying',
      runId: state.runId,
      sequence: event.sequence,
      progress: VERIFYING_PROGRESS,
      retryEligible: false,
    };
  }

  if (state.state === 'verifying' && event.type === 'verified') {
    return {
      state: 'committing',
      runId: state.runId,
      sequence: event.sequence,
      progress: COMMITTING_PROGRESS,
      retryEligible: false,
    };
  }

  if (state.state === 'committing' && event.type === 'committed') {
    return {
      state: 'completed',
      runId: state.runId,
      sequence: event.sequence,
      progress: 1,
      retryEligible: false,
    };
  }

  return state;
}
