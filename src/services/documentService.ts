/**
 * DocumentService - keeps a copy of a picked document (text, code, CSV, JSON, PDF) and hands it to
 * the document engine (services/documents), which reads and indexes it. Chat attachments and project
 * knowledge-base files both come in through attachDocument.
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import { MediaAttachment } from '../types';
import { pdfExtractor } from './pdfExtractor';
import { generateId } from '../utils/generateId';
import { documentAdded } from './analytics/analytics';
import { fileExtension } from './analytics/values';

// File extensions we can read as text
const TEXT_EXTENSIONS = [
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.log',
  '.py',
  '.js',
  '.ts',
  '.jsx',
  '.tsx',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.swift',
  '.kt',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.sql',
  '.sh',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
];

// PDF extension handled separately via native module
const PDF_EXTENSION = '.pdf';

/** Documents are read page by page natively and indexed, so they can be large. */
const MAX_ATTACH_SIZE = 1024 * 1024 * 1024;

// Persistent directory for attached documents
const ATTACHMENTS_DIR = `${RNFS.DocumentDirectoryPath}/attachments`;

class DocumentService {
  /**
   * Ensure the persistent attachments directory exists
   */
  private async ensureAttachmentsDir(): Promise<void> {
    const exists = await RNFS.exists(ATTACHMENTS_DIR);
    if (!exists) {
      await RNFS.mkdir(ATTACHMENTS_DIR);
    }
  }
  /**
   * Check if a file extension is supported
   */
  isSupported(fileName: string): boolean {
    const extension = `.${fileName.split('.').pop()?.toLowerCase()}`;
    if (extension === PDF_EXTENSION && pdfExtractor.isAvailable()) {
      return true;
    }
    return TEXT_EXTENSIONS.includes(extension);
  }

  /**
   * Resolve a document picker URI to a local file path by copying to temp cache.
   * - Android: content:// URIs need to be copied to a readable location
   * - iOS: file:// URIs from document picker are security-scoped and need to be copied
   * - Note: Files from keepLocalCopy are already in app's Documents directory
   */
  private async resolveContentUri(
    uri: string,
    fileName: string,
  ): Promise<string> {
    console.log(`[DocumentService] resolveContentUri input: ${uri}`);

    // Check if this is a file from keepLocalCopy - it would be in our app's Documents directory
    // keepLocalCopy returns paths like: file:///Users/.../App/Documents/filename
    // RNFS.DocumentDirectoryPath is the app's Documents directory (without file://)
    const documentsPath = RNFS.DocumentDirectoryPath;

    // Decode URL-encoded characters (like %20 for spaces) and strip file:// prefix
    // This is critical because RNFS.exists() needs decoded paths, not URL-encoded
    const decodedUri = decodeURIComponent(uri);
    const cleanUri = decodedUri.replace(/^file:\/\//, '');
    console.log(`[DocumentService] Decoded and cleaned path: ${cleanUri}`);
    console.log(`[DocumentService] Documents path: ${documentsPath}`);

    // Only skip copying if the file is exactly in our app's Documents directory
    // This must be a precise match to avoid security-scoped URLs from document picker
    if (cleanUri.startsWith(documentsPath)) {
      console.log(
        `[DocumentService] File is in app Documents directory, using directly`,
      );
      return cleanUri;
    }

    // Android: content:// URIs
    if (Platform.OS === 'android' && uri.startsWith('content://')) {
      const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
      await RNFS.copyFile(uri, tempPath);
      console.log(
        `[DocumentService] Copied Android content:// URI to: ${tempPath}`,
      );
      return tempPath;
    }

    // iOS: file:// URIs from document picker are security-scoped
    // Copy to a temp location that we can access directly
    if (Platform.OS === 'ios' && uri.startsWith('file://')) {
      const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
      try {
        // RNFS.copyFile can handle file:// URIs by copying the underlying file
        await RNFS.copyFile(uri, tempPath);
        console.log(`[DocumentService] Copied iOS file:// URI to: ${tempPath}`);
        return tempPath;
      } catch (_copyError) {
        // If direct copy fails, try stripping the file:// prefix
        const pathWithoutScheme = decodedUri.replace(/^file:\/\//, '');
        try {
          await RNFS.copyFile(pathWithoutScheme, tempPath);
          console.log(`[DocumentService] Copied (fallback) to: ${tempPath}`);
          return tempPath;
        } catch {
          console.error(`[DocumentService] Both copy attempts failed`);
          throw new Error(
            `Could not access file. Please try selecting the file again.`,
          );
        }
      }
    }

    console.log(`[DocumentService] Returning URI as-is: ${uri}`);
    return uri;
  }

  private validateFileType(extension: string, isPdf: boolean): void {
    if (!isPdf && !TEXT_EXTENSIONS.includes(extension)) {
      throw new Error(
        `Unsupported file type: ${extension}. Supported: txt, md, csv, json, pdf, code files`,
      );
    }
    if (isPdf && !pdfExtractor.isAvailable()) {
      throw new Error('PDF extraction is not available on this device');
    }
  }

  private async savePersistentCopy(
    resolvedPath: string,
    originalPath: string,
    name: string,
  ): Promise<{ id: string; uri: string }> {
    await this.ensureAttachmentsDir();
    const id = generateId();
    const persistentPath = `${ATTACHMENTS_DIR}/${id}_${name}`;
    let ok = false;
    try {
      await RNFS.copyFile(resolvedPath, persistentPath);
      ok = await RNFS.exists(persistentPath);
    } catch {
      /* fall back to original path */
    }
    if (resolvedPath !== originalPath && ok) {
      RNFS.unlink(resolvedPath).catch(() => {});
    }
    return { id, uri: ok ? persistentPath : resolvedPath };
  }

  /**
   * Keep a document (for a chat or a knowledge base). The file is kept and indexed in the background by the document index
   * (services/documents), which reads every page natively; nothing is cut and the full text never
   * sits in JS memory. Returns as soon as the copy is kept, so sending is never blocked.
   */
  async attachDocument(filePath: string, fileName?: string): Promise<MediaAttachment> {
    const name = fileName || filePath.split('/').pop() || 'document';
    const extension = `.${name.split('.').pop()?.toLowerCase()}`;
    const isPdf = extension === PDF_EXTENSION;
    this.validateFileType(extension, isPdf);
    const resolvedPath = await this.resolveContentUri(filePath, name);
    const facts = await statFile(resolvedPath);
    if (!facts) throw new Error('Could not read this file. Please try selecting it again.');
    if (facts.size > MAX_ATTACH_SIZE) {
      throw new Error(`File is too large. Maximum size is ${MAX_ATTACH_SIZE / (1024 * 1024 * 1024)} GB`);
    }
    const { id, uri } = await this.savePersistentCopy(resolvedPath, filePath, name);
    const documentId = await RNFS.hash(uri.replace(/^file:\/\//, ''), 'sha256');
    const { startDocumentIngest } = await import('./documents');
    startDocumentIngest({ id: documentId, name, kind: isPdf ? 'pdf' : 'text', path: uri });
    documentAdded(fileExtension(name), facts.size);
    return { id, type: 'document', uri, fileName: name, fileSize: facts.size, documentId };
  }

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    const exts = [...TEXT_EXTENSIONS];
    if (pdfExtractor.isAvailable()) {
      exts.push(PDF_EXTENSION);
    }
    return exts;
  }
}

export const documentService = new DocumentService();
