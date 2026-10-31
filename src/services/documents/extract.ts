// ExtractPort for the phone: PDFs page by page through the native readers (PDFKit, PDFium) in
// batches, so a long book never crosses the bridge at once; text files and pasted text as parts.

import RNFS from 'react-native-fs';
import { textParts, type DocumentPage, type ExtractPort } from '@offgrid/rag/documents';
import { pdfExtractor } from '../pdfExtractor';
import { localPath } from './project';

const PAGE_BATCH = 50;

export const documentExtractor: ExtractPort = {
  async extract(source, { signal, onPages }) {
    if (source.kind === 'pdf' && source.path) {
      const path = localPath(source.path);
      let start = 0;
      let pageCount = Number.POSITIVE_INFINITY;
      while (start < pageCount && !signal?.aborted) {
        const batch = await pdfExtractor.extractPages(path, start, PAGE_BATCH);
        pageCount = batch.pageCount;
        if (!batch.pages.length) break;
        onPages(batch.pages.map((text, i): DocumentPage => ({ page: start + i + 1, text })));
        start += batch.pages.length;
      }
      return { pageCount: Number.isFinite(pageCount) ? pageCount : 0 };
    }
    const text = source.text ?? (source.path ? await RNFS.readFile(localPath(source.path), 'utf8') : '');
    const parts = textParts(text);
    for (let i = 0; i < parts.length; i += PAGE_BATCH) onPages(parts.slice(i, i + PAGE_BATCH));
    return { pageCount: parts.length };
  },
};
