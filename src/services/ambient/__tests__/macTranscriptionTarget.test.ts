import {
  resolveMacOffloadTarget,
  transcriptionEndpoint,
  registerMacOffloadTargetProvider,
  currentMacOffloadTarget,
  type CompanionServerView
} from '../macTranscriptionTarget'

const macGranted: CompanionServerView = {
  id: 'srv-1',
  url: 'http://192.168.1.18:7878/mcp',
  authHeaderValue: 'tok-abc',
  grantedByDeviceId: 'mac-1'
}
const macIds = new Set(['mac-1'])
const connected = (): boolean => true

describe('resolveMacOffloadTarget', () => {
  it('turns a reachable Mac-granted companion into a gateway target (strips /mcp)', () => {
    expect(resolveMacOffloadTarget([macGranted], connected, macIds)).toEqual({
      baseUrl: 'http://192.168.1.18:7878',
      token: 'tok-abc'
    })
  })

  it('skips a companion granted by a non-Mac (or unpaired) device', () => {
    expect(resolveMacOffloadTarget([macGranted], connected, new Set(['other']))).toBeNull()
  })

  it('skips a companion with no bearer token', () => {
    const noTok = { ...macGranted, authHeaderValue: undefined }
    expect(resolveMacOffloadTarget([noTok], connected, macIds)).toBeNull()
  })

  it('skips a companion whose url is not the /mcp gateway', () => {
    const notMcp = { ...macGranted, url: 'http://192.168.1.18:7878/other' }
    expect(resolveMacOffloadTarget([notMcp], connected, macIds)).toBeNull()
  })

  it('skips a companion that is not connected', () => {
    expect(resolveMacOffloadTarget([macGranted], () => false, macIds)).toBeNull()
  })

  it('returns null when there are no companions', () => {
    expect(resolveMacOffloadTarget([], connected, macIds)).toBeNull()
  })
})

describe('transcriptionEndpoint', () => {
  it('appends the transcription path to the gateway base', () => {
    expect(transcriptionEndpoint('http://192.168.1.18:7878')).toBe(
      'http://192.168.1.18:7878/v1/audio/transcriptions'
    )
    expect(transcriptionEndpoint('http://host:7878/')).toBe(
      'http://host:7878/v1/audio/transcriptions'
    )
  })
})

describe('the offload target port', () => {
  it('returns null with no provider, the provider value once registered, and null after dispose', () => {
    expect(currentMacOffloadTarget()).toBeNull()
    const dispose = registerMacOffloadTargetProvider(() => ({
      baseUrl: 'http://host:7878',
      token: 't'
    }))
    expect(currentMacOffloadTarget()).toEqual({ baseUrl: 'http://host:7878', token: 't' })
    dispose()
    expect(currentMacOffloadTarget()).toBeNull()
  })
})
