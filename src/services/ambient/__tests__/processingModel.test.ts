import {
  shouldRotate,
  processOnStop,
  ALWAYS_ON_ROTATE_MS,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_PROCESSING_MODE
} from '../processingModel'

describe('processingModel', () => {
  describe('shouldRotate', () => {
    it('does not rotate before the window elapses', () => {
      expect(shouldRotate(ALWAYS_ON_ROTATE_MS - 1)).toBe(false)
      expect(shouldRotate(0)).toBe(false)
    })

    it('rotates once the window is reached or passed', () => {
      expect(shouldRotate(ALWAYS_ON_ROTATE_MS)).toBe(true)
      expect(shouldRotate(ALWAYS_ON_ROTATE_MS + 1)).toBe(true)
    })

    it('honours an explicit rotate window over the default', () => {
      expect(shouldRotate(500, 1000)).toBe(false)
      expect(shouldRotate(1000, 1000)).toBe(true)
    })
  })

  describe('processOnStop', () => {
    it('processes immediately in live mode, defers in nightly', () => {
      expect(processOnStop('live')).toBe(true)
      expect(processOnStop('nightly')).toBe(false)
    })
  })

  it('defaults are one-tap + live', () => {
    expect(DEFAULT_CAPTURE_MODE).toBe('session')
    expect(DEFAULT_PROCESSING_MODE).toBe('live')
  })
})
