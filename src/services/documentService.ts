/**
 * DocumentService - Handles reading and parsing document files
 * Supports: text files, code files, CSV, JSON, PDF, and other text-based formats
 */

import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { MediaAttachment } from '../types';
import { pdfExtractor } from './pdfExtractor';
import { useAppStore } from '../stores/appStore';
import { APP_CONFIG } from '../constants';
import { OFFICE_EXTENSIONS, extractOffice, extractOfficeMarkdown } from './officeExtract';
import { toMarkdown } from './markdownConvert';

// File extensions we can read as text
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.xml', '.html', '.log', '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.h', '.swift', '.kt', '.go', '.rs', '.rb', '.php', '.sql', '.sh', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf'];

// PDF extension handled separately via native module
const PDF_EXTENSION = '.pdf';

// Max file size we'll read (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

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
    const extension = `.${  fileName.split('.').pop()?.toLowerCase()}`;
    if (extension === PDF_EXTENSION && pdfExtractor.isAvailable()) {
      return true;
    }
    return TEXT_EXTENSIONS.includes(extension) || OFFICE_EXTENSIONS.includes(extension);
  }

  /**
   * Resolve a document picker URI to a local file path by copying to temp cache.
   * - Android: content:// URIs need to be copied to a readable location
   * - iOS: file:// URIs from document picker are security-scoped and need to be copied
   * - Note: Files from keepLocalCopy are already in app's Documents directory
   */
  private async resolveContentUri(uri: string, fileName: string): Promise<string> {
    console.log('[DocumentService] resolveContentUri');

    // Check if this is a file from keepLocalCopy - it would be in our app's Documents directory
    // keepLocalCopy returns paths like: file:///Users/.../App/Documents/filename
    // RNFS.DocumentDirectoryPath is the app's Documents directory (without file://)
    const documentsPath = RNFS.DocumentDirectoryPath;

    // Decode URL-encoded characters (like %20 for spaces) and strip file:// prefix
    // This is critical because RNFS.exists() needs decoded paths, not URL-encoded
    let decodedUri = uri;
    try { decodedUri = decodeURIComponent(uri); } catch { /* Malformed picker URI: preserve literal path. */ }
    const cleanUri = decodedUri.replace(/^file:\/\//, '');

    // Only skip copying if the file is exactly in our app's Documents directory
    // This must be a precise match to avoid security-scoped URLs from document picker
    if (cleanUri.startsWith(documentsPath)) {
      console.log(`[DocumentService] File is in app Documents directory, using directly`);
      return cleanUri;
    }

    // Android: content:// URIs
    if (Platform.OS === 'android' && uri.startsWith('content://')) {
      const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
      await RNFS.copyFile(uri, tempPath);
      console.log('[DocumentService] Copied Android content:// URI to app storage');
      return tempPath;
    }

    // iOS: file:// URIs from document picker are security-scoped
    // Copy to a temp location that we can access directly
    if (Platform.OS === 'ios' && uri.startsWith('file://')) {
      const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${fileName}`;
      try {
        // RNFS.copyFile can handle file:// URIs by copying the underlying file
        await RNFS.copyFile(uri, tempPath);
        console.log('[DocumentService] Copied iOS file:// URI to app storage');
        return tempPath;
      } catch (_copyError) {
        // If direct copy fails, try stripping the file:// prefix
        const pathWithoutScheme = decodedUri.replace(/^file:\/\//, '');
        try {
          await RNFS.copyFile(pathWithoutScheme, tempPath);
          console.log('[DocumentService] Copied (fallback) to app storage');
          return tempPath;
        } catch {
          console.error(`[DocumentService] Both copy attempts failed`);
          throw new Error(`Could not access file. Please try selecting the file again.`);
        }
      }
    }

    console.log('[DocumentService] Returning URI as-is');
    return uri;
  }

  private validateFileType(extension: string, isPdf: boolean): void {
    if (!isPdf && !TEXT_EXTENSIONS.includes(extension) && !OFFICE_EXTENSIONS.includes(extension)) {
      throw new Error(`Unsupported file type: ${extension}. Supported: PDF, Word, PowerPoint, Excel, OpenDocument, EPUB, RTF, text, CSV, JSON and code files`);
    }
    if (isPdf && !pdfExtractor.isAvailable()) {
      throw new Error('PDF extraction is not available on this device');
    }
  }

  private async readContent(resolvedPath: string, isPdf: boolean, opts: { maxChars: number; forceMarkdown?: boolean }): Promise<string> {
    const { maxChars, forceMarkdown = false } = opts;
    console.log(`[DocumentService] readContent called - isPdf: ${isPdf}, maxChars: ${maxChars}`);
    const ext = `.${resolvedPath.split('.').pop()?.toLowerCase()}`;
    // The AI reads Markdown (headings, lists, tables) better than flat text, so documents are converted to it (Chat settings).
    const markdown = forceMarkdown || useAppStore.getState().settings.convertToMarkdown !== false;
    if (OFFICE_EXTENSIONS.includes(ext)) return markdown ? extractOfficeMarkdown(resolvedPath, ext, maxChars) : extractOffice(resolvedPath, ext, maxChars);
    try {
      const raw = isPdf
        ? await pdfExtractor.extractText(resolvedPath, maxChars)
        : await RNFS.readFile(resolvedPath, 'utf8');
      console.log(`[DocumentService] Successfully read ${raw.length} characters`);
      const text = markdown ? toMarkdown(raw, ext) : raw;
      if (text.length > maxChars) {
        return `${text.substring(0, maxChars)}\n\n... [Content truncated due to length]`;
      }
      return text;
    } catch (error: any) {
      console.error(`[DocumentService] Error reading content:`, error?.message || error);
      throw error;
    }
  }

  /** A file's text as Markdown whatever the Chat setting says (for converting files to .md). Nothing is copied or kept. */
  async markdownFromPath(path: string, maxChars = 2_000_000): Promise<string> {
    const extension = `.${path.split('.').pop()?.toLowerCase()}`;
    const isPdf = extension === PDF_EXTENSION;
    this.validateFileType(extension, isPdf);
    return this.readContent(path, isPdf, { maxChars, forceMarkdown: true });
  }

  private async savePersistentCopy(resolvedPath: string, originalPath: string, name: string): Promise<{ id: string; uri: string }> {
    await this.ensureAttachmentsDir();
    const id = Date.now().toString();
    const persistentPath = `${ATTACHMENTS_DIR}/${id}_${name}`;
    let ok = false;
    try {
      await RNFS.copyFile(resolvedPath, persistentPath);
      ok = await RNFS.exists(persistentPath);
    } catch { /* fall back to original path */ }
    if (resolvedPath !== originalPath && ok) {
      RNFS.unlink(resolvedPath).catch(() => {});
    }
    return { id, uri: ok ? persistentPath : resolvedPath };
  }

  /**
   * Process a document from a file path
   */
  async processDocumentFromPath(filePath: string, fileName?: string, maxCharsOverride?: number): Promise<MediaAttachment | null> {
    try {
      // Never log document paths or names: they can reveal protected-project content.
      const rawName = fileName || filePath.split('/').pop() || 'document';
      let name = rawName;
      try { name = decodeURIComponent(rawName); } catch { /* Keep malformed percent sequences displayable. */ }
      name = name.replaceAll(/[\\/]/g, '_');
      const extension = `.${name.split('.').pop()?.toLowerCase()}`;
      const isPdf = extension === PDF_EXTENSION;
      console.log(`[DocumentService] Detected extension: ${extension}, isPdf: ${isPdf}`);
      this.validateFileType(extension, isPdf);

      const resolvedPath = await this.resolveContentUri(filePath, name);

      // Verify the file exists and is accessible
      let fileExists = false;
      try {
        fileExists = await RNFS.exists(resolvedPath);
        console.log(`[DocumentService] File exists check: ${fileExists}`);
      } catch (existsError) {
        // RNFS.exists can fail on security-scoped URLs
        console.error(`[DocumentService] exists() threw error:`, existsError);
        throw new Error('Could not access file. Please try selecting the file again.');
      }

      if (!fileExists) {
        throw new Error(`File not found: ${name}`);
      }

      const stat = await RNFS.stat(resolvedPath);
      console.log(`[DocumentService] File size: ${stat.size} bytes`);
      // Text files are read whole; PDFs and office files are mostly pictures/zip, so allow bigger ones.
      const limit = isPdf || OFFICE_EXTENSIONS.includes(extension) ? 60 * 1024 * 1024 : MAX_FILE_SIZE;
      if (stat.size > limit) {
        throw new Error(`File is too large. Maximum size is ${limit / (1024 * 1024)}MB`);
      }

      const maxChars = maxCharsOverride ?? Math.floor((useAppStore.getState().settings.contextLength || APP_CONFIG.maxContextLength) * 4 * 0.5);
      const textContent = await this.readContent(resolvedPath, isPdf, { maxChars });
      const { id, uri } = await this.savePersistentCopy(resolvedPath, filePath, name);

      return { id, type: 'document', uri, fileName: name, textContent, fileSize: stat.size };
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Create a document attachment from pasted text.
   * Saves to a persistent file so it can be opened later from chat.
   */
  async createFromText(text: string, fileName: string = 'pasted-text.txt'): Promise<MediaAttachment> {
    const contextLength = useAppStore.getState().settings.contextLength || APP_CONFIG.maxContextLength;
    const maxChars = Math.floor(contextLength * 4 * 0.5);
    let textContent = text;
    if (textContent.length > maxChars) {
      textContent = `${textContent.substring(0, maxChars)  }\n\n... [Content truncated due to length]`;
    }

    const id = Date.now().toString();

    // Write to persistent file so it can be opened from chat
    let uri = '';
    try {
      await this.ensureAttachmentsDir();
      const persistentPath = `${ATTACHMENTS_DIR}/${id}_${fileName}`;
      await RNFS.writeFile(persistentPath, text, 'utf8');
      uri = persistentPath;
    } catch {
      // Failed to write — uri stays empty, tap will be a no-op
    }

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
    if (attachment.type !== 'document' || !attachment.textContent) {
      return '';
    }

    const fileName = attachment.fileName || 'document';
    return `\n\n---\n📄 **Attached Document: ${fileName}**\n\`\`\`\n${attachment.textContent}\n\`\`\`\n---\n`;
  }

  /**
   * Get a short preview of document content
   */
  getPreview(attachment: MediaAttachment, maxLength: number = 100): string {
    if (attachment.type !== 'document' || !attachment.textContent) {
      return attachment.fileName || 'Document';
    }

    const preview = attachment.textContent.substring(0, maxLength).replaceAll('\n', ' ');
    return preview.length < attachment.textContent.length ? `${preview  }...` : preview;
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
