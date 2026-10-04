/**
 * Conversation relevance — the product's whole point: the 24/7 recorder hears everything (traffic,
 * TVs, the baristas across the counter), but a Day should be made only of the conversations the owner
 * is ACTUALLY in. This is the pure scoring core of that decision (stage 5 of the diarization rework),
 * kept free of stores/native/LLM so it's unit-testable and tunable against the eval set.
 *
 * Locked design (2026-09-29): relevance is a weighted, tunable 3-factor score, NOT near-field alone
 * and NOT owner talk-time:
 *   1. near-field       — acoustic; the owner's mic is on the owner, so a real conversation is
 *                         near-field turns interleaving. Overheard talk is far-field. (From Phase-3
 *                         adaptive VAD; until that lands it's passed as null and simply excluded.)
 *   2. ownerParticipation — presence + turn-taking from the enrolled voiceprint. Deliberately rewards
 *                         PRESENCE + INTERLEAVE, not talk-time, so the owner-mostly-listening case (a
 *                         1:1, a lecture) still scores instead of being dropped.
 *   3. importance       — does the summary say it's about the owner's world (tasks, commitments,
 *                         decisions). From the summary LLM; a lightweight heuristic stands in until then.
 *
 * scoreRelevance averages only the factors actually present (null ones are dropped and the weights
 * renormalized), so the gate degrades gracefully as stages come online rather than being skewed by a
 * neutral placeholder. Output is a score + keep decision + human reason, so every drop is explainable.
 */
import type { DiarizedTurn } from './speakerDiarizer'
import type { ClusterIdentity } from './diarizationModel'
import type { AmbientSummary } from './summaryPrompt'

/** A factor is a number in [0,1], or null when that signal isn't available yet (excluded from the mean). */
export interface RelevanceFactors {
  /** Acoustic near-field score (1 = close mic / in-scene). Null until adaptive VAD (Phase 3) provides it. */
  nearField: number | null
  /** Owner presence + turn-taking, in [0,1]. 0 when the owner isn't in the conversation at all. */
  ownerParticipation: number
  /** Whether the content is about the owner's world, in [0,1]. Null when no summary signal is available. */
  importance: number | null
}

export interface RelevanceWeights {
  nearField: number
  ownerParticipation: number
  importance: number
}

/** Tunable defaults. Near-field is the strongest signal when present; participation and importance
 *  split the rest. All three are re-normalized over whichever factors are actually available. */
export const DEFAULT_RELEVANCE_WEIGHTS: RelevanceWeights = {
  nearField: 0.4,
  ownerParticipation: 0.3,
  importance: 0.3
}

/** Combined score at or above this keeps the conversation. Tunable against the eval set. */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.5

export interface RelevanceVerdict {
  /** Weighted mean of the available factors, in [0,1]. */
  score: number
  /** Final keep decision (after any stance guard, e.g. owner-present-always-keep). */
  keep: boolean
  /** One-line, human-readable explanation of the decision (what carried it, what was missing). */
  reason: string
  /** Which factors actually fed the score (the rest were null / unavailable). */
  usedFactors: (keyof RelevanceFactors)[]
}

export interface RelevanceOptions {
  weights?: RelevanceWeights
  threshold?: number
  /**
   * Conservative guarantee: if the owner took ANY part (ownerParticipation > 0), keep regardless of
   * score. Never demote a conversation the owner is actually in — only overheard/absent-owner talk can
   * fall below the bar. The v1 stance until we've validated aggressiveness against the eval set.
   */
  keepIfOwnerPresent?: boolean
}

/** How aggressively to filter. Presets pair weights + threshold + the owner-present guard. */
export type RelevanceStance = 'conservative' | 'balanced' | 'aggressive'

