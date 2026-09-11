import { useCallback, useRef, useState } from 'react';
import { modelsFailureMessage } from '@offgrid/application';
import { applicationFacade } from '../services/applicationFacade';
import { useModelsProjection } from './useApplicationProjection';

export interface EnabledToolsSetting {
  /** The committed enabled-tool ids, read from the Shared Models projection. */
  enabledTools: string[];
  /** A save is in flight. */
  pending: boolean;
  /** The last save failure, already rendered as user-facing text, or null. */
  failure: string | null;
  /** Toggle one tool id and settle the typed Shared outcome. */
  toggleTool: (toolId: string) => Promise<void>;
}

/** Narrow the untyped committed settings record to the enabled-tool id list. */
function readEnabledTools(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * The one Mobile seam for reading and changing `enabledTools`.
 *
 * READ: the Shared committed Models projection, never a store mirror. WRITE: the Shared settings
 * command, awaited, with its typed outcome settled into `failure` so the calling surface can render
 * it. No surface calls `useAppStore.updateSettings` for this key: a second writer would commit a
 * value the settings command never planned, never published to sync, and never diffed.
 */
export function useEnabledToolsSetting(): EnabledToolsSetting {
  const enabledTools = readEnabledTools(useModelsProjection().settings.enabledTools);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const toggleTool = useCallback(async (toolId: string): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      // Read the committed value at commit time, not at render time: two quick taps must not
      // plan the second patch from a list the first one already replaced.
      const current = readEnabledTools(
        applicationFacade().models.snapshot().settings.enabledTools,
      );
      const next = current.includes(toolId)
        ? current.filter(id => id !== toolId)
        : [...current, toolId];
      const outcome = await applicationFacade().models.settings.save({
        origin: 'local',
        patch: { enabledTools: next },
      });
      if (!outcome.ok) {
        setFailure(modelsFailureMessage(outcome.failure));
      } else if (outcome.value.syncFailure) {
        setFailure(
          `Saved on this device. ${modelsFailureMessage(outcome.value.syncFailure)}`,
        );
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, []);

  return { enabledTools, pending, failure, toggleTool };
}
