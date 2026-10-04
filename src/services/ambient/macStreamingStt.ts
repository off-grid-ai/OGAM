/**
 * Mobile client for the Mac's streaming-transcription WebSocket (true streamed offload).
 *
 * Opens a socket to the paired Mac's gateway, streams the mic's Int16 PCM frames up as they are
 * captured, and surfaces the partial/final text the Mac pushes back. It rides the SAME gateway target
 * (base URL + token) the batch offload already uses — no new pairing. If the socket never opens or
 * drops, `isReady()` stays false and the recorder falls back to the on-device / per-segment path, so a
 * flaky link degrades to Phase-1 behaviour instead of losing the transcript.
 */
import { currentMacOffloadTarget } from './macTranscriptionTarget'

const STREAM_PATH = '/v1/audio/stream'

function streamingWsUrl(baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/$/, '').replace(/^http/, 'ws')
  return `${base}${STREAM_PATH}?token=${encodeURIComponent(token)}`
}

/** Convert mono Float32 [-1,1] to a little-endian Int16 PCM ArrayBuffer for the wire. */
function toInt16Buffer(pcm: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(pcm.length * 2)
  const view = new DataView(buf)
  for (let i = 0; i < pcm.length; i += 1) {
    const clamped = pcm[i] < -1 ? -1 : pcm[i] > 1 ? 1 : pcm[i]
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  return buf
}

export interface StreamingSttClient {
  /** Push one captured mic frame. Dropped silently until the socket is open. */
  pushFrame(pcm: Float32Array): void
  /** Phrase boundary — ask the Mac to finalize what it has buffered, then start a fresh phrase. */
  flush(): void
  /** End the session and close the socket. */
  stop(): void
  /** Is the socket open and streaming right now? The recorder uses this to pick streaming vs fallback. */
  isReady(): boolean
}

export interface StreamingSttOptions {
  sampleRate: number
  language?: string
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onReadyChange?: (ready: boolean) => void
}

/** Open a streaming session to the paired Mac, or null when no Mac target is currently reachable. */
export function createMacStreamingSttClient(opts: StreamingSttOptions): StreamingSttClient | null {
  const target = currentMacOffloadTarget()
  if (!target) return null

  let ready = false
  let closed = false
  const socket = new WebSocket(streamingWsUrl(target.baseUrl, target.token))
  socket.binaryType = 'arraybuffer'

  const setReady = (value: boolean): void => {
    if (value === ready) return
    ready = value
    opts.onReadyChange?.(value)
  }
  const isOpen = (): boolean => !closed && socket.readyState === WebSocket.OPEN

  socket.onopen = (): void => {
    if (closed) {
      socket.close()
      return
    }
    socket.send(
      JSON.stringify({
        t: 'start',
        sampleRate: opts.sampleRate,
        ...(opts.language ? { language: opts.language } : {})
      })
    )
    setReady(true)
  }
  socket.onmessage = (event): void => {
    if (typeof event.data !== 'string') return
    try {
      const msg = JSON.parse(event.data) as { t?: string; text?: unknown }
      const text = typeof msg.text === 'string' ? msg.text : ''
      if (msg.t === 'partial') opts.onPartial(text)
      else if (msg.t === 'final') opts.onFinal(text)
    } catch {
      // A malformed frame is not worth tearing the session down.
    }
  }
  socket.onerror = (): void => setReady(false)
  socket.onclose = (): void => setReady(false)

  return {
    pushFrame(pcm: Float32Array): void {
      if (!ready || !isOpen() || pcm.length === 0) return
      try {
        socket.send(toInt16Buffer(pcm))
      } catch {
        setReady(false)
      }
    },
    flush(): void {
      if (isOpen()) {
        try {
          socket.send(JSON.stringify({ t: 'flush' }))
        } catch {
          /* best-effort */
        }
      }
    },
    stop(): void {
      closed = true
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ t: 'stop' }))
        } catch {
          /* best-effort */
        }
      }
      try {
        socket.close()
      } catch {
        /* best-effort */
      }
      setReady(false)
    },
    isReady(): boolean {
      return ready
    }
  }
}
