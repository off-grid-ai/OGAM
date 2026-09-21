/**
 * Pure diarization → naming → segment-labelling. No engine, no I/O — unit-testable.
 *
 * A diarizer gives anonymous clusters ("spk0"…) with a voiceprint per turn. This:
 *   1. nameClusters — averages each cluster's voiceprints and matches them to enrolled profiles, so a
 *      recognized cluster gets the person's name; an unrecognized one becomes a stable "Speaker N".
 *   2. assignSpeakersToSegments — maps those named clusters back onto our VAD TimelineSegments by time
 *      overlap, so the existing timeline/labels/correction UI works unchanged.
 *
 * This is the whole point of "diarize then identify": strangers still get separated (Speaker 1/2/3),
 * and enrolled people get their names — on top of everything we already built.
 */
import {
  matchSpeaker,
  averageEmbeddings,
  DEFAULT_MATCH_THRESHOLD,
  type SpeakerProfile,
  type DiarizedTurnLike
} from './speakerModel'
import type { DiarizedTurn } from './speakerDiarizer'

export interface ClusterIdentity {
  /** Enrolled profile id when recognized, else the anonymous cluster id. */
  speakerId: string
  /** The person's name when recognized, else a friendly "Speaker N". */
  speakerName: string
  /** True when matched to an enrolled profile above threshold. */
  known: boolean
}

/** Assign an identity to every anonymous cluster. Recognized → enrolled name; else → "Speaker N". */
export function nameClusters(
  turns: DiarizedTurn[],
  profiles: SpeakerProfile[],
  threshold: number = DEFAULT_MATCH_THRESHOLD
): Record<string, ClusterIdentity> {
  // Group turn embeddings by cluster, in first-seen order (stable "Speaker N" numbering).
  const order: string[] = []
  const byCluster: Record<string, number[][]> = {}
  for (const t of turns) {
    if (!byCluster[t.cluster]) {
      byCluster[t.cluster] = []
      order.push(t.cluster)
    }
    if (t.embedding && t.embedding.length > 0) byCluster[t.cluster].push(t.embedding)
  }

  const out: Record<string, ClusterIdentity> = {}
  let anon = 0
  for (const cluster of order) {
    const centroid = averageEmbeddings(byCluster[cluster])
    const match = centroid.length > 0 ? matchSpeaker(centroid, profiles, threshold) : null
    if (match && match.confident && match.speakerId && match.name) {
      out[cluster] = { speakerId: match.speakerId, speakerName: match.name, known: true }
    } else {
      anon += 1
      out[cluster] = { speakerId: `cluster:${cluster}`, speakerName: `Speaker ${anon}`, known: false }
    }
  }
  return out
}

export interface SegmentSpeakerLabel {
  segmentId: string
  speakerId: string | null
  speakerName: string | null
}

/** Overlap in ms between two spans. */
function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/**
 * Label each VAD segment with the cluster it overlaps most (its dominant speaker for that span).
 * Segments overlapping no turn get a null label (heard but undiarized → "Unknown" in the UI).
 */
export function assignSpeakersToSegments(
  segments: { id: string; startMs: number; endMs: number }[],
  turns: DiarizedTurn[],
  names: Record<string, ClusterIdentity>
): SegmentSpeakerLabel[] {
  return segments.map(seg => {
    const overlapByCluster: Record<string, number> = {}
    for (const t of turns) {
      const ov = overlapMs(seg.startMs, seg.endMs, t.startMs, t.endMs)
      if (ov > 0) overlapByCluster[t.cluster] = (overlapByCluster[t.cluster] ?? 0) + ov
    }
    let best: string | null = null
    let bestOv = 0
    for (const [cluster, ov] of Object.entries(overlapByCluster)) {
      if (ov > bestOv) {
        bestOv = ov
        best = cluster
      }
    }
    if (!best) return { segmentId: seg.id, speakerId: null, speakerName: null }
    const id = names[best]
    return { segmentId: seg.id, speakerId: id?.speakerId ?? null, speakerName: id?.speakerName ?? null }
  })
}

// Re-export a structural helper type the engine binding can rely on.
export type { DiarizedTurnLike }
