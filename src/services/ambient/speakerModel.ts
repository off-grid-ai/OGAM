/**
 * Speaker-identity core for voice fingerprinting — a PURE, model-free module.
 *
 * The embedding engine (ExecuTorch on-device, or the Mac offload) turns a speech slice into a
 * fixed-length voiceprint vector; everything about *deciding whose voice it is* lives here so it
 * stays unit-testable without a model or a microphone — same discipline as vadSegmenter.
 *
 * Enrollment averages a few voiceprints from the user reading a sentence into one profile centroid.
 * At review time, matchSpeaker compares a segment's voiceprint to every known profile by cosine
 * similarity: the best match above the threshold is that speaker, otherwise it's "unknown" and the UI
 * asks the user. Each confirmed answer folds back through addSampleToProfile, so a profile sharpens
 * with use (active learning).
 */

/** A voiceprint. Always L2-normalized so cosine similarity is a plain dot product. */
export type SpeakerEmbedding = number[]

export interface SpeakerProfile {
  id: string
  name: string
  /** Which embedding model produced this profile's vectors — only same-model profiles are comparable. */
  modelId: string
  /** Running mean of the profile's voiceprints, re-normalized. */
  centroid: SpeakerEmbedding
  /** How many voiceprints have been folded in (enrollment + confirmed corrections). */
  sampleCount: number
}

export interface SpeakerMatch {
  /** null when no profile clears the threshold — an "unknown" voice the UI should ask about. */
  speakerId: string | null
  name: string | null
  /** Best cosine similarity found, in [-1, 1], regardless of confidence. */
  score: number
  /** score >= threshold. */
  confident: boolean
}

/** Cosine threshold for calling a match confident. Tuned once the real model is in; conservative. */
export const DEFAULT_MATCH_THRESHOLD = 0.7

/** L2-normalize a vector. A zero (or empty) vector returns a zero vector of the same length. */
export function normalize(v: SpeakerEmbedding): SpeakerEmbedding {
  let sum = 0
  for (const x of v) sum += x * x
  const mag = Math.sqrt(sum)
  if (mag === 0) return v.map(() => 0)
  return v.map(x => x / mag)
}

/** Cosine similarity of two vectors. Mismatched lengths or a zero vector yield 0. */
export function cosineSimilarity(a: SpeakerEmbedding, b: SpeakerEmbedding): number {
  if (a.length === 0 || a.length !== b.length) return 0
  let dot = 0
  let ma = 0
  let mb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    ma += a[i] * a[i]
    mb += b[i] * b[i]
  }
  if (ma === 0 || mb === 0) return 0
  return dot / (Math.sqrt(ma) * Math.sqrt(mb))
}

/** Mean of several voiceprints, re-normalized — the enrollment aggregate. Empty input → []. */
export function averageEmbeddings(embeddings: SpeakerEmbedding[]): SpeakerEmbedding {
  if (embeddings.length === 0) return []
  const dim = embeddings[0].length
  const acc = new Array<number>(dim).fill(0)
  for (const e of embeddings) {
    if (e.length !== dim) continue
    for (let i = 0; i < dim; i += 1) acc[i] += e[i]
  }
  return normalize(acc.map(x => x / embeddings.length))
}

/** Build a profile from enrollment samples (the user reading the prompt sentence a few times). */
export function createProfile(
  id: string,
  name: string,
  modelId: string,
  enrollmentEmbeddings: SpeakerEmbedding[]
): SpeakerProfile {
  return {
    id,
    name,
    modelId,
    centroid: averageEmbeddings(enrollmentEmbeddings),
    sampleCount: enrollmentEmbeddings.length
  }
}

/**
 * Fold one more confirmed voiceprint into a profile: an incremental, weighted centroid update so
 * early enrollment isn't washed out by a single later sample, then re-normalized.
 */
export function addSampleToProfile(
  profile: SpeakerProfile,
  embedding: SpeakerEmbedding
): SpeakerProfile {
  const n = profile.sampleCount
  if (n === 0 || profile.centroid.length !== embedding.length) {
    return { ...profile, centroid: normalize(embedding), sampleCount: n + 1 }
  }
  const blended = profile.centroid.map((c, i) => (c * n + embedding[i]) / (n + 1))
  return { ...profile, centroid: normalize(blended), sampleCount: n + 1 }
}

/** Best-matching known speaker for a voiceprint, or an unknown result below the threshold. */
export function matchSpeaker(
  embedding: SpeakerEmbedding,
  profiles: SpeakerProfile[],
  threshold: number = DEFAULT_MATCH_THRESHOLD
): SpeakerMatch {
  let best: SpeakerProfile | null = null
  let bestScore = -Infinity
  for (const p of profiles) {
    const score = cosineSimilarity(embedding, p.centroid)
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  if (!best || bestScore < threshold) {
    return { speakerId: null, name: null, score: best ? bestScore : 0, confident: false }
  }
  return { speakerId: best.id, name: best.name, score: bestScore, confident: true }
}

/** Minimal shape the naming step needs from a diarized turn (engine-agnostic). */
export interface DiarizedTurnLike {
  cluster: string
  embedding?: SpeakerEmbedding
}
