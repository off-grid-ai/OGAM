import type { KnowledgeDocumentSnapshot, RagFailure } from '@offgrid/application';
import { applicationFacade } from './applicationFacade';

/**
 * The replication document stream, with a truncated read REFUSED rather than mistaken for the end.
 *
 * `rag.sync.allDocuments()` is a stream, not a command, so it is the one member of that namespace
 * that does not return an `Outcome`: a failure part-way through ENDS the iteration and is reported
 * on `rag.events` as `sync_all_documents`. A caller that simply `for await`s it therefore cannot
 * tell "that was all of them" from "the read broke after three", and any caller that treats the
 * result as the complete set - a backfill, a full-state push - would publish a partial state as if
 * it were the whole one. That is the failure being converted into a success-shaped value.
 *
 * This watches that one event for the duration of the iteration and rejects with the typed
 * failure's own message when it arrives, so a partial read fails its caller instead of passing as
 * a complete one. Callers that WANT the partial set (because over-reading is the safe direction)
 * should keep using the facade stream directly and say why.
 */
export async function* replicatedRagDocuments(): AsyncGenerator<KnowledgeDocumentSnapshot> {
  const terminal: { failure: RagFailure | null } = { failure: null };
  const release = applicationFacade().rag.events(event => {
    if (
      event.type === 'operation_failed' &&
      event.operation === 'sync_all_documents'
    ) {
      terminal.failure ??= event.failure;
    }
  });
  try {
    for await (const document of applicationFacade().rag.sync.allDocuments()) {
      // The event lands before the iterator ends, so stop rather than yield a document read after
      // the stream had already given up.
      if (terminal.failure) break;
      yield document;
    }
  } finally {
    release();
  }
  // Reached only when the consumer drained the stream: a consumer that broke out early gets its
  // own control flow back, not someone else's error.
  if (terminal.failure) throw new Error(terminal.failure.message);
}
