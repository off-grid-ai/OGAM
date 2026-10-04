/**
 * Note-first anchoring: turning the moments you flag live into the segments that matter.
 *
 * Granola's real innovation is that YOU signal what matters and the AI builds around it, so the notes
 * sound like you took them. The phone analog: tap "flag" mid-conversation; each tap is a timestamp.
 * This maps those timestamps onto the transcribed segments - the segment whose span contains the tap,
 * or the nearest one - so the summary can prioritise what you cared about and the UI can mark it.
 *
 * PURE: times and ids in, flagged ids out. Works in whatever time domain the caller uses (capture-
 * relative here) as long as anchors and segments share it.
 */

export interface AnchorTarget {
  id: string
  startMs: number
  endMs: number
}

/**
 * For each anchor time, the segment that best represents it: the one whose span contains it, else the
 * nearest by gap. Returns the distinct flagged segment ids, order-stable by first appearance.
 */
export function flagSegmentsForAnchors(segments: AnchorTarget[], anchorsMs: number[]): string[] {
  if (segments.length === 0 || anchorsMs.length === 0) return []
  const flagged: string[] = []
  const seen = new Set<string>()
  for (const at of anchorsMs) {
    let bestId: string | null = null
    let bestDist = Infinity
    for (const seg of segments) {
      const dist = at < seg.startMs ? seg.startMs - at : at > seg.endMs ? at - seg.endMs : 0
      if (dist < bestDist) {
        bestDist = dist
        bestId = seg.id
      }
    }
    if (bestId && !seen.has(bestId)) {
      seen.add(bestId)
      flagged.push(bestId)
    }
  }
  return flagged
}
