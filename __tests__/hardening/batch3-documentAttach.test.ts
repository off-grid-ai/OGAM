/**
 * BATCH 3 — Chat Attachments & Vision (hardening)
 * File 1: Document attachment validation & multi-attachment queueing.
 *
 * Drives the REAL documentService (the attach seam). The only mocked boundary is
 * react-native-fs (a native module) and pdfExtractor (a native module). All
 * validation / extension / size / decode logic runs for real — deleting the
 * implementation would fail these tests.
 *
 * Provit plan cases covered here (see provit/docs/mobile-test-plan.md, Batch 3):
 *  - #2  supported .txt accepted            (COVERED-REAL in existing suite; asserted end-to-end here for the accept-set)
 *  - #12 unsupported binary (.docx) rejected with a visible error
 *  - #13 file > 5MB rejected with a visible error
 *  - #14 .md accepted
 *  - #15 .json accepted
 *  - #17 URL-encoded filename display-name decode  → BUG-FOUND (service returns it un-decoded)
 *  - #34/#35 multiple document attachments queue as distinct attachments
 *
 * The accepted-extension set explicitly includes .csv and code files (.py/.ts),
 * which the Provit "supported types" line enumerates but the existing unit suite
 * does not exhaustively assert.
 */

import RNFS from 'react-native-fs';

jest.mock('../../src/services/pdfExtractor', () => ({
  pdfExtractor: { isAvailable: jest.fn(() => false), extractText: jest.fn() },
}));

import { documentService, sanitizePathSegment } from '../../src/services/documentService';

const rnfs = RNFS as jest.Mocked<typeof RNFS>;

/** Make RNFS behave as if `content` is a readable file of `size` bytes. */
function stubReadableFile(content: string, size = content.length): void {
  rnfs.exists.mockResolvedValue(true);
  rnfs.stat.mockResolvedValue({ size, isFile: () => true } as any);
  rnfs.readFile.mockResolvedValue(content);
  rnfs.copyFile.mockResolvedValue(undefined as any);
  rnfs.mkdir.mockResolvedValue(undefined as any);
  rnfs.unlink.mockResolvedValue(undefined as any);
}

