/**
 * Ask-your-day: answer a natural-language question over the conversations of your day.
 *
 * Retrieval is keyword-ranked over each conversation's summary + transcript (pure, no embeddings for
 * this first version - the day is small and this is fast and explainable), then the top few become
 * context for one grounded completion. Generation reuses the app's engine-agnostic seam, so the answer
 * runs on whatever text model is active - local llama, local LiteRT, or the user's remote server -
 * exactly like the summaries. The answer cites the conversations it drew from so you can jump to them.
 *
 * The pure halves (ranking, prompt) are here and tested; the model call is injected.
 */

import type { Message } from '../../types'
import type { TimelineSession } from './timelineModel'

export interface RankedSession {
  session: TimelineSession
  score: number
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'was', 'were', 'did', 'does', 'what', 'when', 'who', 'why', 'how', 'you',
  'your', 'did', 'have', 'has', 'about', 'that', 'this', 'with', 'from', 'they', 'them', 'are', 'our'
])

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t))
}

/** All the searchable text of a conversation: its summary fields plus every transcript line. */
export function sessionText(session: TimelineSession): string {
  const { summary } = session
  return [
    summary.title,
    summary.headline,
    ...summary.decisions,
    ...summary.actionItems,
    ...summary.people,
    ...session.segments.map(s => s.transcript ?? '')
  ]
    .join(' ')
    .toLowerCase()
}

/**
 * Rank conversations by how many query terms they contain, most relevant first. Ties break toward the
 * more recent conversation. Returns only conversations with a non-zero match, capped at `limit`.
 */
export function rankSessionsForQuery(
  sessions: TimelineSession[],
  query: string,
  limit: number
): RankedSession[] {
  const queryTerms = terms(query)
  if (queryTerms.length === 0) return []
  return sessions
    .map(session => {
      const text = sessionText(session)
      const score = queryTerms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      return { session, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.session.startMs - a.session.startMs))
    .slice(0, limit)
}

const ASK_SYSTEM = [
  'You answer a question using ONLY the conversations provided from the user\'s day.',
  'Be concise and specific. Quote what was actually said or decided.',
  'If the conversations do not contain the answer, say you could not find it in the day.',
  'Do not invent facts. No hype, no exclamation marks.'
].join('\n')

/** Build the grounded ask prompt from the ranked conversations (each labelled with its clock time). */
export function buildAskMessages(
  question: string,
  ranked: RankedSession[],
  clockOf: (epochMs: number) => string
): Message[] {
  const context = ranked
    .map(({ session }) => {
      const lines = session.segments
        .map(s => s.transcript)
        .filter((t): t is string => !!t)
        .join(' ')
      return `[${clockOf(session.startMs)}] ${session.summary.title}: ${session.summary.headline}\n${lines}`
    })
    .join('\n\n')
  return [
    { id: 'ambient-ask-sys', role: 'system', content: ASK_SYSTEM, timestamp: 0 },
    {
      id: 'ambient-ask-user',
      role: 'user',
      content: `Conversations from today:\n${context}\n\nQuestion: ${question}`,
      timestamp: 0
    }
  ]
}

export type AskStatus = 'ok' | 'empty-question' | 'no-model' | 'no-matches' | 'error'

export interface AskResult {
  answer: string
  /** The conversations the answer drew from, so the UI can link to them. */
  sources: TimelineSession[]
  status: AskStatus
}

export interface AskDeps {
  generate: (messages: Message[]) => Promise<string>
  isReady: () => boolean
}

/** Answer a question over the day's conversations, reporting why when it cannot. */
export async function askDay(
  question: string,
  sessions: TimelineSession[],
  deps: AskDeps,
  clockOf: (epochMs: number) => string,
  limit = 4
): Promise<AskResult> {
  if (question.trim().length === 0) return { answer: '', sources: [], status: 'empty-question' }
  if (!deps.isReady()) return { answer: '', sources: [], status: 'no-model' }
  const ranked = rankSessionsForQuery(sessions, question, limit)
  if (ranked.length === 0) return { answer: '', sources: [], status: 'no-matches' }
  try {
    const answer = await deps.generate(buildAskMessages(question, ranked, clockOf))
    return { answer: answer.trim(), sources: ranked.map(r => r.session), status: 'ok' }
  } catch {
    return { answer: '', sources: [], status: 'error' }
  }
}
