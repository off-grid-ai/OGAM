/**
 * Processing mode: live processes on stop, nightly defers.
 */
import { processOnStop, DEFAULT_PROCESSING_MODE } from '../../../../src/services/ambient/processingModel'

describe('processOnStop', () => {
  it('processes immediately in live mode, defers in nightly', () => {
    expect(processOnStop('live')).toBe(true)
    expect(processOnStop('nightly')).toBe(false)
  })
  it('defaults to live', () => {
    expect(DEFAULT_PROCESSING_MODE).toBe('live')
  })
})
