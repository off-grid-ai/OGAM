/**
 * The conversation-grouping rule, pinned on real segment streams: short pauses stay in one session, a
 * long silence starts a new one, a marathon is force-split, and the split is order-independent.
 */

import {
  sessionizeSegments,
  DEFAULT_SESSIONIZER_CONFIG,
  type SessionizerConfig
} from '../../../../src/services/ambient/sessionizer'

const cfg: SessionizerConfig = { sessionGapMs: 90_000, maxSessionMs: 30 * 60_000 }

describe('sessionizeSegments', () => {
  it('keeps segments separated by short pauses in one conversation', () => {
    const sessions = sessionizeSegments(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 5_000, endMs: 7_000 }, // 3s pause — same conversation
        { startMs: 9_000, endMs: 11_000 }
      ],
      cfg
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0].segments).toHaveLength(3)
    expect(sessions[0].startMs).toBe(0)
    expect(sessions[0].endMs).toBe(11_000)
  })

  it('starts a new conversation after a silence longer than the gap threshold', () => {
    const sessions = sessionizeSegments(
      [
        { startMs: 0, endMs: 2_000 },
        { startMs: 2_000 + 120_000, endMs: 2_000 + 124_000 } // 2min silence — new conversation
      ],
      cfg
    )
    expect(sessions).toHaveLength(2)
    expect(sessions[0].endMs).toBe(2_000)
    expect(sessions[1].startMs).toBe(122_000)
  })

  it('force-splits a session that runs past the max length', () => {
    const segments = []
    // one segment per minute for 40 minutes, no gap ever exceeding the threshold
    for (let m = 0; m < 40; m += 1) segments.push({ startMs: m * 60_000, endMs: m * 60_000 + 3_000 })
    const sessions = sessionizeSegments(segments, cfg)
    expect(sessions.length).toBeGreaterThan(1) // 30min cap forced a boundary
    expect(sessions[0].endMs - sessions[0].startMs).toBeLessThanOrEqual(cfg.maxSessionMs + 3_000)
  })

  it('is order-independent — an out-of-order queue still groups chronologically', () => {
    const sessions = sessionizeSegments(
      [
        { startMs: 9_000, endMs: 11_000 },
        { startMs: 0, endMs: 2_000 },
        { startMs: 5_000, endMs: 7_000 }
      ],
      cfg
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0].segments.map(s => s.startMs)).toEqual([0, 5_000, 9_000])
  })

  it('gives each session a stable id from its own span', () => {
    const [session] = sessionizeSegments([{ startMs: 1_000, endMs: 2_000 }], cfg)
    expect(session.id).toBe('s_1000_2000')
  })

  it('returns nothing for an empty stream', () => {
    expect(sessionizeSegments([], cfg)).toEqual([])
  })

  it('ships review-tuned defaults (90s gap, 30min cap)', () => {
    expect(DEFAULT_SESSIONIZER_CONFIG).toEqual({ sessionGapMs: 90_000, maxSessionMs: 1_800_000 })
  })
})
