/**
 * The summary parser earns its keep on MESSY model output, so that is what this pins: clean JSON, JSON
 * buried in prose, a leaked <think> block, a string where a list belongs, missing fields, and total
 * garbage. A thin summary is acceptable; a crash on the timeline is not. Also guards the prompt asks
 * for the exact fields the parser reads (contract), and the brand rule of no exclamation marks.
 */

import {
  buildSummaryMessages,
  parseAmbientSummary,
  EMPTY_SUMMARY
} from '../../../../src/services/ambient/summaryPrompt'

describe('parseAmbientSummary', () => {
  it('parses a clean JSON object', () => {
    const out = parseAmbientSummary(
      '{"title":"Vendor pricing","headline":"They will send a revised quote.","decisions":["Go with vendor B"],"actionItems":["Send PO Monday"],"people":["Priya"]}'
    )
    expect(out).toEqual({
      title: 'Vendor pricing',
      headline: 'They will send a revised quote.',
      decisions: ['Go with vendor B'],
      actionItems: ['Send PO Monday'],
      people: ['Priya']
    })
  })

  it('extracts JSON even when the model wraps it in prose', () => {
    const out = parseAmbientSummary(
      'Sure! Here is the summary:\n{"title":"Standup","headline":"Agreed to ship Friday.","decisions":[],"actionItems":["Fix the build"],"people":[]}\nHope that helps.'
    )
    expect(out.title).toBe('Standup')
    expect(out.actionItems).toEqual(['Fix the build'])
  })

  it('ignores a leaked <think> block before the JSON', () => {
    const out = parseAmbientSummary(
      '<think>The user wants JSON. Let me find decisions.</think>{"title":"Sync","headline":"Quick catch-up.","decisions":[],"actionItems":[],"people":["Sam","Alex"]}'
    )
    expect(out.people).toEqual(['Sam', 'Alex'])
    expect(out.title).toBe('Sync')
  })

  it('coerces a single string into a one-item list', () => {
    const out = parseAmbientSummary('{"title":"X","headline":"Y","decisions":"Ship it","actionItems":[],"people":[]}')
    expect(out.decisions).toEqual(['Ship it'])
  })

  it('drops empty/non-string list entries and trims', () => {
    const out = parseAmbientSummary(
      '{"title":"X","headline":"Y","decisions":["  keep  ","",null,42,"drop-blank"],"actionItems":[],"people":[]}'
    )
    expect(out.decisions).toEqual(['keep', 'drop-blank'])
  })

  it('falls back to defaults for missing fields', () => {
    const out = parseAmbientSummary('{"headline":"Only a headline."}')
    expect(out.title).toBe(EMPTY_SUMMARY.title)
    expect(out.headline).toBe('Only a headline.')
    expect(out.decisions).toEqual([])
  })

  it('returns the empty summary for non-JSON garbage', () => {
    expect(parseAmbientSummary('I could not summarise that.')).toEqual(EMPTY_SUMMARY)
    expect(parseAmbientSummary('')).toEqual(EMPTY_SUMMARY)
  })
})

describe('buildSummaryMessages', () => {
  it('asks for exactly the fields the parser reads, and embeds the transcript', () => {
    const [system, user] = buildSummaryMessages('Alice: hello\nBob: hi')
    expect(system.role).toBe('system')
    for (const field of ['title', 'headline', 'decisions', 'actionItems', 'people']) {
      expect(system.content).toContain(field)
    }
    expect(user.content).toContain('Alice: hello')
  })

  it('includes flagged moments and tells the model to reflect them', () => {
    const [, user] = buildSummaryMessages('Alice: hello', ['ship by Friday', 'renew the domain'])
    expect(user.content).toContain('flagged these moments')
    expect(user.content).toContain('- ship by Friday')
    expect(user.content).toContain('- renew the domain')
  })

  it('omits the flagged block when nothing was flagged', () => {
    const [, user] = buildSummaryMessages('Alice: hello')
    expect(user.content).not.toContain('flagged')
  })

  it('keeps the brand voice — no exclamation marks in the instructions', () => {
    const [system] = buildSummaryMessages('x')
    expect(system.content).not.toContain('!')
  })
})
