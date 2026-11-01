/**
 * DocumentService Unit Tests
 *
 * Tests for which documents can be attached.
 * Priority: P1 - Document attachment support.
 *
 * documentService and pdfExtractor run for real. The only device piece is the native PDF reader
 * (NativeModules.PDFExtractorModule): absent by default, present where a test says so.
 */


import { NativeModules } from 'react-native';
import { documentService } from '../../../src/services/documentService';

/** documentService as loaded on a phone whose native PDF reader is present. */
function documentServiceWithPdfReader(): typeof documentService {
  let service!: typeof documentService;
  jest.isolateModules(() => {
    NativeModules.PDFExtractorModule = { extractText: async () => '', extractPages: async () => ({ pageCount: 0, pages: [] }) };
    service = require('../../../src/services/documentService').documentService;
  });
  delete NativeModules.PDFExtractorModule;
  return service;
}

describe('DocumentService', () => {
  // ========================================================================
  // isSupported
  // ========================================================================
  describe('isSupported', () => {
    it('returns true for .txt files', () => {
      expect(documentService.isSupported('readme.txt')).toBe(true);
    });

    it('returns true for .md files', () => {
      expect(documentService.isSupported('notes.md')).toBe(true);
    });

    it('returns true for .py files', () => {
      expect(documentService.isSupported('script.py')).toBe(true);
    });

    it('returns true for .ts files', () => {
      expect(documentService.isSupported('index.ts')).toBe(true);
    });

    it('returns true for .json files', () => {
      expect(documentService.isSupported('data.json')).toBe(true);
    });

    it('returns false for .pdf files when native module unavailable', () => {
      expect(documentService.isSupported('document.pdf')).toBe(false);
    });

    it('returns true for .pdf files on a phone with the native PDF reader', () => {
      expect(documentServiceWithPdfReader().isSupported('document.pdf')).toBe(true);
    });

    it('returns false for .docx files', () => {
      expect(documentService.isSupported('document.docx')).toBe(false);
    });

    it('returns false for .png files', () => {
      expect(documentService.isSupported('image.png')).toBe(false);
    });

    it('returns false for files with no extension', () => {
      expect(documentService.isSupported('Makefile')).toBe(false);
    });

    it('handles case-insensitive extensions', () => {
      expect(documentService.isSupported('README.TXT')).toBe(true);
      expect(documentService.isSupported('script.PY')).toBe(true);
    });
  });


  // ========================================================================
  // getSupportedExtensions
  // ========================================================================
  describe('getSupportedExtensions', () => {
    it('returns an array of supported extensions', () => {
      const extensions = documentService.getSupportedExtensions();

      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions).toContain('.txt');
      expect(extensions).toContain('.md');
      expect(extensions).toContain('.py');
      expect(extensions).toContain('.ts');
    });

    it('does not include .pdf when native module is unavailable', () => {
      const extensions = documentService.getSupportedExtensions();
      expect(extensions).not.toContain('.pdf');
    });

    it('includes .pdf when the native PDF reader is present', () => {
      expect(documentServiceWithPdfReader().getSupportedExtensions()).toContain('.pdf');
    });
  });

});