export const STANCE_PRESETS: Record<RelevanceStance, Required<Omit<RelevanceOptions, 'weights'>> & { weights: RelevanceWeights }> = {
  // Errs toward keeping: an owner-present conversation is ALWAYS kept; only clear absent-owner talk with
  // weak content is demoted. Lower threshold so the few available signals rarely drop a borderline one.
  conservative: { weights: DEFAULT_RELEVANCE_WEIGHTS, threshold: 0.35, keepIfOwnerPresent: true },
  balanced: { weights: DEFAULT_RELEVANCE_WEIGHTS, threshold: 0.5, keepIfOwnerPresent: false },
  // Cleanest Day: no owner-present guarantee, higher bar. Only enable once the eval says it's safe.
  aggressive: { weights: DEFAULT_RELEVANCE_WEIGHTS, threshold: 0.6, keepIfOwnerPresent: false },
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * Combine the factors into a keep/drop verdict. Only non-null factors count; their weights are
 * renormalized so a missing signal neither helps nor hurts. With no factors at all we KEEP (fail open —
 * never silently swallow a conversation just because scoring had nothing to go on).
 */
export function scoreRelevance(factors: RelevanceFactors, opts: RelevanceOptions = {}): RelevanceVerdict {
  const weights = opts.weights ?? DEFAULT_RELEVANCE_WEIGHTS
  const threshold = opts.threshold ?? DEFAULT_RELEVANCE_THRESHOLD

  const present: { key: keyof RelevanceFactors; value: number; weight: number }[] = []
  if (factors.nearField != null) present.push({ key: 'nearField', value: clamp01(factors.nearField), weight: weights.nearField })
  present.push({ key: 'ownerParticipation', value: clamp01(factors.ownerParticipation), weight: weights.ownerParticipation })
  if (factors.importance != null) present.push({ key: 'importance', value: clamp01(factors.importance), weight: weights.importance })

  const totalWeight = present.reduce((s, p) => s + p.weight, 0)
  if (totalWeight <= 0) {
    return { score: 1, keep: true, reason: 'no relevance signals available — kept by default', usedFactors: present.map(p => p.key) }
  }
  const score = present.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight

  // Conservative guard: an owner who took part is never demoted, whatever the content scored.
  const ownerPresent = clamp01(factors.ownerParticipation) > 0
  if (opts.keepIfOwnerPresent && ownerPresent) {
    return { score, keep: true, reason: `kept (owner present; score ${score.toFixed(2)})`, usedFactors: present.map(p => p.key) }
  }
  const keep = score >= threshold

  const parts = present.map(p => `${p.key} ${p.value.toFixed(2)}`).join(', ')
  const reason = `${keep ? 'kept' : 'ambient'} (score ${score.toFixed(2)} ${keep ? '≥' : '<'} ${threshold}; ${parts})`
  return { score, keep, reason, usedFactors: present.map(p => p.key) }
}

/**
 * Owner participation from the diarized + named turns: PRESENCE + turn-taking, not talk-time. A quiet
 * owner in a real dialogue (occasional turns interleaved with others) scores meaningfully; an owner who
 * never speaks scores 0 (they're not in it); a nearby monologue the owner isn't part of scores 0.
 *
 * `ownerSpeakerId` is the speakerId that identity-naming assigned to the owner's own cluster (i.e. the
 * enrolled-self profile id). Presence contributes a 0.5 floor; interleave (share of turn boundaries the
 * owner is on either side of) contributes the other 0.5.
 */
export function ownerParticipation(
  turns: DiarizedTurn[],
  names: Record<string, ClusterIdentity>,
  ownerSpeakerId: string
): number {
  if (turns.length === 0) return 0
  const ordered = [...turns].sort((a, b) => a.startMs - b.startMs)
  const speakerOf = (t: DiarizedTurn): string | null => names[t.cluster]?.speakerId ?? null

  const ownerTurns = ordered.filter(t => speakerOf(t) === ownerSpeakerId).length
  if (ownerTurns === 0) return 0
  // Only the owner present (a solo dictation / self-talk) — present but no dialogue to interleave with.
  const distinctSpeakers = new Set(ordered.map(speakerOf).filter((s): s is string => s != null))
  if (distinctSpeakers.size <= 1) return 0.5

  let boundaries = 0
  let ownerBoundaries = 0
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = speakerOf(ordered[i - 1])
    const cur = speakerOf(ordered[i])
    if (prev == null || cur == null || prev === cur) continue
    boundaries += 1
    if (prev === ownerSpeakerId || cur === ownerSpeakerId) ownerBoundaries += 1
  }
  const interleave = boundaries === 0 ? 0 : ownerBoundaries / boundaries
  return clamp01(0.5 + 0.5 * interleave)
}

