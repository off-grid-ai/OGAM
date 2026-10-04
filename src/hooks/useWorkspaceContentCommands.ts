import { useCallback, useMemo } from 'react';
import type {
  WorkspaceContentCommand,
  WorkspaceContentFailure,
  WorkspaceContentOutcome,
} from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';

/**
 * Renders a Shared workspace-content failure as one line a person can act on.
 *
 * The failure union is owned by Shared, so every surface that shows one shows the same sentence
 * for the same kind rather than re-deriving wording per screen.
 */
export function describeWorkspaceContentFailure(
  failure: WorkspaceContentFailure,
): string {
  switch (failure.kind) {
    case 'not_ready':
      return `Workspace content is not ready yet. ${failure.message}`;
    case 'invalid_input':
      return failure.message;
    case 'not_found':
      return `That ${failure.entity.replace('_', ' ')} no longer exists. ${failure.message}`;
    case 'conflict':
      return `This was changed somewhere else. ${failure.message}`;
    case 'persistence':
      return `Could not save the change. ${failure.message}`;
  }
}

export interface WorkspaceContentCommands {
  /** Sends a typed intent to the Shared facade and returns its outcome unchanged. */
  execute(command: WorkspaceContentCommand): Promise<WorkspaceContentOutcome>;
}

/**
 * The write half of the workspace-content binding, beside `useWorkspaceContentProjection`'s reads.
 *
 * It forwards typed intents to the Shared `WorkspaceContentFacade` and returns the outcome as-is:
 * no local mirror of truth, no swallowed failure. The caller renders the failure and decides what
 * the surface does next.
 */
export function useWorkspaceContentCommands(): WorkspaceContentCommands {
  const execute = useCallback(
    (command: WorkspaceContentCommand) =>
      applicationFacade().workspaceContent.execute(command),
    [],
  );
  return useMemo(() => ({ execute }), [execute]);
}
