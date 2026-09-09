/**
 * Always-on capture: keep the recorder running passively, rotating the capture on an interval so files
 * stay bounded and each chunk can be processed on its own. Composes the shared useAmbientCapture - it
 * just auto-starts when idle and finalises+restarts every rotation window.
 *
 * The iOS background-audio survival (staying alive with the screen off) is a native concern verified on
 * a device; this owns the orchestration, which is what's testable.
 */

import { useEffect, useRef } from 'react'
import { ALWAYS_ON_ROTATE_MS } from '../services/ambient/processingModel'
import type { AmbientCapture } from './useAmbientCapture'

export function useAlwaysOnCapture(
  capture: AmbientCapture,
  enabled: boolean,
  rotateMs: number = ALWAYS_ON_ROTATE_MS
): void {
  // Auto-start when enabled and nothing is running.
  useEffect(() => {
    if (enabled && capture.phase === 'idle') {
      void capture.start()
    }
  }, [enabled, capture.phase, capture.start])

  // Rotate: finalise the current capture on the interval; the auto-start effect starts the next one.
  const rotating = useRef(false)
  useEffect(() => {
    if (!enabled || !capture.recording) {
      return
    }
    const id = setInterval(() => {
      if (rotating.current) return
      rotating.current = true
      void capture.stop().finally(() => {
        rotating.current = false
      })
    }, rotateMs)
    return () => clearInterval(id)
  }, [enabled, capture.recording, capture.stop, rotateMs])
}
