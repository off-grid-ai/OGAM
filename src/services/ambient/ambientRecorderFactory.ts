/**
 * Wires the AmbientRecorder to the real native capture. Kept separate from the class so the class
 * stays native-free and unit-testable — this is the only place that pulls in audioRecorderService.
 */

import { audioRecorderService } from '../audioRecorderService'
import { AmbientRecorder, type AmbientRecorderDeps } from './ambientRecorder'
import type { VadConfig } from './vadSegmenter'

export function createAmbientRecorder(config?: VadConfig): AmbientRecorder {
  const deps: AmbientRecorderDeps = {
    recorder: audioRecorderService,
    now: () => Date.now(),
    ...(config ? { config } : {})
  }
  return new AmbientRecorder(deps)
}
