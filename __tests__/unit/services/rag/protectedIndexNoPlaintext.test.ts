/**
 * Adding a document to a PIN-protected project must not leave the original file's
 * plaintext bytes on disk: the extractor's durable copy is removed after the text is
 * encrypted into the vault, and also when the vault write fails.
 */
import RNFS from 'react-native-fs';

const ATTACH_COPY = `${RNFS.DocumentDirectoryPath}/attachments/123_secret.pdf`;
const PICKED = `${RNFS.CachesDirectoryPath}/picked/secret.pdf`;

jest.mock('../../../../src/services/rag/database', () => ({
  ragDatabase: {
    ensureReady: jest.fn(() => Promise.resolve()),
    insertDocument: jest.fn(), insertChunks: jest.fn(),
    getDocumentsByProject: jest.fn(() => []),
    isPathIndexed: jest.fn(() => false),
  },
}));
jest.mock('../../../../src/services/rag/embedding', () => ({
  embeddingService: { load: jest.fn(async () => undefined), embedBatch: jest.fn(async (t: string[]) => t.map(() => [0.1, 0.2])) },
}));
jest.mock('../../../../src/services/documentService', () => ({
  documentService: { processDocumentFromPath: jest.fn() },
}));
jest.mock('../../../../src/services/rag/knowledgeSource', () => ({ isProtectedProject: () => true }));
jest.mock('../../../../src/stores/protectedProjectVault', () => ({
  protectedVault: { list: jest.fn(() => []), isOpen: jest.fn(() => true), addDocument: jest.fn(async () => -5) },
  isVaultDocId: (id: number) => id < 0, newVaultDocId: () => -1,
}));

import { ragService } from '../../../../src/services/rag';
import { ragDatabase } from '../../../../src/services/rag/database';
import { documentService } from '../../../../src/services/documentService';

const fs = RNFS as jest.Mocked<typeof RNFS>;
const mockVault = require('../../../../src/stores/protectedProjectVault').protectedVault;

beforeEach(() => {
  jest.clearAllMocks();
  (documentService.processDocumentFromPath as jest.Mock).mockResolvedValue({
    id: '1', type: 'document', uri: ATTACH_COPY, fileName: 'secret.pdf',
    textContent: 'Private history text that is long enough to be chunked into the knowledge base.', fileSize: 100,
  });
  fs.unlink.mockResolvedValue(undefined as any);
});

it('deletes the plaintext original copy after encrypting into the vault', async () => {
  await expect(ragService.indexDocument({ projectId: 'p', filePath: PICKED, fileName: 'secret.pdf', fileSize: 100 })).resolves.toBe(-5);
  expect(mockVault.addDocument).toHaveBeenCalled();
  expect(ragDatabase.insertDocument).not.toHaveBeenCalled();
  expect(fs.unlink).toHaveBeenCalledWith(ATTACH_COPY);
  expect(fs.unlink).toHaveBeenCalledWith(PICKED);
});

it('still deletes the plaintext copy when the vault write fails', async () => {
  mockVault.addDocument.mockRejectedValueOnce(new Error('keystore busy'));
  await expect(ragService.indexDocument({ projectId: 'p', filePath: PICKED, fileName: 'secret.pdf', fileSize: 100 })).rejects.toThrow('keystore busy');
  expect(fs.unlink).toHaveBeenCalledWith(ATTACH_COPY);
});
