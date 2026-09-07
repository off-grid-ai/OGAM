/**
 * The summariser glue: it must call the model with the built prompt and parse the reply, skip the
 * model entirely for an empty transcript, and degrade to the empty summary when the model throws (no
 * text model loaded) - never propagate the error onto the timeline. Plus a source-level contract guard
 * that the factory calls a real llmService method, since that call is I/O no unit test exercises.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { summarizeTranscript, type SummarizeDeps } from '../../../../src/services/ambient/summarizer'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'

describe('summarizeTranscript', () => {
  it('runs the transcript through the model and returns the parsed summary', async () => {
    const calls: Array<{ maxTokens: number; userContent: string }> = []
    const deps: SummarizeDeps = {
      isReady: () => true,
      generate: async (messages, maxTokens) => {
        calls.push({ maxTokens, userContent: messages[1].content })
        return '{"title":"Standup","headline":"Shipping Friday.","decisions":[],"actionItems":["fix build"],"people":[]}'
      }
    }
    const { summary, status } = await summarizeTranscript('Alice: ship it', deps)
    expect(status).toBe('ok')
    expect(summary.title).toBe('Standup')
    expect(summary.actionItems).toEqual(['fix build'])
    expect(calls[0].userContent).toContain('Alice: ship it')
    expect(calls[0].maxTokens).toBeGreaterThan(0)
  })

  it('never calls the model for an empty transcript', async () => {
    let called = false
    const deps: SummarizeDeps = {
      isReady: () => true,
      generate: async () => {
        called = true
        return '{}'
      }
    }
    const { summary, status } = await summarizeTranscript('   ', deps)
    expect(called).toBe(false)
    expect(status).toBe('no-speech')
    expect(summary).toEqual(EMPTY_SUMMARY)
  })

  it('reports no-model without calling generate when no text model is loaded', async () => {
    let called = false
    const { summary, status } = await summarizeTranscript('something', {
      isReady: () => false,
      generate: async () => {
        called = true
        return '{}'
      }
    })
    expect(called).toBe(false)
    expect(status).toBe('no-model')
    expect(summary).toEqual(EMPTY_SUMMARY)
  })

  it('degrades to the empty summary when the model throws (no text model loaded)', async () => {
    const deps: SummarizeDeps = {
      isReady: () => true,
      generate: async () => {
        throw new Error('engine failure')
      }
    }
    const { summary, status } = await summarizeTranscript('something', deps)
    expect(status).toBe('error')
    expect(summary).toEqual(EMPTY_SUMMARY)
  })
})

describe('summarizerFactory ↔ shared generation contract', () => {
  const root = join(__dirname, '../../../..')
  const factory = readFileSync(join(root, 'src/services/ambient/summarizerFactory.ts'), 'utf8')

  it('generates through the shared executeMobileText seam (local + remote)', () => {
    expect(factory).toContain('executeMobileText(')
    expect(() => readFileSync(join(root, 'src/services/mobileSidecarGeneration.ts'), 'utf8')).not.toThrow()
  })

  it('readiness recognises a remote model via mobileTextEngineControl', () => {
    expect(factory).toContain('mobileTextEngineControl.isRemoteActive')
    expect(() => readFileSync(join(root, 'src/services/modelServices/textEngineControl.ts'), 'utf8')).not.toThrow()
  })
})
