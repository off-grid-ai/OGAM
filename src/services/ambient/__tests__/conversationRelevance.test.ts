import {
  scoreRelevance,
  ownerParticipation,
  importanceHeuristic,
  importanceFromSummary,
  assessConversation,
  DEFAULT_RELEVANCE_THRESHOLD,
  type RelevanceFactors
} from '../conversationRelevance'
import type { AmbientSummary } from '../summaryPrompt'
import type { DiarizedTurn } from '../speakerDiarizer'
import type { ClusterIdentity } from '../diarizationModel'

const OWNER = 'owner-1'
const owner = (): ClusterIdentity => ({ speakerId: OWNER, speakerName: 'Sidd', known: true })
const stranger = (n: number): ClusterIdentity => ({ speakerId: `cluster:spk${n}`, speakerName: `Speaker ${n}`, known: false })

describe('scoreRelevance', () => {
  it('excludes null factors and renormalizes the remaining weights', () => {
    // Only participation + importance present; near-field missing. Mean of 0.8 and 0.2 (equal weights) = 0.5.
    const f: RelevanceFactors = { nearField: null, ownerParticipation: 0.8, importance: 0.2 }
    const v = scoreRelevance(f)
    expect(v.usedFactors).toEqual(['ownerParticipation', 'importance'])
    expect(v.score).toBeCloseTo(0.5, 5)
  })

  it('keeps when the score clears the threshold and drops when it does not', () => {
    expect(scoreRelevance({ nearField: 0.9, ownerParticipation: 0.9, importance: 0.9 }).keep).toBe(true)
    expect(scoreRelevance({ nearField: 0.1, ownerParticipation: 0.1, importance: 0.1 }).keep).toBe(false)
  })

  it('fails OPEN when no factor is available — never silently drops a conversation', () => {
    const v = scoreRelevance({ nearField: null, ownerParticipation: 0, importance: null }, { weights: { nearField: 0, ownerParticipation: 0, importance: 0 } })
    expect(v.keep).toBe(true)
    expect(v.reason).toMatch(/kept by default/)
  })

  it('clamps out-of-range factor values', () => {
    const v = scoreRelevance({ nearField: 2, ownerParticipation: -1, importance: null })
    expect(v.score).toBeGreaterThanOrEqual(0)
    expect(v.score).toBeLessThanOrEqual(1)
  })

  it('gives an explainable reason string', () => {
    const v = scoreRelevance({ nearField: null, ownerParticipation: 0.9, importance: 0.9 })
    expect(v.reason).toContain('kept')
    expect(v.reason).toContain('ownerParticipation')
  })

  it('keepIfOwnerPresent guarantees a kept conversation whenever the owner took part', () => {
    // Low everything, but the owner is present → conservative guard keeps it.
    const v = scoreRelevance(
      { nearField: 0.1, ownerParticipation: 0.5, importance: 0.0 },
      { keepIfOwnerPresent: true, threshold: 0.9 }
    )
    expect(v.keep).toBe(true)
    expect(v.reason).toMatch(/owner present/)
  })

  it('keepIfOwnerPresent does NOT save an absent-owner conversation', () => {
    const v = scoreRelevance(
      { nearField: 0.1, ownerParticipation: 0, importance: 0.1 },
      { keepIfOwnerPresent: true, threshold: 0.5 }
    )
    expect(v.keep).toBe(false)
  })
})

describe('conservative stance (v1 default)', () => {
  const names = { spk0: owner(), spk1: stranger(1) }

  it('keeps any conversation the owner is in, even boring/quiet ones', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 4000, cluster: 'spk1' },
      { startMs: 4000, endMs: 4400, cluster: 'spk0' } // one short owner turn
    ]
    const v = assessConversation(
      { turns, names, ownerSpeakerId: OWNER, transcript: 'um yeah ok sure', nearField: 0.2 },
      { stance: 'conservative' }
    )
    expect(v.keep).toBe(true)
  })

  it('sends a clearly overheard, absent-owner conversation to the ambient bucket', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 3000, cluster: 'spk1' },
      { startMs: 3000, endMs: 6000, cluster: 'spk1' }
    ]
    const v = assessConversation(
      { turns, names: { spk1: stranger(1) }, ownerSpeakerId: OWNER, transcript: 'the bus was late again', nearField: 0.2 },
      { stance: 'conservative' }
    )
    expect(v.keep).toBe(false)
  })
})

