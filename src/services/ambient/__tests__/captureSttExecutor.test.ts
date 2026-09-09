import { createCaptureSttExecutor } from '../captureSttExecutorFactory'
import type { SttExecutor, SttInput } from '../sttExecutor'

const input: SttInput = { segmentId: 's1', recordingPath: '/rec.wav', startMs: 0, endMs: 1000 }
const fake = (text: string): SttExecutor => ({ transcribe: async () => ({ text }) })
const throwing = (): SttExecutor => ({
  transcribe: async () => {
    throw new Error('backend down')
  }
})

describe('createCaptureSttExecutor', () => {
  it('uses the Mac when offload is on and a Mac is reachable', async () => {
    const exec = createCaptureSttExecutor({
      phone: fake('phone'),
      mac: fake('mac'),
      offloadReady: () => true,
      offloadToMac: true
    })
    expect(await exec.transcribe(input)).toEqual({ text: 'mac' })
  })

  it('falls back to the phone when the Mac backend throws', async () => {
    const exec = createCaptureSttExecutor({
      phone: fake('phone'),
      mac: throwing(),
      offloadReady: () => true,
      offloadToMac: true
    })
    expect(await exec.transcribe(input)).toEqual({ text: 'phone' })
  })

  it('stays on the phone when no Mac is reachable', async () => {
    const exec = createCaptureSttExecutor({
      phone: fake('phone'),
      mac: fake('mac'),
      offloadReady: () => false,
      offloadToMac: true
    })
    expect(await exec.transcribe(input)).toEqual({ text: 'phone' })
  })

  it('stays on the phone when offload is off, even with a Mac reachable', async () => {
    const exec = createCaptureSttExecutor({
      phone: fake('phone'),
      mac: fake('mac'),
      offloadReady: () => true,
      offloadToMac: false
    })
    expect(await exec.transcribe(input)).toEqual({ text: 'phone' })
  })

  it('throws when both backends fail (so the builder skips the segment)', async () => {
    const exec = createCaptureSttExecutor({
      phone: throwing(),
      mac: throwing(),
      offloadReady: () => true,
      offloadToMac: true
    })
    await expect(exec.transcribe(input)).rejects.toThrow()
  })
})
