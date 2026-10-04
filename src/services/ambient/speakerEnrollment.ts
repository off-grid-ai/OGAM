/**
 * Enrollment orchestration for voice fingerprinting — the "read a sentence → embed → save" flow,
 * kept free of UI and native code so it's unit-testable with a fake embedder.
 *
 * The screen records the user reading the two ENROLLMENT_PROMPTS paragraphs, hands the resulting WAV
 * slices here; this embeds each through the active model's embedder, averages them into one centroid
 * (via the pure createProfile → store.enroll), and tags it with the model id so it stays comparable.
 */
import type { SpeakerEmbedding } from './speakerModel'

/** Two distinct paragraphs — a few sentences each so every read carries several seconds of continuous
 *  speech, which makes a far more reliable voiceprint than a single line. Two passes with different
 *  phonemes still guards against a fluke read. Copy stays on-brand: plain, privacy-first, no em dashes. */
export const ENROLLMENT_PROMPTS = [
  'Everything I record and everything I say stays here, on my own device, and never leaves for a server I do not control. A calm morning, a busy afternoon, or a long quiet evening all belong to me alone, and that is exactly how I want it.',
  'I can talk about my work, my weekend plans, a few old stories, and the small things that fill an ordinary day. When you hear me speak for a little while, the shape and sound of my voice is enough to tell that this is really me.'
]

/** How many reads to collect — one per prompt. */
export const ENROLLMENT_SAMPLE_COUNT = ENROLLMENT_PROMPTS.length

export interface EnrollmentDeps {
  /** Embed one slice — bind this to dispatchSpeakerEmbed for the active model. */
  embed(slicePath: string): Promise<SpeakerEmbedding>
  /** Persist the profile — bind to useSpeakerProfilesStore.enroll. */
  enroll(
    name: string,
    modelId: string,
    embeddings: SpeakerEmbedding[],
    opts?: { personId?: string; enrollmentClips?: string[] }
  ): string
  /** The active embedding model id (profiles are only comparable within the same model). */
  modelId: string
}

export interface EnrollmentResult {
  profileId: string
  /** How many of the reads produced a usable voiceprint. */
  usableSamples: number
}

/**
 * Enroll `name` from the recorded reads. Embeds every slice, drops any that failed to produce a
 * vector, and saves the averaged profile. Throws if the name is blank or nothing embedded.
 */
export async function enrollSpeaker(
  name: string,
  slicePaths: string[],
  deps: EnrollmentDeps
): Promise<EnrollmentResult> {
  const clean = name.trim()
  if (!clean) throw new Error('a name is required to enroll')
  if (slicePaths.length === 0) throw new Error('no voice samples were recorded')

  const embeddings: SpeakerEmbedding[] = []
  for (const path of slicePaths) {
    try {
      const e = await deps.embed(path)
      if (e.length > 0) embeddings.push(e)
    } catch {
      // A single failed read shouldn't sink enrollment; we require only one usable sample below.
    }
  }
  if (embeddings.length === 0) throw new Error('could not read a clear voice sample — try again')

  // Keep the source reads with the profile so the same voice can be re-embedded into another engine's
  // space later (e.g. when the Mac takes over) without re-recording. The screen persists these paths.
  const profileId = deps.enroll(clean, deps.modelId, embeddings, { enrollmentClips: slicePaths })
  return { profileId, usableSamples: embeddings.length }
}
