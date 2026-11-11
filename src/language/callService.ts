/**
 * Owns a practice phone call: whose turn it is, the microphone, the model and the voice. The call
 * screen only shows `state` and sends taps (talk, hint, hang up), so no call logic lives in the view.
 *
 * A turn: the learner talks (the phone's speech recognizer, in the language being learned) -> the
 * model writes the caller's reply -> each sentence is spoken as soon as it is written, while the
 * model carries on writing the rest -> the microphone opens again.
 */
import { speakInAndWait, stop as stopSpeech } from '../atlasVoice/tts';
import { LANGUAGES, model } from './languageService';
import { slotForText, voiceForSlot } from './voices';
import { listenInLanguage } from './listenTurn';
import { useLanguage } from './store';
import {
  CALL_TURNS_TO_PASS, callMessages, callSystemPrompt, hintMessages, parseHint, parseReview, reviewMessages, sentencesOf,
  type Correction, type Scenario, type Turn,
} from './phoneCall';

export type CallPhase = 'ringing' | 'speaking' | 'thinking' | 'listening' | 'transcribing' | 'idle' | 'ended';

export interface CallState {
  phase: CallPhase;
  turns: Turn[];
  /** What the recognizer has heard so far in the learner's turn. */
  partial: string;
  note: string | null;
  hint: { say: string; en: string } | null;
  /** The phone has no speech recognizer: the learner types their lines instead. */
  typing: boolean;
  /** The learner has said enough for a board call to count as done. */
  passed: boolean;
  corrections: Correction[] | null;
  /** The AI model is not loaded and could not be: the call cannot start until it is. */
  needsModel: boolean;
}

export interface Call {
  state: () => CallState;
  subscribe: (fn: () => void) => () => void;
  /** Answer the phone: the caller speaks first. */
  start: () => void;
  /** Open the microphone (also interrupts the caller). */
  talk: () => void;
  /** Stop listening and use what was heard. */
  doneTalking: () => void;
  /** The learner's line, typed. */
  say: (text: string) => void;
  /** Ask for a suggestion of what to say. */
  askHint: () => void;
  /** Hang up and check the learner's lines for mistakes. */
  hangUp: () => Promise<void>;
  /** Hang up without the check (leaving the screen). */
  dispose: () => void;
}

