/**
 * DocumentService - Handles reading and parsing document files
 * Supports: text files, code files, CSV, JSON, PDF, and other text-based formats
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import { MediaAttachment } from '../types';
import { pdfExtractor } from './pdfExtractor';
import {MOBILE_TEXT_SETTINGS_DEFAULTS} from '@offgrid/models';
import {applicationFacade} from './applicationFacade';
import { generateId } from '../utils/generateId';
import logger from '../utils/logger';
import {
  admitDocument,
  documentAttachmentCharBudget,
  documentDisplayName,
  documentPreview,
  formatDocumentForContext,
  isPdfDocument,
  isSupportedDocument,
  supportedDocumentExtensions,
  truncateDocumentText,
  type DocumentCapabilities,
} from '@offgrid/rag';

type PersistentCopyResult =
  | { id: string; uri: string; storage: 'persistent' }
  | { id: string; uri: string; storage: 'readable-source-fallback' };

// The attachment rules (which files, how large, how much of one the model sees, the truncation
// marker, the context block, the preview) are @offgrid/rag's `document-attachment`; this service
// keeps only the file system and the PDF extractor.
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
  /** What this device can open: PDFs only when the native extractor is present. */
  private capabilities(): DocumentCapabilities {
    return { pdf: pdfExtractor.isAvailable() };
  }

  /** The chat's context window as the model sees it, in tokens. */
  private contextLength(): number {
    const value = applicationFacade().models.settings.current().contextLength;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : MOBILE_TEXT_SETTINGS_DEFAULTS.contextLength;
  }

  /**
   * Check if a file extension is supported
   */
  isSupported(fileName: string): boolean {
    return isSupportedDocument(fileName, this.capabilities());
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
      } catch (directCopyError: unknown) {
        // If direct copy fails, try stripping the file:// prefix
        const pathWithoutScheme = decodedUri.replace(/^file:\/\//, '');
        try {
          await RNFS.copyFile(pathWithoutScheme, tempPath);
          console.log(`[DocumentService] Copied (fallback) to: ${tempPath}`);
          return tempPath;
        } catch (strippedPathError: unknown) {
          console.error(`[DocumentService] Both copy attempts failed`);
          const directMessage =
            directCopyError instanceof Error
              ? directCopyError.message
              : String(directCopyError);
          const strippedMessage =
            strippedPathError instanceof Error
              ? strippedPathError.message
              : String(strippedPathError);
          throw new Error(
            `Could not access file. Please try selecting the file again. Direct copy failed: ${directMessage}. Stripped-path copy failed: ${strippedMessage}.`,
          );
        }
      }
    }

    console.log(`[DocumentService] Returning URI as-is: ${uri}`);
    return uri;
  }

  private async readContent(
    resolvedPath: string,
    isPdf: boolean,
    maxChars: number,
  ): Promise<string> {
    console.log(
      `[DocumentService] readContent called - path: ${resolvedPath}, isPdf: ${isPdf}, maxChars: ${maxChars}`,
    );
    try {
      const raw = isPdf
        ? await pdfExtractor.extractText(resolvedPath, maxChars)
        : await RNFS.readFile(resolvedPath, 'utf8');
      console.log(
        `[DocumentService] Successfully read ${raw.length} characters`,
      );
      return truncateDocumentText(raw, maxChars);
    } catch (error: any) {
      console.error(
        `[DocumentService] Error reading content:`,
        error?.message || error,
      );
      throw error;
    }
  }

  private async savePersistentCopy(
    resolvedPath: string,
    originalPath: string,
    name: string,
  ): Promise<PersistentCopyResult> {
    await this.ensureAttachmentsDir();
    const id = generateId();
    const persistentPath = `${ATTACHMENTS_DIR}/${id}_${name}`;
    try {
      await RNFS.copyFile(resolvedPath, persistentPath);
      if (!(await RNFS.exists(persistentPath))) {
        throw new Error('The persistent copy could not be verified.');
      }
    } catch (error: unknown) {
      if (!(await RNFS.exists(resolvedPath))) {
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new Error(
          `Failed to save "${name}" and the source file is unavailable.${detail}`,
        );
      }
      logger.warn(
        `[DocumentService] Persistent copy failed for "${name}"; using the readable source path.`,
        error,
      );
      return { id, uri: resolvedPath, storage: 'readable-source-fallback' };
    }

    if (resolvedPath !== originalPath) {
      try {
        await RNFS.unlink(resolvedPath);
      } catch (error: unknown) {
        try {
          if (await RNFS.exists(resolvedPath)) {
            logger.error(
              `[DocumentService] Failed to remove temporary source for "${name}".`,
              error,
            );
          }
        } catch (inspectionError: unknown) {
          logger.error(
            `[DocumentService] Failed to remove or inspect temporary source for "${name}".`,
            error,
            inspectionError,
          );
        }
      }
    }
    return { id, uri: persistentPath, storage: 'persistent' };
  }

  /**
   * Process a document from a file path
   */
  async processDocumentFromPath(
    filePath: string,
    fileName?: string,
    maxCharsOverride?: number,
  ): Promise<MediaAttachment | null> {
    console.log(
      `[DocumentService] Processing document - filePath: ${filePath}, fileName: ${fileName}`,
    );
    const name = documentDisplayName(fileName || filePath);
    const isPdf = isPdfDocument(name);
    console.log(`[DocumentService] isPdf: ${isPdf}`);
    const typeAdmission = admitDocument(name, undefined, this.capabilities());
    if (!typeAdmission.admitted) {
      throw new Error(typeAdmission.reason);
    }

    const resolvedPath = await this.resolveContentUri(filePath, name);
    console.log(`[DocumentService] Resolved path: ${resolvedPath}`);

    // Verify the file exists and is accessible
    let fileExists = false;
    try {
      fileExists = await RNFS.exists(resolvedPath);
      console.log(`[DocumentService] File exists check: ${fileExists}`);
    } catch (existsError) {
      // RNFS.exists can fail on security-scoped URLs
      console.error(`[DocumentService] exists() threw error:`, existsError);
      throw new Error(
        'Could not access file. Please try selecting the file again.',
      );
    }

    if (!fileExists) {
      throw new Error(`File not found: ${name}`);
    }

    const facts = await statFile(resolvedPath);
    if (!facts) {
      throw new Error(
        'Could not determine file size. Please try selecting the file again.',
      );
    }
    const fileSize = facts.size;
    console.log(`[DocumentService] File size: ${fileSize} bytes`);
    const admission = admitDocument(name, fileSize, this.capabilities());
    if (!admission.admitted) {
      throw new Error(admission.reason);
    }

    const maxChars =
      maxCharsOverride ?? documentAttachmentCharBudget(this.contextLength());
    const textContent = await this.readContent(resolvedPath, isPdf, maxChars);
    const { id, uri } = await this.savePersistentCopy(
      resolvedPath,
      filePath,
      name,
    );

    return {
      id,
      type: 'document',
      uri,
      fileName: name,
      textContent,
      fileSize,
    };
  }

  /**
   * Create a document attachment from pasted text.
   * Saves to a persistent file so it can be opened later from chat.
   */
  async createFromText(
    text: string,
    fileName: string = 'pasted-text.txt',
  ): Promise<MediaAttachment> {
    const textContent = truncateDocumentText(
      text,
      documentAttachmentCharBudget(this.contextLength()),
    );

    const id = generateId();

    await this.ensureAttachmentsDir();
    const uri = `${ATTACHMENTS_DIR}/${id}_${fileName}`;
    await RNFS.writeFile(uri, text, 'utf8');

    return {
      id,
      type: 'document',
      uri,
      fileName,
      textContent,
      fileSize: text.length,
    };
  }

  /**
   * Format document content for including in LLM context
   */
  formatForContext(attachment: MediaAttachment): string {
    return attachment.type === 'document' ? formatDocumentForContext(attachment) : '';
  }

  /**
   * Get a short preview of document content
   */
  getPreview(attachment: MediaAttachment, maxLength?: number): string {
    return attachment.type === 'document'
      ? documentPreview(attachment, maxLength)
      : attachment.fileName || 'Document';
  }

  /**
   * Get list of supported file extensions
   */
  getSupportedExtensions(): string[] {
    return supportedDocumentExtensions(this.capabilities());
  }
}

export const documentService = new DocumentService();
