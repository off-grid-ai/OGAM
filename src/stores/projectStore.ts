import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Project } from '../types';
import { generateId } from '../utils/generateId';
import { ragService } from '../services/rag';
import { useChatStore } from './chatStore';
import logger from '../utils/logger';

interface ProjectState {
  projects: Project[];

  // Actions
  createProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Project;
  /** Add a project with a fixed id if one with that id doesn't already exist (idempotent). Used to seed system projects like "Recordings". */
  ensureProject: (project: Omit<Project, 'createdAt' | 'updatedAt'>) => void;
  updateProject: (id: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) => void;
  deleteProject: (id: string) => void;
  getProject: (id: string) => Project | undefined;
  duplicateProject: (id: string) => Project | null;
}

// Default projects as examples
const DEFAULT_PROJECTS: Project[] = [
  {
    id: 'default-assistant',
    name: 'General Assistant',
    description: 'A helpful, concise AI assistant for everyday tasks',
    systemPrompt: 'You are a helpful AI assistant running locally on the user\'s device. Be concise and helpful. Focus on providing accurate information and solving the user\'s problems efficiently.',
    icon: '#6366F1', // Indigo
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'spanish-learning',
    name: 'Spanish Learning',
    description: 'Practice Spanish conversation and get corrections',
    systemPrompt: `You are a patient Spanish tutor. Help the user practice their Spanish conversation skills.

Guidelines:
- Respond in Spanish, but provide English translations in parentheses for difficult words
- Gently correct any grammar or vocabulary mistakes the user makes
- Explain corrections briefly
- Adjust your complexity based on the user's apparent level
- Encourage the user and make learning fun
- When the user writes in English, respond in Spanish and encourage them to try in Spanish`,
    icon: '#F59E0B', // Amber
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'code-review',
    name: 'Code Review',
    description: 'Get feedback on your code',
    systemPrompt: `You are an experienced software engineer reviewing code. When the user shares code:

- Point out potential bugs, edge cases, or errors
- Suggest improvements for readability and maintainability
- Note any security concerns
- Recommend best practices
- Be constructive and explain your reasoning
- If the code looks good, say so

Keep feedback actionable and specific.`,
    icon: '#10B981', // Emerald
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'writing-helper',
    name: 'Writing Helper',
    description: 'Help with writing, editing, and brainstorming',
    systemPrompt: `You are a skilled writing assistant. Help the user with:

- Brainstorming ideas and outlines
- Improving clarity and flow
- Fixing grammar and punctuation
- Adjusting tone (formal, casual, professional, etc.)
- Making text more concise or more detailed as needed

When editing, explain your changes. When brainstorming, offer multiple options.`,
    icon: '#8B5CF6', // Violet
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: DEFAULT_PROJECTS,

      createProject: (projectData) => {
        const project: Project = {
          ...projectData,
          id: generateId(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          projects: [...state.projects, project],
        }));

        return project;
      },

      ensureProject: (projectData) => {
        if (get().projects.some((p) => p.id === projectData.id)) return;
        const now = new Date().toISOString();
        set((state) => ({
          projects: [...state.projects, { ...projectData, createdAt: now, updatedAt: now }],
        }));
      },

      updateProject: (id, updates) => {
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id
              ? { ...project, ...updates, updatedAt: new Date().toISOString() }
              : project
          ),
        }));
      },

      deleteProject: (id) => {
        ragService.deleteProjectDocuments(id).catch((err) => logger.error(`Failed to delete RAG documents for project ${id}`, err));
        // Cascade: unfile the project's chats so none is left pointing at a project that
        // no longer exists (a dangling projectId isn't re-filable and still tripped the
        // KB-tool injection). The project store owns "what happens on delete" (like RAG
        // cleanup above); chatStore owns the conversation mutation.
        useChatStore.getState().unfileConversationsForProject(id);
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== id),
        }));
      },

      getProject: (id) => {
        return get().projects.find((project) => project.id === id);
      },

      duplicateProject: (id) => {
        const original = get().getProject(id);
        if (!original) return null;

        const duplicate: Project = {
          ...original,
          id: generateId(),
          name: `${original.name} (Copy)`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          projects: [...state.projects, duplicate],
        }));

        return duplicate;
      },
    }),
    {
      name: 'local-llm-project-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