describe('ownerParticipation', () => {
  const names: Record<string, ClusterIdentity> = { spk0: owner(), spk1: stranger(1) }

  it('is 0 when the owner never speaks (overheard conversation)', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 1000, cluster: 'spk1' },
      { startMs: 1000, endMs: 2000, cluster: 'spk1' }
    ]
    expect(ownerParticipation(turns, names, OWNER)).toBe(0)
  })

  it('rewards a real back-and-forth even when the owner talks little (owner-listening case)', () => {
    // Owner speaks once; the rest is the other person — but the owner IS in the turn-taking.
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 3000, cluster: 'spk1' },
      { startMs: 3000, endMs: 3500, cluster: 'spk0' }, // owner: a short backchannel
      { startMs: 3500, endMs: 7000, cluster: 'spk1' }
    ]
    const score = ownerParticipation(turns, names, OWNER)
    expect(score).toBeGreaterThan(DEFAULT_RELEVANCE_THRESHOLD) // present + interleaved → kept-worthy
  })

  it('is 0.5 for a solo owner monologue (present, but no dialogue)', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 1000, cluster: 'spk0' },
      { startMs: 1000, endMs: 2000, cluster: 'spk0' }
    ]
    expect(ownerParticipation(turns, { spk0: owner() }, OWNER)).toBe(0.5)
  })

  it('scores a lively even exchange near the top', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 900, cluster: 'spk0' },
      { startMs: 900, endMs: 1800, cluster: 'spk1' },
      { startMs: 1800, endMs: 2700, cluster: 'spk0' },
      { startMs: 2700, endMs: 3600, cluster: 'spk1' }
    ]
    expect(ownerParticipation(turns, names, OWNER)).toBeCloseTo(1, 5)
  })

  it('is 0 for no turns', () => {
    expect(ownerParticipation([], names, OWNER)).toBe(0)
  })
})

describe('importanceHeuristic', () => {
  it('returns null for empty/absent transcript (excluded, not treated as unimportant)', () => {
    expect(importanceHeuristic('')).toBeNull()
    expect(importanceHeuristic(null)).toBeNull()
    expect(importanceHeuristic(undefined)).toBeNull()
  })

  it('scores owner-world / commitment language higher than neutral chatter', () => {
    const task = importanceHeuristic("I'll send you the deck tomorrow and book the meeting.") ?? 0
    const noise = importanceHeuristic('the weather turned grey and the bus was late again downtown') ?? 0
    expect(task).toBeGreaterThan(noise)
  })
})

describe('importanceFromSummary', () => {
  const summary = (over: Partial<AmbientSummary>): AmbientSummary => ({
    title: 'Chat',
    headline: '',
    decisions: [],
    actionItems: [],
    people: [],
    ...over
  })

  it('returns null for an essentially empty summary', () => {
    expect(importanceFromSummary(summary({}))).toBeNull()
    expect(importanceFromSummary(null)).toBeNull()
  })

  it('scores decisions/action items higher than plain chatter', () => {
    const idle = importanceFromSummary(summary({ headline: 'They chatted about the weather.' })) ?? 0
    const worky =
      importanceFromSummary(
        summary({ headline: 'Planned the launch.', decisions: ['ship Friday'], actionItems: ['send deck'] })
      ) ?? 0
    expect(worky).toBeGreaterThan(idle)
  })

  it('nudges up when the owner is named among participants', () => {
    const base = summary({ headline: 'Synced on the plan.', people: ['Priya'] })
    const withOwner = summary({ headline: 'Synced on the plan.', people: ['Priya', 'Sidd'] })
    expect((importanceFromSummary(withOwner, 'Sidd') ?? 0)).toBeGreaterThan(
      importanceFromSummary(base, 'Sidd') ?? 0
    )
  })
})

describe('assessConversation', () => {
  it('drops an overheard far-field conversation the owner is not in', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 2000, cluster: 'spk1' },
      { startMs: 2000, endMs: 4000, cluster: 'spk1' }
    ]
    const names = { spk1: stranger(1) }
    const v = assessConversation({
      turns,
      names,
      ownerSpeakerId: OWNER, // owner assigned no cluster here → participation 0
      transcript: 'did you catch the game last night it went to overtime',
      nearField: 0.2
    })
    expect(v.keep).toBe(false)
  })

  it('keeps a conversation the owner is actively part of', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 900, cluster: 'spk0' },
      { startMs: 900, endMs: 1800, cluster: 'spk1' },
      { startMs: 1800, endMs: 2700, cluster: 'spk0' }
    ]
    const names = { spk0: owner(), spk1: stranger(1) }
    const v = assessConversation({
      turns,
      names,
      ownerSpeakerId: OWNER,
      transcript: "let's decide the plan, I'll follow up tomorrow",
      nearField: 0.9
    })
    expect(v.keep).toBe(true)
  })

  it('treats a null owner (nothing enrolled) as zero participation', () => {
    const turns: DiarizedTurn[] = [{ startMs: 0, endMs: 1000, cluster: 'spk0' }]
    const v = assessConversation({ turns, names: { spk0: stranger(0) }, ownerSpeakerId: null, nearField: 0.1 })
    expect(v.score).toBeLessThan(DEFAULT_RELEVANCE_THRESHOLD)
  })
})