/**
 * Stopgap importance heuristic until the summary LLM judges the transcript. Looks for the owner's world:
 * first/second-person framing and task/commitment/decision language. Returns [0,1], or null for an
 * empty/absent transcript (so scoreRelevance excludes it rather than treating silence as unimportant).
 * Marked provisional on purpose — the real signal is the LLM judge (see the rework plan, Phase 4).
 */
export function importanceHeuristic(transcript: string | null | undefined): number | null {
  if (!transcript) return null
  const text = transcript.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return null

  const firstSecondPerson = /\b(i|i'm|i'll|i've|my|me|we|we'll|our|you|your|let's)\b/g
  const commitment = /\b(need to|have to|should|must|will|going to|plan|deadline|tomorrow|today|meeting|call|send|follow up|remind|task|decide|decision|agree|owe|pay|book|schedule)\b/g

  const personHits = (text.match(firstSecondPerson) ?? []).length
  const commitHits = (text.match(commitment) ?? []).length

  // Density-based so a long overheard monologue with no owner-world language stays low, while a short
  // "I'll send you the deck tomorrow" scores high. Saturate quickly; this is a coarse stopgap.
  const personScore = Math.min(1, personHits / Math.max(8, words.length * 0.06))
  const commitScore = Math.min(1, commitHits / 3)
  return clamp01(0.5 * personScore + 0.5 * commitScore)
}

/**
 * Importance from the conversation's SUMMARY — the real "the LLM judged the transcript" signal (the
 * summary model already extracted decisions, action items, and people, so we reuse that instead of a
 * second LLM pass). A conversation that produced decisions or commitments is about the owner's world;
 * one the owner is named in is more so. Returns [0,1], or null for an essentially empty summary (so
 * relevance excludes the factor rather than counting silence as unimportant). Prefer this over
 * `importanceHeuristic`, which is the transcript-keyword fallback when no summary is available yet.
 */
export function importanceFromSummary(summary: AmbientSummary | null | undefined, ownerName?: string): number | null {
  if (!summary) return null
  const commitments = summary.decisions.length + summary.actionItems.length
  const hasGist = summary.headline.trim().length > 0
  if (!hasGist && commitments === 0 && summary.people.length === 0) return null

  const ownerNamed =
    !!ownerName &&
    summary.people.some(p => p.toLowerCase().includes(ownerName.toLowerCase().trim()))
  // Base for a real (non-empty) conversation, plus weight for decisions/commitments, plus a nudge when
  // the owner is explicitly a participant. Saturates quickly — this is a coarse relevance input.
  const base = hasGist ? 0.3 : 0.1
  const commitScore = Math.min(1, commitments / 3) * 0.5
  const ownerScore = ownerNamed ? 0.2 : 0
  return clamp01(base + commitScore + ownerScore)
}

/**
 * Convenience: assess one conversation end to end from its named diarization + optional signals.
 * `nearField` stays null until Phase-3 adaptive VAD supplies it. This is the single call the pipeline
 * uses; the individual functions above stay exported for testing and reuse.
 */
export function assessConversation(
  input: {
    turns: DiarizedTurn[]
    names: Record<string, ClusterIdentity>
    ownerSpeakerId: string | null
    transcript?: string | null
    /** The conversation's summary — the preferred importance source (the LLM already judged it). */
    summary?: AmbientSummary | null
    /** The owner's display name, to detect them in the summary's participant list. */
    ownerName?: string
    nearField?: number | null
  },
  opts: RelevanceOptions | { stance: RelevanceStance } = {}
): RelevanceVerdict {
  const resolved: RelevanceOptions = 'stance' in opts ? STANCE_PRESETS[opts.stance] : opts
  const participation = input.ownerSpeakerId
    ? ownerParticipation(input.turns, input.names, input.ownerSpeakerId)
    : 0
  // Prefer the summary's judgement (decisions/commitments/people); fall back to the transcript keyword
  // heuristic only when no summary is available.
  const importance =
    input.summary !== undefined
      ? importanceFromSummary(input.summary, input.ownerName)
      : importanceHeuristic(input.transcript)
  return scoreRelevance(
    {
      nearField: input.nearField ?? null,
      ownerParticipation: participation,
      importance
    },
    resolved
  )
}
