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

const DIR = `${RNFS.CachesDirectoryPath}/ambient-voiceprint`

export async function annotateSessionsWithSpeakers(sessions: AnnotatableSession[]): Promise<void> {
  const engine = resolveSpeakerEngine()
  const profiles = useSpeakerProfilesStore.getState().profilesForModel(engine.modelId)
  if (profiles.length === 0) return // nothing enrolled in this engine's space → skip entirely

  const threshold = useSpeakerModelStore.getState().matchThreshold
  const timeline = useAmbientTimelineStore.getState()

  // Preferred: diarize the whole recording, name the clusters, overlap onto our VAD segments.
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
