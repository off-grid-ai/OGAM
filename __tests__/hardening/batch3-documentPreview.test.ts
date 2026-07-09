/**
 * BATCH 3 — Chat Attachments & Vision (hardening)
 * File 3: Document preview error states, driven through the REAL documentService.
 *
 * The existing RNTL screen test (__tests__/rntl/screens/DocumentPreviewScreen.test.tsx)
 * MOCKS documentService.processDocumentFromPath, so it proves the screen renders the
 * right branch but NOT that the service actually yields the empty/error data those
 * branches key off of. This file closes that gap by driving the real service and
 * asserting the exact values the preview screen consumes:
 *   - textContent === ''      → screen shows "Could not extract text" (empty-content, #19)
 *   - a thrown error message  → screen shows the message (#20 back-from-error is UI/Provit)
 *   - JSON raw text preserved → screen renders it verbatim (#16)
 *   - file-not-found throw    → screen error state (#19-family)
 *
 * Only react-native-fs + pdfExtractor (native modules) are mocked; the extraction,
 * validation and truncation logic runs for real.
 */

import RNFS from 'react-native-fs';

jest.mock('../../src/services/pdfExtractor', () => ({
  pdfExtractor: { isAvailable: jest.fn(() => false), extractText: jest.fn() },
}));

import { documentService } from '../../src/services/documentService';

const rnfs = RNFS as jest.Mocked<typeof RNFS>;

describe('Batch3 · document preview content the screen consumes (real service)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rnfs.stat.mockResolvedValue({ size: 10, isFile: () => true } as any);
    rnfs.copyFile.mockResolvedValue(undefined as any);
    rnfs.mkdir.mockResolvedValue(undefined as any);
  });

  // ── #19: empty content → preview error state ("Could not extract text") ─────
  it('yields textContent === "" for a 0-byte file (drives the empty-content error branch)', async () => {
    rnfs.exists.mockResolvedValue(true);
    rnfs.stat.mockResolvedValue({ size: 0, isFile: () => true } as any);
    rnfs.readFile.mockResolvedValue('');

    const att = await documentService.processDocumentFromPath('/docs/blank.txt', 'blank.txt');

    // The preview screen shows "Could not extract text from this document" when
    // attachment.textContent is falsy — an empty string is exactly that case.
    expect(att).not.toBeNull();
    expect(att!.textContent).toBe('');
    expect(att!.textContent).toBeFalsy();
  });

  // ── file-not-found → the service throws, screen shows the message ───────────
  it('throws "File not found" when the backing file is gone (drives the error branch)', async () => {
    rnfs.exists.mockResolvedValue(false);

    await expect(
      documentService.processDocumentFromPath('/docs/missing.txt', 'missing.txt'),
    ).rejects.toThrow(/File not found/);
  });

  it('throws a surfaced access error when exists() itself fails (security-scoped URL)', async () => {
    const orig = require('react-native').Platform.OS;
    Object.defineProperty(require('react-native').Platform, 'OS', { value: 'ios' });
    rnfs.exists.mockRejectedValue(new Error('cannot stat'));

    await expect(
      documentService.processDocumentFromPath('file:///private/doc.txt', 'doc.txt'),
    ).rejects.toThrow(/Could not access file/);

    Object.defineProperty(require('react-native').Platform, 'OS', { value: orig });
  });

  // ── #16: JSON raw text is preserved verbatim for the monospace preview ──────
  it('preserves JSON raw text verbatim (no parsing/mangling) for the preview (#16)', async () => {
    const json = '{\n  "name": "off-grid",\n  "n": 42\n}';
    rnfs.exists.mockResolvedValue(true);
    rnfs.stat.mockResolvedValue({ size: json.length, isFile: () => true } as any);
    rnfs.readFile.mockResolvedValue(json);

    const att = await documentService.processDocumentFromPath('/docs/data.json', 'data.json');

    expect(att!.type).toBe('document');
    expect(att!.textContent).toBe(json);
  });

  // ── #18: url-encoded-path file loads its content correctly in the preview ───
  it('loads content for a file whose path contains URL-encoded chars (#18)', async () => {
    rnfs.exists.mockResolvedValue(true);
    rnfs.readFile.mockResolvedValue('notes body');

    const att = await documentService.processDocumentFromPath(
      '/docs/my%20notes.txt',
      'my notes.txt',
    );

    expect(att!.textContent).toBe('notes body');
  });
});
