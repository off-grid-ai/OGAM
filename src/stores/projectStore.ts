import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { protectedProjectStorage } from './protectedProjectStorage';
import { isProtectedProjectUnlocked } from './protectionState';
import { Project } from '../types';
import { generateId } from '../utils/generateId';
import { ragService } from '../services/rag';

import logger from '../utils/logger';
import { LANGUAGE_PROJECT_ID, LANGUAGE_PROJECT_NAME, languageProjectDescription, tutorPrompt } from '../language/tutor';
import { registerProjectStore } from './storeRefs';

/** Earlier versions shipped this as "Spanish Learning"; it becomes the Learn a language course project. */
function upgradeLanguageProject(p: Project): Project {
  if (p.id !== LANGUAGE_PROJECT_ID || p.course) return p;
  const untouched = p.name === 'Spanish Learning';
  return { ...p, course: 'language', ...(untouched ? { name: LANGUAGE_PROJECT_NAME, description: languageProjectDescription('Spanish') } : {}) };
}

interface ProjectState {
  projects: Project[];

  // Actions
  createProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>) => Project;
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
    id: LANGUAGE_PROJECT_ID,
    name: LANGUAGE_PROJECT_NAME,
    description: languageProjectDescription('Spanish'),
    systemPrompt: tutorPrompt('Spanish'),
    course: 'language',
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

      updateProject: (id, updates) => {
        // Secret metadata must only change through authenticated vault helpers.
        if ('pinVerifier' in updates || 'protectedBlob' in updates) {
          throw new Error('Project protection can only change after PIN verification.');
        }
        const selected = get().projects.find(p => p.id === id);
        if (selected?.pinVerifier && !isProtectedProjectUnlocked(id)) throw new Error('Unlock this project before editing it.');
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id
              ? { ...project, ...updates, updatedAt: new Date().toISOString() }
              : project
          ),
        }));
      },

      deleteProject: (id) => {
        const selected = get().projects.find(p => p.id === id);
        if (selected?.pinVerifier && !isProtectedProjectUnlocked(id)) {
          throw new Error('Unlock this protected project before deleting it.');
        }
        ragService.deleteProjectDocuments(id).catch((err) => logger.error(`Failed to delete RAG documents for project ${id}`, err));
        // Cascade: unfile the project's chats so none is left pointing at a project that
        // no longer exists (a dangling projectId isn't re-filable and still tripped the
        // KB-tool injection). The project store owns "what happens on delete" (like RAG
        // cleanup above); chatStore owns the conversation mutation.
        require('./storeRefs').chatStoreRef().getState().unfileConversationsForProject(id);
        set((state) => ({
          projects: state.projects.filter((project) => project.id !== id),
        }));
      },

      getProject: (id) => {
        return get().projects.find((project) => project.id === id);
      },

      duplicateProject: (id) => {
        const original = get().getProject(id);
        if (!original || original.pinVerifier) return null;

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
      storage: createJSONStorage(() => protectedProjectStorage),
      merge: (saved: any, current) => ({
        ...current,
        ...saved,
        projects: Array.isArray(saved?.projects) ? saved.projects.map(upgradeLanguageProject) : current.projects,
      }),
    }
  )
);

// The persist adapter and the vaults under this store reach it through this handle (no import cycle).
registerProjectStore(useProjectStore);
