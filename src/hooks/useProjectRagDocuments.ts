import { useCallback, useEffect, useState } from 'react';
import type { RagDocument } from '@offgrid/application';
import logger from '../utils/logger';
import { applicationFacade } from '../services/applicationFacade';
import { requireRagSuccess } from '../services/ragOutcome';
import { useRagProjection } from './useApplicationProjection';

interface ProjectRagDocumentsProjection {
  readonly documents: readonly RagDocument[];
  readonly error: string | null;
  retry(): void;
}

/** Load one bounded project read model, then keep rendering its reactive projection. */
export function useProjectRagDocuments(
  projectId: string,
): ProjectRagDocumentsProjection {
  const documents = useRagProjection().documents;
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(current => current + 1), []);

  useEffect(() => {
    let active = true;
    setLoadedProjectId(null);
    setError(null);
    applicationFacade()
      .rag.loadProjectDocuments(projectId)
      .then(outcome => {
        requireRagSuccess(outcome);
        if (active) setLoadedProjectId(projectId);
      })
      .catch(loadError => {
        logger.error(
          `[RAG] Failed to load documents for project ${projectId}`,
          loadError,
        );
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load documents',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [projectId, revision]);

  return {
    documents:
      loadedProjectId === projectId
        ? documents.filter(document => document.projectId === projectId)
        : [],
    error,
    retry,
  };
}
