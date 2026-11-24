/**
 * Report a generated image or video from inside the app (Google Play AI-Generated Content policy).
 * Sends the reason, the prompt and, only when the person chose to include it, the image or clip.
 * Nothing else from the chat leaves the phone.
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { appVersion } from '../utils/appVersion';
import { resolveDocumentPath } from '../utils/resolveDocumentPath';

const REPORT_URL = 'https://license.getoffgridai.co/report';

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
  /** The file on this phone; read only when includeMedia is true. */
  mediaPath: string;
  includeMedia: boolean;
}

function mediaType(path: string, kind: ReportKind): string {
  if (kind === 'video') return 'video/mp4';
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/** Resolves once support has the report; rejects when it could not be sent. */
export async function sendContentReport(report: ContentReport): Promise<void> {
  const path = resolveDocumentPath(report.mediaPath).replace(/^file:\/\//, '');
  const media = report.includeMedia
    ? { type: mediaType(path, report.kind), base64: await RNFS.readFile(path, 'base64') }
    : null;
  const res = await fetch(REPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: report.kind,
      reason: report.reason,
      prompt: report.prompt,
      app: `${appVersion()} ${Platform.OS}`,
      media,
    }),
  });
  if (!res.ok) throw new Error(`report not sent (${res.status})`);
}
