/**
 * Report a generated image or video from inside the app (Google Play AI-Generated Content policy).
 * One PostHog event: the reason, the prompt, the model and the type. The picture or clip never
 * leaves the phone.
 */
import { contentReported } from './analytics/analytics';

export type ReportKind = 'image' | 'video';
export type ReportReason = 'sexual' | 'violent' | 'hateful' | 'harmful' | 'other';

export const REPORT_REASONS: ReadonlyArray<{ id: ReportReason; label: string }> = [
  { id: 'sexual', label: 'Sexual content' },
  { id: 'violent', label: 'Violence or gore' },
  { id: 'hateful', label: 'Hateful or harassing' },
  { id: 'harmful', label: 'Dangerous or harmful' },
  { id: 'other', label: 'Something else' },
];

export interface ContentReport {
  kind: ReportKind;
  reason: ReportReason;
  prompt: string;
  modelId: string;
}

/** Resolves once the report is sent; rejects when it could not be. */
export function sendContentReport(report: ContentReport): Promise<void> {
  return contentReported({ type: report.kind, reason: report.reason, prompt: report.prompt, model: report.modelId });
}
