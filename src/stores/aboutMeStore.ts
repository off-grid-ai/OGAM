import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** What the person tells the assistant about themselves, one box per kind of fact so each is easy to fill in and change. */
export interface AboutMe {
  name: string;
  age: string;
  work: string;
  helpWith: string;
  interests: string;
  notes: string;
}
export const ABOUT_FIELDS: Array<{ key: keyof AboutMe; label: string; placeholder: string; multiline?: boolean }> = [
  { key: 'name', label: 'Name', placeholder: 'What should I call you?' },
  { key: 'age', label: 'Age', placeholder: 'e.g. 34 (optional)' },
  { key: 'work', label: 'What you do', placeholder: 'Job, studies, or what fills your days', multiline: true },
  { key: 'helpWith', label: 'How I can help you', placeholder: 'e.g. plan my week, explain things simply, keep me on track', multiline: true },
  { key: 'interests', label: 'Interests', placeholder: 'Hobbies, topics, teams', multiline: true },
  { key: 'notes', label: 'Anything else', placeholder: 'Allergies, family, preferences, anything I should always know', multiline: true },
];
export const EMPTY_ABOUT: AboutMe = { name: '', age: '', work: '', helpWith: '', interests: '', notes: '' };

interface State {
  about: AboutMe;
  /** Lasting facts the assistant saved with the remember tool when no agent was selected. */
  memories: string[];
  setField: (key: keyof AboutMe, value: string) => void;
  addMemory: (fact: string) => 'saved' | 'exists';
  removeMemory: (index: number) => void;
}

export const useAboutMe = create<State>()(persist((set, get) => ({
  about: EMPTY_ABOUT,
  memories: [],
  setField: (key, value) => set((s) => ({ about: { ...s.about, [key]: value.slice(0, 600) } })),
  addMemory: (fact) => {
    const f = fact.trim();
    if (get().memories.some((m) => m.toLowerCase() === f.toLowerCase())) return 'exists';
    set((s) => ({ memories: [...s.memories, f].slice(-100) }));
    return 'saved';
  },
  removeMemory: (index) => set((s) => ({ memories: s.memories.filter((_, i) => i !== index) })),
}), { name: 'atlas-about-me', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ about: s.about, memories: s.memories }) }));

/** The prompt note about the user, or '' when nothing is filled in. `fallbackName` is the older Settings > Your name. */
export function aboutMeNote(about: AboutMe, memories: string[], fallbackName = ''): string {
  const lines = [
    (about.name || fallbackName).trim() && `Name: ${(about.name || fallbackName).trim()}`,
    about.age.trim() && `Age: ${about.age.trim()}`,
    about.work.trim() && `What they do: ${about.work.trim()}`,
    about.helpWith.trim() && `How they want you to help: ${about.helpWith.trim()}`,
    about.interests.trim() && `Interests: ${about.interests.trim()}`,
    about.notes.trim() && `Also: ${about.notes.trim()}`,
    ...memories.map((m) => `Remembered: ${m}`),
  ].filter(Boolean);
  if (!lines.length) return '';
  return `\n\nABOUT THE USER (they told you this; use it naturally when it helps, never recite it):\n${lines.join('\n')}`;
}
