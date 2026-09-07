/**
 * Contract guard: the phone STT executor factory transcribes through the shared speech port, which
 * routes on-device whisper OR a remote target on its own. This pins that the factory calls the port
 * (not a renamed whisperService method) and that the port module exists — the kind of glue no unit
 * test exercises, which otherwise only explodes on-device.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '../../../..')
const factory = readFileSync(join(root, 'src/services/ambient/phoneSttExecutorFactory.ts'), 'utf8')

describe('phoneSttExecutorFactory ↔ speech port contract', () => {
  it('transcribes through mobileSpeechInputPorts.transcriber', () => {
    expect(factory).toContain('mobileSpeechInputPorts.transcriber.transcribe(')
  })

  it('the speech port module exists and exposes a transcriber', () => {
    const port = readFileSync(join(root, 'src/services/adapters/speech/mobileSpeechInputPorts.ts'), 'utf8')
    expect(/transcriber\s*:/.test(port)).toBe(true)
    expect(/async transcribe\s*\(/.test(port)).toBe(true)
  })
})
