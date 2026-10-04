/**
 * Wires speaker labelling to the resolved engine (Mac offload when reachable, else on-device), the WAV
 * slicer, and the stores. Called from capture-finalize, best-effort and guarded: no-op until a voice is
 * enrolled, and any failure is swallowed so it can never disturb capture.
 *
 * Prefers real diarization ("who spoke when" → name the clusters); falls back to per-VAD-segment
 * identification when the engine can't diarize. Enrollment and matching share one embedding space via
 * resolveSpeakerEngine().modelId.
 */
import RNFS from 'react-native-fs'
import { extractWavSegment } from '../wavSlicer'
import { annotateSessions, type AnnotatableSession } from './speakerAnnotation'
import { dispatchDiarize } from './speakerDiarizer'
import { nameClusters, assignSpeakersToSegments } from './diarizationModel'
import { assessConversation } from './conversationRelevance'
import { meanNearField } from '@offgrid/models'
import { resolveSpeakerEngine } from './speakerEngineFactory'
import { useSpeakerProfilesStore } from '../../stores/speakerProfilesStore'
import { useSpeakerModelStore } from '../../stores/speakerModelStore'
import { useAmbientTimelineStore } from '../../stores/ambientTimelineStore'
import { useAppStore } from '../../stores/appStore'
import { selectVoiceRecognitionUnlocked } from '../../stores/proAccessSlice'
import type { TimelineSegment, SessionRelevance } from './timelineModel'
import type { SpeakerAnnotation } from './timelineBuilder'

/**
 * A per-conversation speaker annotator, resolved ONCE per capture (engine + profiles + owner), that the
 * timeline builder calls between transcription and summary. Diarizes one recording, names the clusters
 * against enrolled voiceprints, labels the conversation's segments, and computes the relevance verdict —
 * WITHOUT touching the store (the builder folds the result into the session it's constructing).
 *
 * Relevance here uses only near-field + owner participation; importance (from the summary) isn't
 * available yet at this point in the pipeline, so it's left out of the gate — the conservative stance
 * (owner-present ⇒ keep) carries it. Returns null when voice recognition is off or no diarizer is ready.
 */
export function createSpeakerAnnotator():
  | { annotate: (input: { id: string; recordingPath: string; captureStartedAtMs: number; segments: TimelineSegment[] }) => Promise<SpeakerAnnotation | null> }
  | null {
  if (!selectVoiceRecognitionUnlocked(useAppStore.getState())) return null
  const engine = resolveSpeakerEngine()
  if (!engine.diarizer) return null
  const diarizer = engine.diarizer

  let profilesReady = false
  const ensureReady = async () => {
    if (profilesReady) return
    profilesReady = true
    try {
      await ensureEngineProfiles(engine)
    } catch {
      // best-effort — never block labelling
    }
  }

  return {
    annotate: async input => {
      if (!input.recordingPath) return null
      await ensureReady()
      const profilesStore = useSpeakerProfilesStore.getState()
      const profiles = profilesStore.profilesForModel(engine.modelId)
      const threshold = useSpeakerModelStore.getState().matchThreshold

      const result = await dispatchDiarize(input.recordingPath, { phone: diarizer })
      if (!result) return null

      // Turns are recording-relative; segment times are absolute → shift before overlap (the time-base fix).
      const offset = input.captureStartedAtMs ?? 0
      const shiftedTurns = result.turns.map(t => ({ ...t, startMs: t.startMs + offset, endMs: t.endMs + offset }))
      const names = nameClusters(result.turns, profiles, threshold)
      const labels = assignSpeakersToSegments(input.segments, shiftedTurns, names)
      const byId = new Map(labels.map(l => [l.segmentId, l]))
      const segments = input.segments.map(seg => {
        const l = byId.get(seg.id)
        return l ? { ...seg, speakerId: l.speakerId, speakerName: l.speakerName } : seg
      })

      // Relevance from near-field + participation (no summary yet → importance excluded from the gate).
      let relevance: SessionRelevance | null = null
      const ownerSpeakerId = profilesStore.ownerSpeakerId(engine.modelId)
      if (ownerSpeakerId) {
        const nearField = meanNearField(
          result.turns.map(t => t.nearField).filter((n): n is number => typeof n === 'number')
        )
        const verdict = assessConversation(
          { turns: result.turns, names, ownerSpeakerId, nearField },
          { stance: 'conservative' }
        )
        relevance = { ambient: !verdict.keep, score: verdict.score, reason: verdict.reason }
      }
      return { segments, relevance }
    }
  }
}

const DIR = `${RNFS.CachesDirectoryPath}/ambient-voiceprint`

/**
 * Make sure every enrolled person has a voiceprint in the *active* engine's embedding space. A voice
 * enrolled on-device can't be matched by the Mac engine (different vectors) — so for any person who
 * has kept enrollment clips but no profile in this space, re-embed those clips through the current
 * engine and save a same-personId variant. One enrollment, works on whichever engine is running.
 * Best-effort: a failed re-embed just leaves that person unnamed this run.
 */
