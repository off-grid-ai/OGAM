/**
 * Speaker identification for a captured segment — "whose voice is this?", kept pure and best-effort.
 *
 * Embeds the segment's audio slice through the active model and matches it against the enrolled
 * profiles FOR THAT MODEL (vectors across models aren't comparable). Identification is an enhancement,
 * never a dependency: any failure (no model, unreadable slice, no profiles) resolves to "unknown"
 * rather than throwing, so it can't disrupt transcription. Unknown/low-confidence results are what
 * Phase 5 surfaces to the user as "is this Priya?".
 */
import {
  matchSpeaker,
  DEFAULT_MATCH_THRESHOLD,
  type SpeakerEmbedding,
  type SpeakerProfile,
  type SpeakerMatch
} from './speakerModel'

export interface IdentifyDeps {
  /** Embed one slice — bind to dispatchSpeakerEmbed for the active model. */
  embed(slicePath: string): Promise<SpeakerEmbedding>
  /** Enrolled profiles for the ACTIVE model (use store.profilesForModel(activeId)). */
  profiles: SpeakerProfile[]
  threshold?: number
}

const UNKNOWN: SpeakerMatch = { speakerId: null, name: null, score: 0, confident: false }

/** Identify the speaker of one slice. Returns an "unknown" match on any failure — never throws. */
export async function identifySpeaker(slicePath: string, deps: IdentifyDeps): Promise<SpeakerMatch> {
  if (deps.profiles.length === 0) return UNKNOWN
  let embedding: SpeakerEmbedding
  try {
    embedding = await deps.embed(slicePath)
  } catch {
    return UNKNOWN
  }
  if (!embedding || embedding.length === 0) return UNKNOWN
  return matchSpeaker(embedding, deps.profiles, deps.threshold ?? DEFAULT_MATCH_THRESHOLD)
}

export interface IdentifiableSegment {
  id: string
  slicePath: string
}

export interface SegmentSpeaker {
  segmentId: string
  match: SpeakerMatch
}

/** Identify every segment (sequential; embedding is CPU-heavy and this runs off the hot path). */
export async function identifySegments(
  segments: IdentifiableSegment[],
  deps: IdentifyDeps
): Promise<SegmentSpeaker[]> {
  const out: SegmentSpeaker[] = []
  for (const s of segments) {
    out.push({ segmentId: s.id, match: await identifySpeaker(s.slicePath, deps) })
  }
  return out
}
