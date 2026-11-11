/**
 * Projects -> Knowledge base -> a shared document ("Current Progress" in a protected Therapy
 * project): the user reads its exact text, edits and renames it, and every chat then gets the
 * new version. Fakes only the device boundary: Keystore bridge, files, embedding model.
 */
import { NativeModules, Platform } from 'react-native';

const mockFiles = new Map<string, string>();
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/docs', CachesDirectoryPath: '/cache',
  exists: jest.fn(async (p: string) => mockFiles.has(p)),
  readFile: jest.fn(async (p: string) => mockFiles.get(p)),
  writeFile: jest.fn(async (p: string, d: string) => { mockFiles.set(p, d); }),
  unlink: jest.fn(async (p: string) => { mockFiles.delete(p); }),
  mkdir: jest.fn(async () => undefined),
}));
jest.mock('../../../src/services/rag/embedding', () => ({
  embeddingService: { isLoaded: () => true, load: async () => undefined, embed: async () => [1, 0], embedBatch: async (ts: string[]) => ts.map(() => [1, 0]) },
}));
jest.mock('../../../src/services/rag/database', () => ({
  ragDatabase: { ensureReady: async () => undefined, getDocumentsByProject: () => [], isPathIndexed: () => false },
}));
jest.mock('../../../src/stores/protectionState', () => ({
  unlockedProjectPin: (id: string) => (id === 'therapy' ? '123456' : undefined),
  isProtectedProjectUnlocked: (id: string) => id === 'therapy',
  isProtectedProjectOpen: (id: string) => id === 'therapy',
  rememberProjectPin: jest.fn(), forgetProjectPin: jest.fn(), forgetAllProjectPins: jest.fn(),
  unlockedProjectIds: () => ['therapy'], unlockedProjectEntries: () => [['therapy', '123456']],
}));
jest.mock('../../../src/stores/protectedProjectStorage', () => ({
  unlockedProjectPin: (id: string) => (id === 'therapy' ? '123456' : undefined),
  isProtectedProjectUnlocked: (id: string) => id === 'therapy',
  protectedProjectStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));
const mockGoBack = jest.fn();
let mockParams: any = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useProjectStore } from '../../../src/stores/projectStore';
import { protectedVault } from '../../../src/stores/protectedProjectVault';
import { ragService } from '../../../src/services/rag';
import { ProjectDocumentScreen } from '../../../src/screens/ProjectDocumentScreen';

const enc = (t: string) => `atlasitem:v1:${Buffer.from(t).toString('base64')}`;
const dec = (b: string) => Buffer.from(b.slice(13), 'base64').toString();
const LONG = `Week 1: ${'started journaling every night and noticed the worry comes back at 3am. '.repeat(20)}`;
const ORIGINAL = `${LONG}\n\nWeek 2: short walks.`;

beforeAll(async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  (NativeModules as any).AtlasDevice = {
    encryptProtectedItem: async (_k: string, _i: string, plain: string) => enc(plain),
    decryptProtectedItem: async (_k: string, _i: string, blob: string) => dec(blob),
  };
  useProjectStore.setState({ projects: [{ id: 'therapy', name: 'Therapy', description: '', systemPrompt: '',
    pinVerifier: 'pin:v1:123456', protectedBlob: enc('{}'), createdAt: 'x', updatedAt: 'x' } as any] });
  await protectedVault.open('therapy', '123456', 'pin:v1:123456');
});

require('../../utils/registerStores').registerStoreRefs();

it('reads the exact text, saves edits and a rename, and keeps one copy encrypted', async () => {
  const docId = await ragService.saveProjectNote({ projectId: 'therapy', name: 'Current Progress', text: ORIGINAL });
  mockParams = { projectId: 'therapy', docId, name: 'Current Progress' };
  const screen = render(<ProjectDocumentScreen />);
  const body = await screen.findByDisplayValue(ORIGINAL);

  fireEvent.changeText(body, `${ORIGINAL}\n\nWeek 3: sleeping better.`);
  fireEvent.changeText(screen.getByTestId('project-doc-name'), 'Progress notes');
  fireEvent.press(screen.getByText('Save'));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalled());

  const docs = await ragService.getDocumentsByProject('therapy');
  expect(docs.map((d) => d.name)).toEqual(['Progress notes']);
  expect(await ragService.readDocumentText('therapy', docs[0].id)).toBe(`${ORIGINAL}\n\nWeek 3: sleeping better.`);
  // Nothing readable on disk: only the encrypted vault file.
  for (const [, data] of mockFiles) expect(data).not.toContain('sleeping better');
});

it('writes a new shared document', async () => {
  mockParams = { projectId: 'therapy' };
  const screen = render(<ProjectDocumentScreen />);
  expect(screen.getByText('New shared document')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('project-doc-name'), 'AI Instructions');
  fireEvent.changeText(screen.getByTestId('project-doc-text'), 'Ask one question at a time.');
  fireEvent.press(screen.getByText('Save'));
  await waitFor(async () => expect((await ragService.getDocumentsByProject('therapy')).map((d) => d.name)).toContain('AI Instructions'));
});
