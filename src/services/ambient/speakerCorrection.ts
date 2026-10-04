/**
 * Apply a user's answer to "whose voice is this?" — the active-learning step of voice fingerprinting.
 *
 * When identification was unknown or wrong, the user tells us who it was: an existing speaker or a new
 * one. If we captured the segment's voiceprint, we fold it back so the profile sharpens with every
 * correction (existing → addSampleToProfile; new → enroll). If we don't have the embedding (e.g. the
 * slice is gone), we can still record the label but there's nothing to learn from — reported via
 * `learned: false`. Pure and store-agnostic so it's unit-testable.
 */
import type { SpeakerEmbedding } from './speakerModel'

export type CorrectionAnswer =
  | { kind: 'existing'; profileId: string }
  | { kind: 'new'; name: string }

export interface CorrectionDeps {
  /** The segment's voiceprint, if we still have it — null means "label only, can't learn". */
  embedding: SpeakerEmbedding | null
  modelId: string
  /** Fold a confirmed sample into an existing profile (store.addSample). */
  addSample(profileId: string, embedding: SpeakerEmbedding): void
  /** Create a new profile from the sample (store.enroll). Returns its id. */
  enroll(name: string, modelId: string, embeddings: SpeakerEmbedding[]): string
}

export interface CorrectionResult {
  profileId: string
  /** True when the correction improved a voiceprint (an embedding was available). */
  learned: boolean
}

/** Apply the answer. Throws only on invalid input (new speaker with no embedding to seed it). */
export function applySpeakerCorrection(
  answer: CorrectionAnswer,
  deps: CorrectionDeps
): CorrectionResult {
  if (answer.kind === 'existing') {
    if (deps.embedding) {
      deps.addSample(answer.profileId, deps.embedding)
      return { profileId: answer.profileId, learned: true }
    }
    return { profileId: answer.profileId, learned: false }
  }
  // New speaker: needs a sample to exist at all.
  const name = answer.name.trim()
  if (!name) throw new Error('a name is required for a new speaker')
  if (!deps.embedding) throw new Error('no voice sample available to create a new speaker')
  const id = deps.enroll(name, deps.modelId, [deps.embedding])
  return { profileId: id, learned: true }
}
