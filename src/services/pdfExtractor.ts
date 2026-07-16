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
      logger.log(`[WIRE-PDF] ${JSON.stringify({ filePath, maxChars, textLength: __text?.length, sample: (__text ?? '').slice(0, 200) })}`); // [WIRE] native PDF→text extraction shape
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
