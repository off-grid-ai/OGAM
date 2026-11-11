import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ParsedSkill } from './parseSkill';

export interface Skill extends ParsedSkill { enabled: boolean; addedAt: number }

interface SkillsState {
  skills: Skill[];
  /** Adds a skill, or replaces the one with the same name (keeping whether it was switched on). */
  add: (skill: ParsedSkill) => void;
  remove: (name: string) => void;
  setEnabled: (name: string, on: boolean) => void;
}

/** Skills the person added. Text only: whatever sits next to a SKILL.md (scripts, references) is not kept or run. */
export const useSkills = create<SkillsState>()(persist((set) => ({
  skills: [],
  add: (skill) => set((s) => {
    const old = s.skills.find((x) => x.name === skill.name);
    const next: Skill = { ...skill, enabled: old?.enabled ?? true, addedAt: old?.addedAt ?? Date.now() };
    return { skills: [...s.skills.filter((x) => x.name !== skill.name), next].slice(-50) };
  }),
  remove: (name) => set((s) => ({ skills: s.skills.filter((x) => x.name !== name) })),
  setEnabled: (name, on) => set((s) => ({ skills: s.skills.map((x) => (x.name === name ? { ...x, enabled: on } : x)) })),
}), { name: 'atlas-skills', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ skills: s.skills }) }));
