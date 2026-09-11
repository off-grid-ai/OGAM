/**
 * The transport-free half of the received-media release seam.
 *
 * `receivedMediaRelease` is installed by `pro/sync` only once a Shared File SESSION is running,
 * which is after the Shared root has already run durable deletion recovery. A pending provenance
 * release therefore had no owner at the moment it was settled, threw, failed `start()`, and the
 * app never reached running - so the session that would have installed the port never started. A
 * cold start with one pending provenance intent could not converge.
 *
 * This port breaks that cycle without weakening the byte-ownership rule. It admits the release
 * DURABLY and LOCALLY - a tombstone that records "these bytes are no longer claimed by this
 * device's gallery" - and nothing else. It unlinks no file and speaks to no peer. Network delivery
 * of the release stays with the Shared File owner and stays post-running: the admitted tombstones
 * are drained through that owner once a session is up.
 *
 * It is REQUIRED, not optional: it is constructed by the composition root before the application
 * starts, so it is always present when recovery settles an intent.
 */

/** One durably admitted provenance release, kept until the Shared File owner has taken it. */
export interface ReceivedMediaReleaseAdmission {
  /** The gallery record id whose bytes were released. Stable across restarts. */
  readonly id: string;
  /** The on-device path the removed record held. */
  readonly path: string;
  readonly authority:
    | 'local_unconditional'
    | 'remote_conditional'
    | 'legacy_unknown';
  /** Serializable S15 cleanup identity. Required for conditional remote deletion. */
  readonly continuation?: {
    readonly operationId: string;
    readonly entity: 'project' | 'conversation';
    readonly entityId: string;
    readonly expectedWinner: {
      readonly operationId: string;
      readonly entity: 'project' | 'conversation';
      readonly entityId: string;
    };
    readonly phase: import('@offgrid/application').ProjectDeletionPhase |
      import('@offgrid/application').ConversationDeletionPhase;
  };
}

export interface ReceivedMediaReleaseAdmissionPort {
  /**
   * Record the release durably and resolve ONLY once it is proven persisted.
   *
   * A void mutation - a write that changed no row and that a read-back cannot see - must reject.
   * Resolving on an unverified write would let the caller drop its intent while nothing on disk
   * remembers the release, which is the orphan this whole seam exists to prevent.
   */
  admit(admission: ReceivedMediaReleaseAdmission): Promise<void>;
  /** Every admission still waiting for the Shared File owner, oldest first. */
  pending(): Promise<readonly ReceivedMediaReleaseAdmission[]>;
  /** Drop one admission after the Shared File owner has settled it. */
  settle(id: string): Promise<void>;
}
