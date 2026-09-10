type ContentMigrationMarker = 'none' | 'partial' | 'complete';

export interface ContentRecordCounts {
  projects: number;
  conversations: number;
  messages: number;
}

export interface ContentMigrationTargetFacts {
  marker: ContentMigrationMarker;
  counts: ContentRecordCounts;
  attachmentRecoveryComplete: boolean;
}

/** Read-only access to the two Zustand envelopes stored by the released app. */
export interface LegacyContentSourcePort {
  readProjects(): Promise<string | null>;
  readChats(): Promise<string | null>;
}

/** Read-only inspection of the SQLite target and its durable migration marker. */
export interface ContentMigrationTargetPort {
  inspect(): Promise<ContentMigrationTargetFacts>;
}

export type ContentPersistencePreflight =
  | {
      state: 'current';
      reason: 'no-legacy-data' | 'migration-complete';
      legacy: ContentRecordCounts;
      sqlite: ContentRecordCounts;
    }
  | {
      state: 'needed';
      reason:
        | 'legacy-data-found'
        | 'migration-interrupted'
        | 'legacy-attachment-recovery';
      legacy: ContentRecordCounts;
      sqlite: ContentRecordCounts;
    }
  | {
      state: 'blocked';
      reason: 'legacy-source-unreadable' | 'sqlite-target-unreadable';
      detail: string;
      legacy?: ContentRecordCounts;
      sqlite?: ContentRecordCounts;
    };

const EMPTY_COUNTS: ContentRecordCounts = {
  projects: 0,
  conversations: 0,
  messages: 0,
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storedState(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${source} is not a stored state object`);
  }
  const envelope = parsed as Record<string, unknown>;
  const state = envelope.state;
  if (!state || typeof state !== 'object') {
    throw new Error(`${source} has no state object`);
  }
  return state as Record<string, unknown>;
}

function legacyCounts(
  projectsRaw: string | null,
  chatsRaw: string | null,
): ContentRecordCounts {
  let projects = 0;
  let conversations = 0;
  let messages = 0;

  if (projectsRaw !== null) {
    const value = storedState(projectsRaw, 'Legacy project storage').projects;
    if (!Array.isArray(value)) {
      throw new Error('Legacy project storage has no projects array');
    }
    projects = value.length;
  }

  if (chatsRaw !== null) {
    const value = storedState(chatsRaw, 'Legacy chat storage').conversations;
    if (!Array.isArray(value)) {
      throw new Error('Legacy chat storage has no conversations array');
    }
    conversations = value.length;
    for (const [index, conversation] of value.entries()) {
      if (!conversation || typeof conversation !== 'object') {
        throw new Error(`Legacy conversation ${index} is not an object`);
      }
      const rows = (conversation as Record<string, unknown>).messages;
      if (!Array.isArray(rows)) {
        throw new Error(`Legacy conversation ${index} has no messages array`);
      }
      messages += rows.length;
    }
  }

  return { projects, conversations, messages };
}

function hasRows(counts: ContentRecordCounts): boolean {
  return counts.projects + counts.conversations + counts.messages > 0;
}

/**
 * Inspect whether the one-time content migration must run.
 *
 * This function never writes through either port. The later migration command can use this result
 * as its fail-closed gate before it opens one SQLite transaction.
 */
export async function preflightContentPersistenceMigration(input: {
  legacy: LegacyContentSourcePort;
  sqlite: ContentMigrationTargetPort;
}): Promise<ContentPersistencePreflight> {
  let legacy: ContentRecordCounts;
  try {
    const [projects, chats] = await Promise.all([
      input.legacy.readProjects(),
      input.legacy.readChats(),
    ]);
    legacy = legacyCounts(projects, chats);
  } catch (error) {
    return {
      state: 'blocked',
      reason: 'legacy-source-unreadable',
      detail: errorDetail(error),
    };
  }

  let target: ContentMigrationTargetFacts;
  try {
    target = await input.sqlite.inspect();
  } catch (error) {
    return {
      state: 'blocked',
      reason: 'sqlite-target-unreadable',
      detail: errorDetail(error),
      legacy,
    };
  }

  if (target.marker === 'complete') {
    if (hasRows(legacy) && !target.attachmentRecoveryComplete) {
      return {
        state: 'needed',
        reason: 'legacy-attachment-recovery',
        legacy,
        sqlite: target.counts,
      };
    }
    return {
      state: 'current',
      reason: 'migration-complete',
      legacy,
      sqlite: target.counts,
    };
  }
  if (target.marker === 'partial') {
    return {
      state: 'needed',
      reason: 'migration-interrupted',
      legacy,
      sqlite: target.counts,
    };
  }
  if (hasRows(legacy)) {
    return {
      state: 'needed',
      reason: 'legacy-data-found',
      legacy,
      sqlite: target.counts,
    };
  }
  return {
    state: 'current',
    reason: 'no-legacy-data',
    legacy: EMPTY_COUNTS,
    sqlite: target.counts,
  };
}
