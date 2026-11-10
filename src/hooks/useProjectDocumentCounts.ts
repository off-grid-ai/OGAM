import { useEffect, useState } from 'react';
import { knowledgeBase } from '../services/rag';

/**
 * How many knowledge documents each project holds, read again whenever `active` turns true (the
 * Projects tab coming into view), so a document added inside a project shows on its row.
 */
export function useProjectDocumentCounts(projectIds: readonly string[], active: boolean): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = projectIds.join('|');
  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    Promise.all(
      projectIds.map(async id => [id, (await knowledgeBase.getDocumentsByProject(id)).length] as const),
    )
      .then(entries => { if (!cancelled) setCounts(Object.fromEntries(entries)); })
      .catch(() => { /* the rows show chats and last use without a document count */ });
    return () => { cancelled = true; };
    // `key` stands for projectIds: a new array of the same ids must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return counts;
}