async function ensureEngineProfiles(engine: ReturnType<typeof resolveSpeakerEngine>): Promise<void> {
  const store = useSpeakerProfilesStore.getState()
  const all = Object.values(store.profiles)
  const haveInSpace = new Set(all.filter(p => p.modelId === engine.modelId).map(p => p.personId))
  const handled = new Set<string>()
  for (const p of all) {
    if (!p.personId || !p.enrollmentClips?.length) continue
    if (haveInSpace.has(p.personId) || handled.has(p.personId)) continue
    handled.add(p.personId)
    const embeddings = []
    for (const clip of p.enrollmentClips) {
      try {
        if (!(await RNFS.exists(clip))) continue
        const e = await engine.embedder.embed({ slicePath: clip })
        if (e.length > 0) embeddings.push(e)
      } catch {
        // skip this clip
      }
    }
    if (embeddings.length > 0) {
      store.enroll(p.name, engine.modelId, embeddings, {
        personId: p.personId,
        enrollmentClips: p.enrollmentClips
      })
    }
  }
}

export async function annotateSessionsWithSpeakers(sessions: AnnotatableSession[]): Promise<void> {
  // Voice recognition (speaker separation + who-said-what) is a Pro feature. Free users still get the
  // transcript and summary; they just don't get speaker labels. Single chokepoint for the live stop and
  // the nightly deferred queue alike.
  if (!selectVoiceRecognitionUnlocked(useAppStore.getState())) return
  const engine = resolveSpeakerEngine()
  // Backfill this engine's space from kept enrollment clips, so a voice enrolled on another engine
  // (e.g. on-device, before the Mac was connected) is still recognized here.
  try {
    await ensureEngineProfiles(engine)
  } catch {
    // best-effort — never block labelling
  }
  const profiles = useSpeakerProfilesStore.getState().profilesForModel(engine.modelId)
  const threshold = useSpeakerModelStore.getState().matchThreshold
  const timeline = useAmbientTimelineStore.getState()

  // Preferred: diarize the whole recording, name the clusters, overlap onto our VAD segments.
  // Runs even with nothing enrolled — separating two unknown people into "Speaker 1/2" needs no
  // voiceprint; nameClusters just leaves every cluster anonymous. Enrolled voices (in THIS engine's
  // space) get named on top. This is the whole "diarize then identify" promise.
  if (engine.diarizer) {
    let diarizedAny = false
    for (const session of sessions) {
      if (!session.recordingPath) continue
      try {
        const result = await dispatchDiarize(session.recordingPath, { phone: engine.diarizer })
        if (!result) continue
        // Segment times are ABSOLUTE (captureStartedAtMs + offset); the diarizer ran on the 0-based
        // recording, so its turns are recording-relative. Shift turns into the segments' base or the
        // overlap is always zero and every segment reads "Unknown" even on a perfect voiceprint match.
        const offset = session.captureStartedAtMs ?? 0
        const shiftedTurns = result.turns.map(t => ({
          ...t,
          startMs: t.startMs + offset,
          endMs: t.endMs + offset
        }))
        const names = nameClusters(result.turns, profiles, threshold)
        for (const label of assignSpeakersToSegments(session.segments, shiftedTurns, names)) {
          timeline.setSegmentSpeaker(session.id, label.segmentId, label.speakerId, label.speakerName)
        }
        // Relevance gate: is this a conversation the owner is actually in, or overheard/ambient? Only
        // meaningful once the owner is enrolled (else we can't tell) — conservative stance keeps
        // everything the owner took part in, demotes only clear absent-owner talk to the Ambient bucket.
        // near-field is null until Phase-3 adaptive VAD; the scorer excludes it and leans on the rest.
        const profilesStore = useSpeakerProfilesStore.getState()
        const ownerSpeakerId = profilesStore.ownerSpeakerId(engine.modelId)
        if (ownerSpeakerId) {
          const transcript = session.segments.map(s => s.transcript).filter(Boolean).join(' ')
          // The owner's display name lets importance-from-summary notice them in the participant list.
          const ownerName = Object.values(profilesStore.profiles).find(
            p => p.personId === profilesStore.ownerPersonId
          )?.name
          // Near-field: mean of the per-turn scores the engine supplied (Mac offload). Absent on engines
          // that don't compute it → meanNearField is null → relevance excludes the factor (graceful).
          const nearField = meanNearField(
            result.turns.map(t => t.nearField).filter((n): n is number => typeof n === 'number')
          )
          const verdict = assessConversation(
            { turns: result.turns, names, ownerSpeakerId, transcript, summary: session.summary, ownerName, nearField },
            { stance: 'conservative' }
          )
          timeline.setSessionRelevance(session.id, {
            ambient: !verdict.keep,
            score: verdict.score,
            reason: verdict.reason
          })
        }
        diarizedAny = true
      } catch {
        // fall through for this run
      }
    }
    if (diarizedAny) return
  }

  // Fallback: per-VAD-segment identification (labels enrolled speakers; no anonymous clustering).
  // Only meaningful with something enrolled in this engine's space — otherwise there's nothing to match.
  if (profiles.length === 0) return
  if (!(await RNFS.exists(DIR))) await RNFS.mkdir(DIR)
  await annotateSessions(sessions, {
    slice: async (recordingPath, startMs, endMs) => {
      const out = `${DIR}/${startMs}-${endMs}.wav`
      const ok = await extractWavSegment(recordingPath, startMs, endMs, out)
      return ok ? out : null
    },
    embed: slicePath => engine.embedder.embed({ slicePath }),
    profiles,
    threshold,
    setSpeaker: (sessionId, segmentId, speakerId, speakerName) =>
      timeline.setSegmentSpeaker(sessionId, segmentId, speakerId, speakerName)
  })
}