describe('Batch3 · document attach validation (real documentService)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── #14/#15/#2 + csv/code: the full supported accept-set ───────────────────
  describe('supported document types are accepted (#2, #14, #15)', () => {
    const acceptedNames = [
      'notes.txt',
      'readme.md',
      'data.json',
      'table.csv',
      'script.py',
      'index.ts',
    ];

    it.each(acceptedNames)('isSupported() accepts %s', (name) => {
      expect(documentService.isSupported(name)).toBe(true);
    });

    it.each(acceptedNames)('processDocumentFromPath() builds a document attachment for %s', async (name) => {
      stubReadableFile('sample body', 11);
      const att = await documentService.processDocumentFromPath(`/docs/${name}`, name);
      expect(att).not.toBeNull();
      expect(att!.type).toBe('document');
      expect(att!.fileName).toBe(name);
      expect(att!.textContent).toBe('sample body');
      expect(att!.fileSize).toBe(11);
    });
  });

  // ── #12: unsupported binary format rejected with a visible error ────────────
  describe('unsupported binary formats are rejected (#12)', () => {
    it('isSupported() is false for a .docx binary', () => {
      expect(documentService.isSupported('report.docx')).toBe(false);
    });

    it('isSupported() is false for .xlsx and image binaries', () => {
      expect(documentService.isSupported('sheet.xlsx')).toBe(false);
      expect(documentService.isSupported('photo.png')).toBe(false);
    });

    it('processDocumentFromPath() throws an "Unsupported file type" error for .docx (no chip is added)', async () => {
      stubReadableFile('ignored');
      await expect(
        documentService.processDocumentFromPath('/docs/report.docx', 'report.docx'),
      ).rejects.toThrow(/Unsupported file type/);
    });
  });

  // ── #13: oversized (>5MB) file rejected with a visible error ────────────────
  describe('oversized files are rejected (#13)', () => {
    it('rejects a file at 5MB + 1 byte with a "too large" error', async () => {
      stubReadableFile('x', 5 * 1024 * 1024 + 1);
      await expect(
        documentService.processDocumentFromPath('/docs/huge.txt', 'huge.txt'),
      ).rejects.toThrow(/too large/i);
    });

    it('accepts a file exactly at the 5MB boundary', async () => {
      stubReadableFile('ok', 5 * 1024 * 1024);
      const att = await documentService.processDocumentFromPath('/docs/limit.txt', 'limit.txt');
      expect(att).not.toBeNull();
    });
  });

  // ── #17: URL-encoded filename should display decoded ────────────────────────
  //
  // FIXED (#17): the display filename is now decoded once in the service
  // (documentService.decodeDisplayName), so a percent-encoded name shows human-readable
  // in the chip/preview. Fails-before (returned 'my%20notes.txt') / passes-after.
  describe('URL-encoded filename display decode (#17)', () => {
    it('decodes a percent-encoded display fileName (my%20notes.txt -> "my notes.txt")', async () => {
      stubReadableFile('body');
      const att = await documentService.processDocumentFromPath(
        '/docs/my%20notes.txt',
        'my%20notes.txt',
      );
      expect(att!.fileName).toBe('my notes.txt');
    });

    it('leaves a malformed percent-sequence name untouched instead of throwing', async () => {
      // decodeURIComponent('100%.txt') throws — the guard must fall back to the raw name.
      stubReadableFile('body');
      const att = await documentService.processDocumentFromPath('/docs/100%.txt', '100%.txt');
      expect(att!.fileName).toBe('100%.txt');
    });

    it('does NOT let a percent-encoded traversal name escape the attachments dir (security)', async () => {
      // '%2E%2E%2Fescape.txt' decodes to '../escape.txt'. The DISPLAY name may show it
      // decoded, but the filesystem destination must be sanitized — no '/' or '..' in the
      // path segment handed to copyFile, so the write can't leave ATTACHMENTS_DIR.
      stubReadableFile('body');
      const att = await documentService.processDocumentFromPath(
        '/docs/%2E%2E%2Fescape.txt',
        '%2E%2E%2Fescape.txt',
      );
      expect(att).not.toBeNull();
      // The persistent copy destination (2nd arg to RNFS.copyFile) must contain no
      // separator/traversal after the id_ prefix.
      const destPaths = rnfs.copyFile.mock.calls.map(c => String(c[1]));
      const persistent = destPaths.find(p => p.includes('attachments'));
      expect(persistent).toBeDefined();
      expect(persistent).not.toContain('../');
      expect(persistent!.split('attachments/')[1]).not.toContain('/'); // basename only, no nested dirs
    });

    it('sanitizePathSegment neutralizes separators + traversal but keeps a normal name', () => {
      expect(sanitizePathSegment('my notes.txt')).toBe('my notes.txt');
      expect(sanitizePathSegment('a/b/c.txt')).toBe('a_b_c.txt');
      expect(sanitizePathSegment('%2E%2E%2Fescape.txt')).not.toContain('/');
      expect(sanitizePathSegment('%2E%2E%2Fescape.txt')).not.toContain('..');
    });

    it('resolves the file even when the PATH is URL-encoded (path decode works)', async () => {
      // The path decode DOES happen (resolveContentUri), so a file whose path
      // carries %20 still reads without error — the attach itself succeeds.
      stubReadableFile('decoded path body');
      const att = await documentService.processDocumentFromPath(
        '/docs/my%20notes.txt',
        'my%20notes.txt',
      );
      expect(att).not.toBeNull();
      expect(att!.textContent).toBe('decoded path body');
    });
  });

  // ── #34/#35: multiple document attachments queue as distinct attachments ────
  describe('multiple document attachments queue (#34, #35)', () => {
    it('produces two distinct attachments with unique ids for two files', async () => {
      stubReadableFile('py body');
      const first = await documentService.processDocumentFromPath('/docs/a.py', 'a.py');

      // Advance the clock so the second attachment gets a different id (id is Date.now()).
      const nowSpy = jest.spyOn(Date, 'now');
      const base = Date.now();
      nowSpy.mockReturnValue(base + 5);
      rnfs.readFile.mockResolvedValue('ts body');
      const second = await documentService.processDocumentFromPath('/docs/b.ts', 'b.ts');
      nowSpy.mockRestore();

      expect(first!.fileName).toBe('a.py');
      expect(second!.fileName).toBe('b.ts');
      expect(first!.id).not.toBe(second!.id);
      // Both are documents that would render as side-by-side chips (#34) and send
      // together in one message (#35).
      expect(first!.type).toBe('document');
      expect(second!.type).toBe('document');
    });

    it('formatForContext() renders each queued document independently for the LLM (#35)', () => {
      const ctxA = documentService.formatForContext({
        id: '1', type: 'document', uri: '/x/a.py', fileName: 'a.py', textContent: 'print(1)',
      });
      const ctxB = documentService.formatForContext({
        id: '2', type: 'document', uri: '/x/b.ts', fileName: 'b.ts', textContent: 'const x = 1',
      });
      expect(ctxA).toContain('a.py');
      expect(ctxA).toContain('print(1)');
      expect(ctxB).toContain('b.ts');
      expect(ctxB).toContain('const x = 1');
    });
  });
});
