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
import { resolveSpeakerEngine } from './speakerEngineFactory'
import { useSpeakerProfilesStore } from '../../stores/speakerProfilesStore'
import { useSpeakerModelStore } from '../../stores/speakerModelStore'
import { useAmbientTimelineStore } from '../../stores/ambientTimelineStore'
import { useAppStore } from '../../stores/appStore'
import { selectVoiceRecognitionUnlocked } from '../../stores/proAccessSlice'

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
        const names = nameClusters(result.turns, profiles, threshold)
        for (const label of assignSpeakersToSegments(session.segments, result.turns, names)) {
          timeline.setSegmentSpeaker(session.id, label.segmentId, label.speakerId, label.speakerName)
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
