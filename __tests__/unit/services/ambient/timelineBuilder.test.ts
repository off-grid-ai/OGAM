/**
 * The capture -> timeline join, through the real sessionizer + probe transcription with fake executor
 * and summariser. Proves one capture becomes conversation-grouped sessions in ABSOLUTE time, each with
 * its stitched transcript summarised, and that a failed segment still appears (no text) without sinking
 * the session.
 */

import { buildTimelineSessions } from '../../../../src/services/ambient/timelineBuilder'
import type { SttExecutor } from '../../../../src/services/ambient/sttExecutor'

const CAPTURE_AT = 1_000_000

// Echo each segment's span as its "transcript" so we can assert stitching + timing.
const spanExecutor: SttExecutor = {
  transcribe: async input => ({ text: `[${input.startMs}-${input.endMs}]` })
}
const summarizeEcho = async (transcript: string) => ({
  summary: { title: 'T', headline: transcript, decisions: [], actionItems: [], people: [] },
  status: 'ok' as const
})

describe('buildTimelineSessions', () => {
  it('splits a capture into conversations and stamps absolute times', async () => {
    const sessions = await buildTimelineSessions(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 5_000, endMs: 7_000 }, // same conversation
        { startMs: 200_000, endMs: 202_000 } // >90s gap -> new conversation
      ],
      '/rec.wav',
      CAPTURE_AT,
      { executor: spanExecutor, summarize: summarizeEcho }
    )
    expect(sessions).toHaveLength(2)
    // absolute start = capture epoch + relative offset
    expect(sessions[0].startMs).toBe(CAPTURE_AT + 0)
    expect(sessions[0].endMs).toBe(CAPTURE_AT + 7_000)
    expect(sessions[1].startMs).toBe(CAPTURE_AT + 200_000)
    // segments carry absolute times too
    expect(sessions[0].segments[0].startMs).toBe(CAPTURE_AT)
    // audio refs for Replay are persisted
    expect(sessions[0].recordingPath).toBe('/rec.wav')
    expect(sessions[0].captureStartedAtMs).toBe(CAPTURE_AT)
  })

  it('stitches a session transcript and summarises it', async () => {
    const [session] = await buildTimelineSessions(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 5_000, endMs: 7_000 }
      ],
      '/rec.wav',
      CAPTURE_AT,
      { executor: spanExecutor, summarize: summarizeEcho }
    )
    expect(session.summary.headline).toBe('[0-2000] [5000-7000]')
    expect(session.summaryStatus).toBe('ok')
    expect(session.speechMs).toBe(4_000) // 2000 + 2000
  })

  it('keeps a failed segment in the session but out of the transcript', async () => {
    let n = 0
    const flaky: SttExecutor = {
      transcribe: async () => {
        n += 1
        if (n === 1) throw new Error('No Whisper model loaded')
        return { text: 'second' }
      }
    }
    const [session] = await buildTimelineSessions(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 3_000, endMs: 5_000 }
      ],
      '/rec.wav',
      CAPTURE_AT,
      { executor: flaky, summarize: summarizeEcho }
    )
    expect(session.segments.map(s => s.transcript)).toEqual([null, 'second'])
    expect(session.summary.headline).toBe('second') // only transcribed text stitched
  })

  it('transcribes everything before the residency hand-off, and summarises after (phone memory)', async () => {
    const order: string[] = []
    const executor = {
      transcribe: async (input: any) => {
        order.push(`transcribe:${input.startMs}`)
        return { text: `t${input.startMs}` }
      }
    }
    const summarize = async (transcript: string) => {
      order.push(`summarize:${transcript}`)
      return { summary: { title: 'T', headline: transcript, decisions: [], actionItems: [], people: [] }, status: 'ok' as const }
    }
    const prepareForSummaries = async () => {
      order.push('prepare')
    }
    await buildTimelineSessions(
      [
        { startMs: 0, endMs: 1_000 },
        { startMs: 200_000, endMs: 201_000 } // separate conversation
      ],
      '/rec.wav',
      CAPTURE_AT,
      { executor, summarize, prepareForSummaries }
    )
    // every transcribe, THEN the single residency hand-off, THEN every summarize
    expect(order).toEqual([
      'transcribe:0',
      'transcribe:200000',
      'prepare',
      'summarize:t0',
      'summarize:t200000'
    ])
  })

  it('reports progress: transcribing each session, loading the model, then summarising each', async () => {
    const ticks: string[] = []
    await buildTimelineSessions(
      [
        { startMs: 0, endMs: 1_000 },
        { startMs: 200_000, endMs: 201_000 } // two conversations
      ],
      '/rec.wav',
      CAPTURE_AT,
      {
        executor: spanExecutor,
        summarize: summarizeEcho,
        prepareForSummaries: async () => {},
        onProgress: p =>
          ticks.push(p.phase === 'loading-model' ? 'loading-model' : `${p.phase}:${p.done}/${p.total}`)
      }
    )
    expect(ticks).toEqual([
      'transcribing:0/2',
      'transcribing:1/2',
      'loading-model',
      'summarizing:0/2',
      'summarizing:1/2'
    ])
  })

  it('flags the segment nearest each live anchor and feeds flagged snippets to the summary', async () => {
    const seen: Array<{ transcript: string; flagged: string[] }> = []
    const summarizeCapture = async (transcript: string, flagged: string[]) => {
      seen.push({ transcript, flagged })
      return { summary: { title: 'T', headline: transcript, decisions: [], actionItems: [], people: [] }, status: 'ok' as const }
    }
    const [session] = await buildTimelineSessions(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 5_000, endMs: 7_000 }
      ],
      '/rec.wav',
      CAPTURE_AT,
      { executor: spanExecutor, summarize: summarizeCapture },
      [6_000] // a flag during the second segment
    )
    // second segment (id derived from its span) is flagged
    expect(session.flaggedSegmentIds).toEqual(['5000-7000'])
    // the flagged snippet (that segment's transcript) was handed to the summary
    expect(seen[0].flagged).toEqual(['[5000-7000]'])
  })

  it('leaves flaggedSegmentIds empty when nothing was flagged', async () => {
    const [session] = await buildTimelineSessions(
      [{ startMs: 0, endMs: 2_000 }],
      '/rec.wav',
      CAPTURE_AT,
      { executor: spanExecutor, summarize: summarizeEcho }
    )
    expect(session.flaggedSegmentIds).toEqual([])
  })

  it('returns nothing for a capture with no segments', async () => {
    const sessions = await buildTimelineSessions([], '/rec.wav', CAPTURE_AT, {
      executor: spanExecutor,
      summarize: summarizeEcho
    })
    expect(sessions).toEqual([])
  })
})
