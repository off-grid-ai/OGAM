/**
 * Project Store Unit Tests
 *
 * Tests for the project store CRUD operations:
 * - Default projects initialization
 * - createProject
 * - updateProject
 * - deleteProject
 * - getProject
 * - duplicateProject
 */

import { installNativeBoundary } from '../../harness/nativeBoundary';
import { installDocumentEngine, type DocumentEngineBoundary, type DocumentEngineOptions } from '../../harness/documentEngine';

type ProjectStoreModule = typeof import('../../../src/stores/projectStore');
type RagModule = typeof import('../../../src/services/rag');

// The store and the project knowledge base run for real, over the document engine's device boundary
// (in-memory disk, a real in-memory SQLite for rag.db, the embedding model's native call).
let useProjectStore: ProjectStoreModule['useProjectStore'];
let knowledgeBase: RagModule['knowledgeBase'];
let engine: DocumentEngineBoundary;

function launch(options: DocumentEngineOptions = {}) {
  const boundary = installNativeBoundary({ fs: true });
  engine = installDocumentEngine(boundary.fs!, options);
  ({ useProjectStore } = require('../../../src/stores/projectStore') as ProjectStoreModule);
  ({ knowledgeBase } = require('../../../src/services/rag') as RagModule);
}

describe('projectStore', () => {
  beforeEach(() => {
    launch();
    // Reset to default projects
    useProjectStore.setState({
      projects: [
        {
          id: 'default-assistant',
          name: 'General Assistant',
          description: 'A helpful, concise AI assistant for everyday tasks',
          systemPrompt: 'You are a helpful AI assistant.',
          icon: '#6366F1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
  });

  // ============================================================================
  // Initial State
  // ============================================================================
  describe('initial state', () => {
    it('has projects array', () => {
      const state = useProjectStore.getState();
      expect(Array.isArray(state.projects)).toBe(true);
    });

    it('has default projects', () => {
      const state = useProjectStore.getState();
      expect(state.projects.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // createProject
  // ============================================================================
  describe('createProject', () => {
    it('creates a project with generated id', () => {
      const { createProject } = useProjectStore.getState();
      const project = createProject({
        name: 'My Project',
        description: 'Test description',
        systemPrompt: 'You are a test assistant.',
        icon: '#FF0000',
      });

      expect(project.id).toBeTruthy();
      expect(project.name).toBe('My Project');
      expect(project.description).toBe('Test description');
      expect(project.systemPrompt).toBe('You are a test assistant.');
      expect(project.icon).toBe('#FF0000');
    });

    it('creates project with timestamps', () => {
      const { createProject } = useProjectStore.getState();
      const before = new Date().toISOString();
      const project = createProject({
        name: 'Timestamped',
        description: 'Has timestamps',
        systemPrompt: 'Test prompt',
        icon: '#000',
      });

      expect(project.createdAt).toBeTruthy();
      expect(project.updatedAt).toBeTruthy();
      expect(project.createdAt >= before).toBe(true);
      expect(project.updatedAt >= before).toBe(true);
    });

    it('adds created project to store', () => {
      const { createProject } = useProjectStore.getState();
      const initialCount = useProjectStore.getState().projects.length;

      createProject({
        name: 'New Project',
        description: 'Added to store',
        systemPrompt: 'Prompt',
        icon: '#123',
      });

      const afterCount = useProjectStore.getState().projects.length;
      expect(afterCount).toBe(initialCount + 1);
    });

    it('returns the created project', () => {
      const { createProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Return Test',
        description: 'Should be returned',
        systemPrompt: 'Test',
        icon: '#ABC',
      });

      expect(project).toBeDefined();
      expect(project.name).toBe('Return Test');
    });

    it('creates multiple projects with unique ids', () => {
      const { createProject } = useProjectStore.getState();
      const p1 = createProject({
        name: 'Project 1',
        description: 'First',
        systemPrompt: 'P1',
        icon: '#111',
      });
      const p2 = createProject({
        name: 'Project 2',
        description: 'Second',
        systemPrompt: 'P2',
        icon: '#222',
      });

      expect(p1.id).not.toBe(p2.id);
    });
  });

  // ============================================================================
  // updateProject
  // ============================================================================
  describe('updateProject', () => {
    it('updates project name', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Original Name',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      updateProject(project.id, { name: 'Updated Name' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.name).toBe('Updated Name');
    });

    it('updates project description', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Test',
        description: 'Old description',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      updateProject(project.id, { description: 'New description' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.description).toBe('New description');
    });

    it('updates project systemPrompt', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Test',
        description: 'Desc',
        systemPrompt: 'Old prompt',
        icon: '#000',
      });

      updateProject(project.id, { systemPrompt: 'New prompt' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.systemPrompt).toBe('New prompt');
    });

    it('updates project icon', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Test',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      updateProject(project.id, { icon: '#FFF' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.icon).toBe('#FFF');
    });

    it('updates the updatedAt timestamp', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Test',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const originalUpdatedAt = project.updatedAt;
      // Small delay to ensure different timestamp
      updateProject(project.id, { name: 'Changed' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.updatedAt).toBeTruthy();
      // updatedAt should be >= original
      expect(updated!.updatedAt >= originalUpdatedAt).toBe(true);
    });

    it('preserves createdAt on update', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Test',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const originalCreatedAt = project.createdAt;
      updateProject(project.id, { name: 'Changed' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.createdAt).toBe(originalCreatedAt);
    });

    it('does not update other projects', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const p1 = createProject({
        name: 'Project 1',
        description: 'Desc 1',
        systemPrompt: 'Prompt 1',
        icon: '#111',
      });
      const p2 = createProject({
        name: 'Project 2',
        description: 'Desc 2',
        systemPrompt: 'Prompt 2',
        icon: '#222',
      });

      updateProject(p1.id, { name: 'Updated' });

      const unchanged = useProjectStore.getState().getProject(p2.id);
      expect(unchanged?.name).toBe('Project 2');
    });

    it('handles updating non-existent project gracefully', () => {
      const { updateProject } = useProjectStore.getState();
      // Should not throw
      expect(() => updateProject('non-existent-id', { name: 'Test' })).not.toThrow();
    });

    it('allows partial updates', () => {
      const { createProject, updateProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Test',
        description: 'Original desc',
        systemPrompt: 'Original prompt',
        icon: '#000',
      });

      updateProject(project.id, { name: 'Only name changed' });

      const updated = useProjectStore.getState().getProject(project.id);
      expect(updated?.name).toBe('Only name changed');
      expect(updated?.description).toBe('Original desc');
      expect(updated?.systemPrompt).toBe('Original prompt');
    });
  });

  // ============================================================================
  // deleteProject
  // ============================================================================
  describe('deleteProject', () => {
    it('removes the project from the store', async () => {
      const { createProject, deleteProject } = useProjectStore.getState();
      const project = createProject({
        name: 'To Delete',
        description: 'Will be deleted',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      await deleteProject(project.id);

      const found = useProjectStore.getState().getProject(project.id);
      expect(found).toBeUndefined();
    });

    it('reduces the projects count by one', async () => {
      const { createProject, deleteProject } = useProjectStore.getState();
      const project = createProject({
        name: 'To Delete',
        description: 'Will be deleted',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const beforeCount = useProjectStore.getState().projects.length;
      await deleteProject(project.id);
      const afterCount = useProjectStore.getState().projects.length;

      expect(afterCount).toBe(beforeCount - 1);
    });

    it('does not affect other projects', async () => {
      const { createProject, deleteProject } = useProjectStore.getState();
      const p1 = createProject({
        name: 'Keep',
        description: 'D1',
        systemPrompt: 'P1',
        icon: '#111',
      });
      const p2 = createProject({
        name: 'Delete',
        description: 'D2',
        systemPrompt: 'P2',
        icon: '#222',
      });

      await deleteProject(p2.id);

      const kept = useProjectStore.getState().getProject(p1.id);
      expect(kept?.name).toBe('Keep');
    });

    it('handles deleting non-existent project gracefully', async () => {
      const initialCount = useProjectStore.getState().projects.length;
      await useProjectStore.getState().deleteProject('non-existent');
      expect(useProjectStore.getState().projects.length).toBe(initialCount);
    });
  });

  // ============================================================================
  // getProject
  // ============================================================================
  describe('getProject', () => {
    it('returns project by id', () => {
      const { createProject } = useProjectStore.getState();
      const project = createProject({
        name: 'Find Me',
        description: 'Findable',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const found = useProjectStore.getState().getProject(project.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Find Me');
    });

    it('returns undefined for non-existent id', () => {
      const found = useProjectStore.getState().getProject('does-not-exist');
      expect(found).toBeUndefined();
    });

    it('returns the correct project when multiple exist', () => {
      const { createProject } = useProjectStore.getState();
      createProject({
        name: 'First',
        description: 'D1',
        systemPrompt: 'P1',
        icon: '#111',
      });
      const p2 = createProject({
        name: 'Second',
        description: 'D2',
        systemPrompt: 'P2',
        icon: '#222',
      });

      const found = useProjectStore.getState().getProject(p2.id);
      expect(found?.name).toBe('Second');
      expect(found?.id).toBe(p2.id);
    });
  });

  // ============================================================================
  // duplicateProject
  // ============================================================================
  describe('duplicateProject', () => {
    it('creates a copy with "(Copy)" suffix', () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const original = createProject({
        name: 'Original',
        description: 'Original desc',
        systemPrompt: 'Original prompt',
        icon: '#000',
      });

      const duplicate = duplicateProject(original.id);
      expect(duplicate).not.toBeNull();
      expect(duplicate?.name).toBe('Original (Copy)');
    });

    it('duplicates with a new unique id', () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const original = createProject({
        name: 'Original',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const duplicate = duplicateProject(original.id);
      expect(duplicate?.id).not.toBe(original.id);
    });

    it('copies description and systemPrompt', () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const original = createProject({
        name: 'Original',
        description: 'My description',
        systemPrompt: 'My system prompt',
        icon: '#ABC',
      });

      const duplicate = duplicateProject(original.id);
      expect(duplicate?.description).toBe('My description');
      expect(duplicate?.systemPrompt).toBe('My system prompt');
      expect(duplicate?.icon).toBe('#ABC');
    });

    it('sets new timestamps on duplicate', () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const original = createProject({
        name: 'Original',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const duplicate = duplicateProject(original.id);
      expect(duplicate?.createdAt).toBeTruthy();
      expect(duplicate?.updatedAt).toBeTruthy();
    });

    it('adds duplicate to the store', () => {
      const { createProject, duplicateProject } = useProjectStore.getState();
      const original = createProject({
        name: 'Original',
        description: 'Desc',
        systemPrompt: 'Prompt',
        icon: '#000',
      });

      const beforeCount = useProjectStore.getState().projects.length;
      duplicateProject(original.id);
      const afterCount = useProjectStore.getState().projects.length;

      expect(afterCount).toBe(beforeCount + 1);
    });

    it('returns null when duplicating non-existent project', () => {
      const { duplicateProject } = useProjectStore.getState();
      const result = duplicateProject('non-existent-id');
      expect(result).toBeNull();
    });

    it('does not add to store when project not found', () => {
      const { duplicateProject } = useProjectStore.getState();
      const beforeCount = useProjectStore.getState().projects.length;
      duplicateProject('non-existent-id');
      const afterCount = useProjectStore.getState().projects.length;

      expect(afterCount).toBe(beforeCount);
    });
  });

  // ============================================================================
  // RAG cleanup on delete
  // ============================================================================
  describe('RAG cleanup on deleteProject', () => {
    it('deleting a project removes its knowledge-base documents', async () => {
      const project = useProjectStore.getState().createProject({ name: 'Research', description: '', systemPrompt: '' });
      engine.seedText('/docs/notes.txt', 'Field notes from the survey.');
      await knowledgeBase.addFile({ projectId: project.id, filePath: '/docs/notes.txt', fileName: 'notes.txt', fileSize: 28 });
      await engine.indexed(await engine.documentIdOf('/docs/notes.txt'));
      expect((await knowledgeBase.getDocumentsByProject(project.id)).map(d => d.name)).toEqual(['notes.txt']);

      const outcome = await useProjectStore.getState().deleteProject(project.id);

      expect(outcome).toEqual({ ok: true });
      expect(await knowledgeBase.getDocumentsByProject(project.id)).toEqual([]);
      expect(useProjectStore.getState().getProject(project.id)).toBeUndefined();
    });

    it('preserves the project and returns a refusal if the knowledge base cannot be opened', async () => {
      // The phone cannot open rag.db (its folder is gone), so the documents cannot be cleaned up.
      launch({ sqlite: { persistAt: '/no/such/folder' } });
      await useProjectStore.persist.rehydrate();
      const before = useProjectStore.getState().projects.map(p => p.id);
      expect(before).toContain('default-assistant');

      const outcome = await useProjectStore.getState().deleteProject('default-assistant');

      expect(outcome).toEqual({ ok: false, reason: expect.stringMatching(/unable to open database/i) });
      expect(useProjectStore.getState().projects.map(p => p.id)).toEqual(before);
    });
  });
});
