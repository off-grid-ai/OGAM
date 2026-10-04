/**
 * System recording control while the Day recorder runs:
 *   - Android: an ongoing foreground-service notification with a Stop action (RecordingControlModule).
 *   - iOS: a Live Activity — Dynamic Island + lock screen — with a Stop control (RecordingLiveActivityModule).
 *
 * Both let the user stop the recording without opening the app, and keep it alive in the background.
 * The recorder (useAmbientCapture) calls the same three functions regardless of platform.
 */
import { NativeModules, NativeEventEmitter, DeviceEventEmitter, Platform } from 'react-native'

interface AndroidNative {
  start(elapsedMs: number): Promise<void>
  stop(): Promise<void>
}
interface IosNative {
  start(): Promise<void>
  stop(): Promise<void>
}

const androidNative = NativeModules.RecordingControlModule as AndroidNative | undefined
const iosNative = NativeModules.RecordingLiveActivityModule as IosNative | undefined

const ANDROID_EVENT = 'RecordingNotificationAction'
const IOS_EVENT = 'RecordingLiveActivityAction'

/** Show the system recording control (notification / Live Activity). `elapsedMs` seeds the timer. */
export function showRecordingNotification(elapsedMs = 0): void {
  if (Platform.OS === 'android') {
    void androidNative?.start(elapsedMs).catch(() => undefined)
  } else if (Platform.OS === 'ios') {
    void iosNative?.start().catch(() => undefined)
  }
}

/** Remove the notification / end the Live Activity. */
export function hideRecordingNotification(): void {
  if (Platform.OS === 'android') {
    void androidNative?.stop().catch(() => undefined)
  } else if (Platform.OS === 'ios') {
    void iosNative?.stop().catch(() => undefined)
  }
}

/** Fire when the user taps Stop from the notification / Live Activity. Returns an unsubscribe. */
export function onRecordingNotificationAction(listener: (action: 'stop') => void): () => void {
  if (Platform.OS === 'android') {
    const sub = DeviceEventEmitter.addListener(ANDROID_EVENT, (event: { action?: string }) => {
      if (event?.action === 'stop') listener('stop')
    })
    return () => sub.remove()
  }
  if (Platform.OS === 'ios' && iosNative) {
    const emitter = new NativeEventEmitter(iosNative as unknown as never)
    const sub = emitter.addListener(IOS_EVENT, (event: { action?: string }) => {
      if (event?.action === 'stop') listener('stop')
    })
    return () => sub.remove()
  }
  return () => undefined
}
