/**
 * The day journal: builds a diary-style prompt from conversation summaries, cleans the reply, and
 * reports why it is empty (nothing to narrate / no model / error) rather than degrading silently.
 */

import {
  buildJournalMessages,
  cleanJournal,
  type JournalSource
} from '../../../../src/services/ambient/journalPrompt'
import { generateDayJournal, type JournalDeps } from '../../../../src/services/ambient/journal'

const day: JournalSource[] = [
  { title: 'Standup', headline: 'Agreed to ship Friday.', people: ['Priya'] },
  { title: 'Vendor call', headline: 'Leaning Option B.', people: [] }
]

describe('buildJournalMessages', () => {
  it('asks for a short narrative and embeds the conversations with people', () => {
    const [system, user] = buildJournalMessages(day)
    expect(system.content).toMatch(/diary/i)
    expect(system.content).not.toContain('!')
    expect(user.content).toContain('Standup (with Priya): Agreed to ship Friday.')
    expect(user.content).toContain('Vendor call: Leaning Option B.')
  })
})

describe('cleanJournal', () => {
  it('strips a leaked thinking block and trims', () => {
    expect(cleanJournal('<think>hmm</think>  A busy day. ')).toBe('A busy day.')
  })
})

describe('generateDayJournal', () => {
  const ready: Pick<JournalDeps, 'isReady'> = { isReady: () => true }

  it('narrates the day from the conversations that have a summary', async () => {
    const deps: JournalDeps = { ...ready, generate: async () => 'A build-focused day with Priya.' }
    const res = await generateDayJournal(day, deps)
    expect(res).toEqual({ text: 'A build-focused day with Priya.', status: 'ok' })
  })

  it('reports no-speech when nothing has a summary, without calling the model', async () => {
    let called = false
    const res = await generateDayJournal([{ title: 'x', headline: '   ', people: [] }], {
      isReady: () => true,
      generate: async () => {
        called = true
        return 'x'
      }
    })
    expect(called).toBe(false)
    expect(res.status).toBe('no-speech')
  })

  it('reports no-model when no engine is ready, without calling the model', async () => {
    let called = false
    const res = await generateDayJournal(day, {
      isReady: () => false,
      generate: async () => {
        called = true
        return 'x'
      }
    })
    expect(called).toBe(false)
    expect(res.status).toBe('no-model')
  })

  it('degrades to error when the model throws', async () => {
    const res = await generateDayJournal(day, { ...ready, generate: async () => { throw new Error('boom') } })
    expect(res).toEqual({ text: '', status: 'error' })
  })
})
