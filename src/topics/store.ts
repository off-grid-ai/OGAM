import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { localUniqueId } from '../utils/uniqueId';
import type { CoursePlan, CourseRequest, PlannedSquare, SquareContent } from './formats';

export interface Course {
  id: string;
  topic: string;
  title: string;
  summary: string;
  style: string;
  theme: string;
  request: CourseRequest;
  squares: PlannedSquare[];
  content: Record<string, SquareContent>;
  progress: Record<string, { stars: number }>;
  createdAt: number;
  lastPlayedAt?: number;
}

interface TopicsState {
  courses: Course[];
  add: (request: CourseRequest, plan: CoursePlan) => string;
  remove: (id: string) => void;
  setContent: (id: string, key: string, content: SquareContent) => void;
  complete: (id: string, key: string, stars: number) => void;
}

export const useTopics = create<TopicsState>()(persist((set) => ({
  courses: [],
  add: (request, plan) => {
    const id = localUniqueId('course');
    const course: Course = {
      id, topic: request.topic, title: plan.title, summary: plan.summary, style: plan.style, theme: plan.theme, request,
      squares: plan.squares, content: {}, progress: {}, createdAt: Date.now(),
    };
    set((s) => ({ courses: [course, ...s.courses].slice(0, 20) }));
    return id;
  },
  remove: (id) => set((s) => ({ courses: s.courses.filter((c) => c.id !== id) })),
  setContent: (id, key, content) => set((s) => ({ courses: s.courses.map((c) => (c.id === id ? { ...c, content: { ...c.content, [key]: content } } : c)) })),
  complete: (id, key, stars) => set((s) => ({
    courses: s.courses.map((c) => (c.id === id
      ? { ...c, lastPlayedAt: Date.now(), progress: { ...c.progress, [key]: { stars: Math.max(stars, c.progress[key]?.stars ?? 0) } } } : c)),
  })),
}), { name: 'atlas-topics', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ courses: s.courses }) }));

/** Progress of a course: squares done, of the total. */
export const courseProgress = (c: Course) => ({ done: c.squares.filter((s) => c.progress[s.key]).length, total: c.squares.length });
