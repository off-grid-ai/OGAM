/**
 * Wires automatic speaker labelling to the real WAV slicer, the active on-device model, and the
 * stores. Called from the capture-finalize path (best-effort, guarded): if nothing is enrolled it
 * returns immediately, so users who never set up voices pay nothing.
 */
import RNFS from 'react-native-fs'
import { extractWavSegment } from '../wavSlicer'
import { createExecutorchSpeakerEmbedder } from './executorchSpeakerEmbedderFactory'
import { dispatchSpeakerEmbed } from './speakerEmbedder'
import { annotateSessions, type AnnotatableSession } from './speakerAnnotation'
import { dispatchDiarize } from './speakerDiarizer'
import { createSherpaDiarizer } from './sherpaDiarizerFactory'
import { nameClusters, assignSpeakersToSegments } from './diarizationModel'
import { useSpeakerProfilesStore } from '../../stores/speakerProfilesStore'
import { useSpeakerModelStore } from '../../stores/speakerModelStore'
import { useAmbientTimelineStore } from '../../stores/ambientTimelineStore'

const DIR = `${RNFS.CachesDirectoryPath}/ambient-voiceprint`

/** Identify + label speakers across freshly built sessions. No-op until a voice is enrolled. */
export async function annotateSessionsWithSpeakers(sessions: AnnotatableSession[]): Promise<void> {
  const modelStore = useSpeakerModelStore.getState()
  const activeModel = modelStore.activeModel()
  const profiles = useSpeakerProfilesStore.getState().profilesForModel(activeModel.id)
  if (profiles.length === 0) return

  const timeline = useAmbientTimelineStore.getState()

  // Preferred path — real diarization ("who spoke when") on-device via sherpa-onnx (iOS + Android).
  // Produces anonymous clusters + turns; the pure layer names the clusters against enrolled profiles
  // and overlaps them onto our VAD segments. Falls through to per-segment identification if no
  // diarizer engine is installed. NOTE: enrollment + diarization must share one embedding space —
  // profiles are matched to the diarizer's turn embeddings.
  const diarizer = createSherpaDiarizer(modelStore.activeDiarizationModel())
  if (diarizer) {
    let diarizedAny = false
    for (const session of sessions) {
      if (!session.recordingPath) continue
      try {
        const result = await dispatchDiarize(session.recordingPath, { phone: diarizer })
        if (!result) continue
        const names = nameClusters(result.turns, profiles, modelStore.matchThreshold)
        for (const label of assignSpeakersToSegments(session.segments, result.turns, names)) {
          timeline.setSegmentSpeaker(session.id, label.segmentId, label.speakerId, label.speakerName)
        }
        diarizedAny = true
      } catch {
        // fall back for this run
      }
    }
    if (diarizedAny) return
  }

  // Fallback — per-VAD-segment identification (labels enrolled speakers; no anonymous clustering).
  if (!(await RNFS.exists(DIR))) await RNFS.mkdir(DIR)
  const phone = createExecutorchSpeakerEmbedder(activeModel)

  await annotateSessions(sessions, {
    slice: async (recordingPath, startMs, endMs) => {
      const out = `${DIR}/${startMs}-${endMs}.wav`
      const ok = await extractWavSegment(recordingPath, startMs, endMs, out)
      return ok ? out : null
    },
    embed: async slicePath => {
      const r = await dispatchSpeakerEmbed({ slicePath }, { phone })
      if (!r.ok) throw new Error(r.error)
      return r.embedding
    },
    profiles,
    threshold: modelStore.matchThreshold,
    setSpeaker: (sessionId, segmentId, speakerId, speakerName) =>
      useAmbientTimelineStore.getState().setSegmentSpeaker(sessionId, segmentId, speakerId, speakerName)
  })
}
