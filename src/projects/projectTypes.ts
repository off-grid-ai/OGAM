/**
 * Kinds of project. A kind sets the starting instructions the AI follows in that project's chats and the quick starts shown
 * on its page (each opens a new chat with the request already typed). Language learning is not here: it has its own tab.
 */
export type ProjectKind = 'general' | 'school' | 'work';

export interface QuickStart { label: string; icon: string; prompt: string }
export interface ProjectTypeDef { id: ProjectKind; name: string; icon: string; hint: string; instructions: string; starts: QuickStart[] }

export const PROJECT_TYPES: ProjectTypeDef[] = [
  { id: 'general', name: 'General', icon: 'folder', hint: 'Your own instructions and documents', instructions: '', starts: [] },
  {
    id: 'school', name: 'School', icon: 'book', hint: 'Notes and homework: explain, quiz, plan',
    instructions: 'You are a patient study helper for school work. Use the project\'s documents first and say which one you used. Explain step by step in plain words and check understanding with a short question. For homework, show how to get to the answer instead of only giving it. If the subject or level is unclear, ask.',
    starts: [
      { label: 'Quiz me', icon: 'help-circle', prompt: 'Quiz me on my documents: ask one question at a time and wait for my answer before the next.' },
      { label: 'Explain simply', icon: 'message-circle', prompt: 'Explain the main idea of my documents in simple words, then give me one example.' },
      { label: 'Study plan', icon: 'calendar', prompt: 'Make a 5-day study plan from my documents. First ask me how many minutes a day I have.' },
      { label: 'Check my answer', icon: 'check-circle', prompt: 'I will paste my answer to a question. Tell me what is right, what is missing and how to improve it, without rewriting it for me.' },
    ],
  },
  {
    id: 'work', name: 'Work', icon: 'briefcase', hint: 'Documents, notes, emails and meetings',
    instructions: 'You are a concise, professional work assistant. Use the project\'s documents first. Lead with the answer, then short bullet points. For emails and messages write a ready-to-send draft in a neutral professional tone. Flag what you are unsure about instead of guessing.',
    starts: [
      { label: 'Summarize', icon: 'align-left', prompt: 'Summarize my documents in 5 bullet points, then list the open questions.' },
      { label: 'Action items', icon: 'check-square', prompt: 'From my notes, list the action items with an owner and a due date where they are mentioned.' },
      { label: 'Draft an email', icon: 'mail', prompt: 'Draft a short professional email for me. First ask who it is for and what I need.' },
      { label: 'Meeting agenda', icon: 'users', prompt: 'Write a 30 minute meeting agenda for this project with a time for each item.' },
    ],
  },
];

export const projectType = (kind?: string): ProjectTypeDef => PROJECT_TYPES.find((t) => t.id === kind) ?? PROJECT_TYPES[0];

/** True when the instructions are empty or still exactly a kind's starting text, so choosing another kind may replace them. */
export const isStarterInstructions = (text: string): boolean =>
  !text.trim() || PROJECT_TYPES.some((t) => !!t.instructions && t.instructions.trim() === text.trim());
