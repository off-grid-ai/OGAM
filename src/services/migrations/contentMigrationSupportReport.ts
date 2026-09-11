import type {ContentMigrationState} from './contentMigrationStateMachine';

export interface ContentMigrationSupportContext {
  appBuild: string;
  platform: string;
}

function errorCategory(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes('foreign key constraint')) {
    return 'database-foreign-key';
  }
  if (normalized.includes('constraint')) return 'database-constraint';
  if (normalized.includes('sqlite') || normalized.includes('database')) {
    return 'database-operation';
  }
  if (normalized.includes('legacy')) return 'legacy-source';
  if (normalized.includes('verification')) return 'verification';
  return 'unclassified';
}

/**
 * Build an allow-listed migration report. Raw errors can contain record identifiers or future
 * adapter details, so they are classified here and never copied into a support message.
 */
export function contentMigrationSupportReport(
  migration: ContentMigrationState,
  context: ContentMigrationSupportContext,
): string {
  const lines = [
    'Off Grid AI Mobile workspace update diagnostics',
    `App: ${context.appBuild}`,
    `Platform: ${context.platform}`,
    `State: ${migration.state}`,
    `Progress: ${Math.round(migration.progress * 100)}%`,
    `Retry available: ${migration.retryEligible ? 'yes' : 'no'}`,
    `Run: ${migration.runId}`,
    `Sequence: ${migration.sequence}`,
  ];

  if (migration.state === 'copying') {
    lines.push(`Records copied: ${migration.copied} of ${migration.total}`);
  }
  if (migration.state === 'failed') {
    lines.push(`Failed during: ${migration.failedFrom}`);
    lines.push(`Error category: ${errorCategory(migration.error)}`);
  }

  lines.push(
    '',
    'This report contains update state and record counts only.',
    'It does not include message text, project details, conversation titles, prompts, or files.',
  );
  return lines.join('\n');
}
