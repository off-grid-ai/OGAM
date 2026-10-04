/**
 * The recorder's transcription executor: on-device whisper, or - when the user turned on Mac offload
 * and a paired Mac is reachable - the Mac, with the phone as an automatic fallback. Wraps the phone +
 * Mac executors behind dispatchStt so the timeline builder keeps consuming ONE executor while the
 * mac/phone choice and the fallback happen inside. The choice is re-evaluated PER SEGMENT, so a Mac
 * that drops mid-capture just sends the rest on-device.
 *
 * DI core (createCaptureSttExecutor) is pure over its two executors + a readiness probe, so the choice
 * and fallback are unit-testable with fakes; the concrete wiring is createDefaultCaptureSttExecutor.
 */

import { createDefaultPhoneSttExecutor } from './phoneSttExecutorFactory'
import { createDefaultMacSttExecutor, macOffloadReady } from './macSttExecutorFactory'
import { dispatchStt, type SttExecutor } from './sttExecutor'

export interface CaptureSttDeps {
  phone: SttExecutor
  mac: SttExecutor
  /** Is a paired Mac reachable right now? Checked per segment. */
  offloadReady: () => boolean
  /** Has the user opted this capture into Mac offload (already AND-ed with !onDeviceOnly)? */
  offloadToMac: boolean
}

export function createCaptureSttExecutor(deps: CaptureSttDeps): SttExecutor {
  return {
    transcribe: async input => {
      const useMac = deps.offloadToMac && deps.offloadReady()
      const result = await dispatchStt(
        { segmentId: input.segmentId, executor: useMac ? 'mac' : 'phone' },
        input,
        { phone: deps.phone, mac: useMac ? deps.mac : undefined }
      )
      if (!result.ok) {
        throw new Error(result.error)
      }
      return { text: result.text }
    }
  }
}

export function createDefaultCaptureSttExecutor(opts: {
  offloadToMac: boolean
  language?: string
}): SttExecutor {
  return createCaptureSttExecutor({
    phone: createDefaultPhoneSttExecutor(opts.language),
    mac: createDefaultMacSttExecutor(opts.language),
    offloadReady: macOffloadReady,
    offloadToMac: opts.offloadToMac
  })
}
