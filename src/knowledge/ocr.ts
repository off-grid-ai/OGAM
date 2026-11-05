/**
 * Reading a scanned page with the loaded vision model. The page is drawn to an image by the native PDF module and the model is asked
 * to transcribe it exactly. If no vision model is loaded the page stays flagged as unreadable. Text read this way is marked as OCR in
 * the document, because a model can misread a page and the person should know which text came from a picture.
 */
import { llmService } from '../services/llm';
import { runBackgroundJob } from '../services/llmJobQueue';
import { pdfRenderPage } from '../services/pdfExtractor';
import { localUniqueId } from '../utils/uniqueId';

export const ocrAvailable = (): boolean => { try { return llmService.isModelLoaded() && llmService.supportsVision(); } catch { return false; } };

const PROMPT = 'Transcribe all the text on this page exactly as written, in reading order. Keep headings on their own line and keep table rows on one line each, with cells separated by " | ". Do not summarise, explain or add anything. If the page has no text, reply with nothing.';

/** The text of one page (0-based index) read from its picture; empty when the model sees no text. */
export async function ocrPage(pdfPath: string, pageIndex: number): Promise<string> {
  const image = await pdfRenderPage(pdfPath, pageIndex);
  const uri = image.startsWith('file://') ? image : `file://${image}`;
  return runBackgroundJob(async () => {
    const msg = { id: localUniqueId('ocr'), role: 'user' as const, content: PROMPT, timestamp: Date.now(), attachments: [{ id: localUniqueId('img'), type: 'image' as const, uri, mimeType: 'image/png' }] };
    const out: string = await llmService.generateResponse([msg], { disableThinking: true });
    return out.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }, { maxWaitMs: 10 * 60_000 });
}
