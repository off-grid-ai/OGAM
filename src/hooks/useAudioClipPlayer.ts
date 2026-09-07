/**
 * Play a local WAV clip through react-native-audio-api (the same engine the app records with).
 *
 * Loads the clip into an AudioBuffer once, then plays/stops on demand. Buffer sources are one-shot, so
 * each play makes a fresh source. Native audio - not exercised in unit tests; the Replay screen mocks
 * this hook. Device verification pending.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioContext } from 'react-native-audio-api'
import logger from '../utils/logger'

export interface AudioClipPlayer {
  ready: boolean
  playing: boolean
  error: string | null
  toggle: () => void
}

export function useAudioClipPlayer(clipPath: string | null): AudioClipPlayer {
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<Awaited<ReturnType<AudioContext['decodeAudioData']>> | null>(null)
  const sourceRef = useRef<ReturnType<AudioContext['createBufferSource']> | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setReady(false)
    setError(null)
    bufferRef.current = null
    if (!clipPath) return
    const ctx = ctxRef.current ?? new AudioContext()
    ctxRef.current = ctx
    ctx
      .decodeAudioData(clipPath)
      .then(buffer => {
        if (cancelled) return
        bufferRef.current = buffer
        setReady(true)
      })
      .catch(e => {
        if (cancelled) return
        logger.warn('[ambient] replay decode failed', e)
        setError('Could not load this clip.')
      })
    return () => {
      cancelled = true
      try {
        sourceRef.current?.stop()
      } catch {
        /* not started */
      }
    }
  }, [clipPath])

  const toggle = useCallback(() => {
    const ctx = ctxRef.current
    const buffer = bufferRef.current
    if (!ctx || !buffer) return
    if (playing) {
      try {
        sourceRef.current?.stop()
      } catch {
        /* already stopped */
      }
      setPlaying(false)
      return
    }
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onEnded = () => setPlaying(false)
    sourceRef.current = source
    source.start()
    setPlaying(true)
  }, [playing])

  return { ready, playing, error, toggle }
}
