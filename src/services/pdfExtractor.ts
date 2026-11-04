/**
 * PDFExtractor - TypeScript wrapper for native PDF text extraction modules.
 * Uses PDFKit on iOS (built-in) and PDFium on Android (native C++ via JNI).
 */

import { NativeModules } from 'react-native';
import logger from '../utils/logger';

const { PDFExtractorModule } = NativeModules;

class PDFExtractor {
  /**
   * Check if the native PDF extraction module is available
   */
  isAvailable(): boolean {
    return PDFExtractorModule != null;
  }

  /**
   * Extract text from a PDF file at the given path.
   * Returns up to maxChars characters of text content.
   */
  async extractText(filePath: string, maxChars: number = 50000): Promise<string> {
    if (!this.isAvailable()) {
      throw new Error('PDF extraction is not available on this platform');
    }

    try {
      const __text = await PDFExtractorModule.extractText(filePath, maxChars);
      logger.log(`[PDF] extracted ${__text?.length ?? 0} chars`);
      return __text;
    } catch (error: any) {
      // Guard against NullPointerException when bridge promise is rejected after teardown
      if (error?.message?.includes('NullPointerException') || error?.code === 'BRIDGE_DESTROYED') {
        throw new Error('PDF extraction failed: native bridge unavailable');
      }
      throw error;
    }
  }
}

export const pdfExtractor = new PDFExtractor();

/**
 * Page-by-page access (the same contract on both platforms): `pageCount` and `extractPages`. Unlike extractText, which joins pages
 * into one capped string, this keeps each page separate so knowledge can cite page numbers and large documents can be read in
 * small batches.
 */
export async function pdfPageCount(filePath: string): Promise<number> {
  if (!PDFExtractorModule?.pageCount) throw new Error('PDF page reading is not available on this platform');
  return Number(await PDFExtractorModule.pageCount(filePath));
}

/** The text of `count` pages starting at the 0-based `start`, one string per page; empty where a page has no text. */
export async function pdfExtractPages(filePath: string, start: number, count: number): Promise<string[]> {
  if (!PDFExtractorModule?.extractPages) throw new Error('PDF page reading is not available on this platform');
  return (await PDFExtractorModule.extractPages(filePath, start, count)) as string[];
}
