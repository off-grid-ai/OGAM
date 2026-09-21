/**
 * App-wide Live (always-on) recorder daemon.
 *
 * Mounted once in MainSurface (i.e. only after the app is unlocked and ready) so that Live mode
 * starts recording the moment the app launches — on any screen, not just the Ambient Day screen —
 * and, via useAlwaysOnCapture's foreground re-assert, keeps itself alive across background trips.
 * Renders nothing; it only owns orchestration of the shared useAmbientCapture singleton.
 */
import { useAmbientCapture } from '../hooks/useAmbientCapture'
import { useAlwaysOnCapture } from '../hooks/useAlwaysOnCapture'
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore'

export function AlwaysOnDaemon(): null {
  const capture = useAmbientCapture()
  const captureMode = useAmbientTimelineStore(s => s.captureMode)
  useAlwaysOnCapture(capture, captureMode === 'always-on')
  return null
}