/** Sentences of `text` that are finished (end with . ! ?), skipping any thinking block. */
export function finishedSentences(text: string): string[] {
  if (/<think>(?![\s\S]*<\/think>)/.test(text)) return [];
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  return (clean.match(/[^.!?…]+[.!?…]+/g) ?? []).map((s) => s.replace(/[*_#`]/g, '').trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

export function createCall(scenario: Scenario): Call {
  const { language: code, level } = useLanguage.getState();
  const language = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const system = callSystemPrompt(scenario, language, level);
  // The caller keeps one voice for the whole call, different from the voices of other scenarios.
  const callerVoice = voiceForSlot(code, slotForText(scenario.id));
  let s: CallState = { phase: 'ringing', turns: [], partial: '', note: null, hint: null, typing: false, passed: false, corrections: null, needsModel: false };
  const listeners = new Set<() => void>();
  // Every new turn bumps this, so a late result from a turn that was interrupted or ended is ignored.
  let epoch = 0;
  let listening: { stop: () => void; cancel: () => void } | null = null;
  let alive = true;

  const set = (patch: Partial<CallState>) => { s = { ...s, ...patch }; listeners.forEach((fn) => fn()); };
  const mine = () => s.turns.filter((t) => t.who === 'me').length;

  /** The caller's reply, spoken sentence by sentence as it is written. */
  const reply = async (turn: number) => {
    set({ phase: 'thinking', partial: '', hint: null });
    let spoken = 0;
    let queue: Promise<unknown> = Promise.resolve();
    const speak = (sentence: string) => {
      queue = queue.then(async () => {
        if (turn !== epoch) return;
        set({ phase: 'speaking' });
        await speakInAndWait(sentence, code, { messageId: 'call', voice: await callerVoice });
      });
    };
    try {
      const llm = await model();
      let text = '';
      await llm.generateResponse(callMessages(system, s.turns), {
        disableThinking: true,
        onStream: (t: { content?: string }) => {
          if (turn !== epoch) return;
          text += t.content ?? '';
          const done = finishedSentences(text);
          while (spoken < done.length) speak(done[spoken++]);
        },
      });
      if (turn !== epoch) return;
      const all = sentencesOf(text);
      while (spoken < all.length) speak(all[spoken++]);
      const line = all.join(' ') || text.trim();
      if (!line) throw new Error('The caller did not say anything. Tap the microphone to try again.');
      set({ turns: [...s.turns, { who: 'them', text: line }] });
      await queue;
    } catch (e: any) {
      if (turn === epoch) set({ phase: 'idle', note: String(e?.message || e) });
      return;
    }
    if (turn === epoch && alive) listen();
  };

  const finishTurn = (heard: string, turn: number) => {
    if (turn !== epoch) return;
    const text = heard.trim();
    listening = null;
    if (!text) { set({ phase: 'idle', partial: '', note: 'Nothing heard. Tap the microphone and try again.' }); return; }
    const turns: Turn[] = [...s.turns, { who: 'me', text }];
    set({ turns, partial: '', note: null, passed: s.passed || turns.filter((t) => t.who === 'me').length >= CALL_TURNS_TO_PASS });
    reply(++epoch);
  };

  const listen = async () => {
    const turn = ++epoch;
    set({ phase: 'listening', partial: '', note: null, hint: null });
    try {
      // The same engine as Atlas's transcription (Whisper) when it can understand the language, else the phone's recognizer.
      const session = await listenInLanguage(code, { keepTextModel: true, onPartial: (p) => { if (turn === epoch) set({ partial: p }); }, onTranscribing: () => { if (turn === epoch) set({ phase: 'transcribing' }); } });
      if (!session) { set({ phase: 'idle', typing: true, note: 'This phone has no speech recognizer. Type what you would say.' }); return; }
      if (turn !== epoch) { session.cancel(); return; }
      listening = session;
      finishTurn(await session.result, turn);
    } catch (e: any) {
      if (e?.name === 'SpeechCancelled' || turn !== epoch) return;
      set({ phase: 'idle', typing: true, note: `${String(e?.message || e)} You can type your line instead.` });
    }
  };

  return {
    state: () => s,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    start: () => {
      if (s.phase !== 'ringing') return;
      // The caller needs the AI to answer: load it before anything is said, and say so if it cannot be loaded.
      set({ note: 'Loading the AI model...' });
      model().then(() => { if (alive) { set({ note: null }); reply(++epoch); } })
        .catch((e: any) => { if (alive) set({ phase: 'idle', needsModel: true, note: `${String(e?.message || e)} Load the model, then tap Talk.` }); });
    },
    talk: () => {
      listening?.cancel(); stopSpeech(); epoch++;
      if (!s.needsModel) { listen(); return; }
      set({ note: 'Loading the AI model...' });
      model().then(() => { if (alive) { set({ needsModel: false, note: null }); s.turns.length ? listen() : reply(++epoch); } })
        .catch((e: any) => { if (alive) set({ note: String(e?.message || e) }); });
    },
    doneTalking: () => listening?.stop(),
    say: (text) => { if (text.trim()) { epoch++; finishTurn(text, epoch); } },
    askHint: () => {
      const turn = epoch;
      model().then((llm) => llm.generateResponse(hintMessages(system, s.turns, language), { disableThinking: true }))
        .then((raw: string) => { if (turn === epoch) set({ hint: parseHint(raw) ?? { say: raw.trim().split('\n')[0], en: '' } }); })
        .catch((e: any) => set({ note: String(e?.message || e) }));
    },
    hangUp: async () => {
      alive = false; epoch++;
      listening?.cancel(); stopSpeech();
      set({ phase: 'ended', corrections: null });
      if (!mine()) { set({ corrections: [] }); return; }
      try {
        const llm = await model();
        set({ corrections: parseReview(await llm.generateResponse(reviewMessages(language, s.turns), { disableThinking: true })) });
      } catch (e: any) {
        set({ corrections: [], note: `Could not check your lines: ${String(e?.message || e)}` });
      }
    },
    dispose: () => { alive = false; epoch++; listening?.cancel(); stopSpeech(); listeners.clear(); },
  };
}
