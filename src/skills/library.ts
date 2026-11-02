/**
 * Skills that come with Atlas: one tap adds them to Skills. Plain instructions in the same format as any SKILL.md
 * (nothing is run). Each description says when it fits, because that is what Atlas matches your message against.
 */
import type { ParsedSkill } from './parseSkill';

const skill = (name: string, description: string, body: string): ParsedSkill => ({ name, description, body, userInvocable: true, needs: [] });

export const SKILL_LIBRARY: ParsedSkill[] = [
  skill('summarize', 'Summarize a long text, article, email or document into the key points.',
    'Give the summary in this order: one sentence saying what the text is, then 3 to 6 short bullet points with the key facts, then any decision, deadline or number that matters. Keep to what the text says. If it is very long, say which parts you focused on.'),
  skill('explain-simply', 'Explain a hard idea, term or topic in plain words, like to a curious beginner.',
    'Start with a one-sentence plain answer. Then explain with one everyday comparison. Avoid jargon; if a term is needed, define it in a few words. End by offering to go deeper on one part. Never talk down to the reader.'),
  skill('proofread', 'Proofread, correct and tidy writing: fix spelling, grammar and punctuation without changing the meaning.',
    'Return the corrected text first, unchanged in meaning and voice. Then list the main fixes in at most 5 short bullets. Do not rewrite sentences that are already fine.'),
  skill('rewrite-tone', 'Rewrite a message in another tone: more polite, friendlier, shorter, formal, firm or casual.',
    'Ask which tone only if it is not clear. Give the rewrite first, in the same language and keeping every fact. Offer one alternative that is shorter. Do not add promises or details the author did not write.'),
  skill('email-reply', 'Write a reply to an email or message the user pasted.',
    'Read the message and write a short reply that answers every question in it. Match the sender\'s formality. If a fact is missing (a date, a price, a yes or no), put it in [brackets] for the user to fill in instead of inventing it. Offer a text-message version if useful.'),
  skill('meeting-notes', 'Turn rough notes or a transcript of a meeting into clear minutes with decisions and action items.',
    'Write: Topic and date if known; Decisions (bullets); Action items as a table with Owner, Task and Due; Open questions. Keep names exactly as written. Do not invent owners or dates: write "unassigned" or "no date".'),
  skill('text-to-table', 'Put information, a list or a comparison into a table that is easy to copy.',
    'Reply with one markdown table: a short header row, one row per item, consistent columns, no empty cells (use a dash). Keep cell text short. Add one line under the table saying how it is sorted. The table can be copied with its Copy button.'),
  skill('study-quiz', 'Quiz the user on a topic or on notes they pasted, one question at a time, to help them study.',
    'Ask one question at a time and wait for the answer. After each answer say if it is right, give the correct answer in one sentence, then ask the next. Start easy and get harder. After 10 questions, show the score and the topics to review. Use only facts from the notes when notes are given.'),
  skill('flashcards', 'Make flashcards from notes or a topic for studying.',
    'Make 10 to 20 cards as a table with the columns Front and Back. Front is a short question or term; Back is the answer in at most 15 words. Cover the whole text evenly, no duplicates. Offer to quiz the user with them.'),
  skill('math-steps', 'Solve a math or numbers problem and show the steps clearly.',
    'Restate what is asked in one line. Show each step on its own line with the calculation. Check the result with a quick sanity test. Give the final answer on a line of its own with the unit. Use the calculator tool for long arithmetic when it is available.'),
  skill('decision-helper', 'Help the user decide between options with pros and cons and a recommendation.',
    'List the options. For each give 2 to 4 pros and cons as a table. Ask at most two questions about what matters most if the answer would change the choice. Then give a clear recommendation with the one main reason, and say what would change it.'),
  skill('trip-planner', 'Plan a trip, a day out or an itinerary.',
    'Ask for dates, budget and what the user likes only if missing. Give a day-by-day plan with morning, afternoon and evening, rough travel time between stops, and one backup idea for rain. Do not state opening hours, prices or booking details as facts; tell the user to check them.'),
  skill('recipe-from-ingredients', 'Suggest a recipe from the ingredients the user has at home.',
    'Suggest up to 3 dishes that use mostly what was listed. For the one the user picks, give ingredients with amounts, numbered steps, and the time. Name anything extra that is needed. Mention allergies or dietary needs if the user gave them.'),
  skill('daily-planner', 'Plan the day, a to-do list or a week from the tasks and time the user has.',
    'Put the tasks in a time-blocked plan: the most important first, similar tasks together, breaks included, and a realistic total. Ask how much time there is only if missing. End with the one task to do first. Offer to add the plan to the calendar.'),
  skill('code-explainer', 'Explain what a piece of code does, find a bug or suggest a fix.',
    'First say in one or two sentences what the code does. Then walk through it in the order it runs. If asked about a bug, show the exact line, why it fails, and the corrected code in a code block. Do not change anything that was not asked about.'),
  skill('fact-check-careful', 'Check a claim carefully and say how sure you are, instead of guessing.',
    'Say whether the claim is true, false, partly true or unknown to you. Give the reason in two or three sentences. If it is about recent events, prices or medical advice, say you may be out of date and use web search when it is available. Never make up sources.'),
  skill('brainstorm', 'Brainstorm ideas, names, gifts, titles or ways to solve a problem.',
    'Give 10 distinct ideas, grouped by kind, each with a few words of why. Mark the 3 best with a star and say why. Then ask which direction to push further.'),
];
