/**
 * Chat meets the experts: when a question belongs to a subject Atlas has an expert for, that expert's cited knowledge is added to
 * the system prompt for that turn, labelled by how far it can be trusted. Questions outside every expert's subject get nothing
 * added, and any failure here is silent: chat must never break because knowledge could not be read.
 */
import { expertContext, listProfiles, routeSubject } from './agents';

export async function expertKnowledgeNote(question: string): Promise<string> {
  try {
    if (question.trim().length < 12 || !(await listProfiles()).length) return '';
    const route = await routeSubject(question, { createIfMissing: false });
    if (!route) return '';
    const { text, findings } = await expertContext(route.agentId, question, 4);
    if (!findings.length) return '';
    return `\n\nWhat Atlas has learned that bears on this question (from its ${route.topicId.replace(/-/g, ' ')} expert). Use it when it helps, cite the document and page, say which parts are provisional, and do not claim it beyond what it says:\n${text}`;
  } catch {
    return '';
  }
}
