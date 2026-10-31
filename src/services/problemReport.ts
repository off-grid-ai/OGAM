/**
 * Report a problem (docs/ANALYTICS.md): send the debug log to support. Works whether or not
 * analytics is on. The person has already seen the log in the Debug Logs view before this runs.
 *
 * It opens a mail app with the support address in To and the subject set (ProblemReportModule).
 * iOS attaches the full log file; Android's mail intent takes text, so the log's most recent part
 * goes in the message. When no mail app can take it, the system share sheet is the fallback.
 */
import { NativeModules, Platform, Share } from 'react-native';
import RNFS from 'react-native-fs';
import { flushDebugLogNow, getDebugLogPath } from '../utils/debugLogFile';
import { SUPPORT_EMAIL } from '../utils/supportEmail';
import { appBuildLabel, appVersion } from '../utils/appVersion';
import { track } from './analytics/analytics';

/** Android share text stays well under the platform's transaction limit. */
const MAX_INLINE_LOG_CHARS = 100_000;

async function readLog(path: string): Promise<string | null> {
  try {
    if (!(await RNFS.exists(path))) return null;
    return await RNFS.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

interface ProblemReportNative {
  composeEmail(to: string, subject: string, body: string, attachmentPath?: string): Promise<boolean>;
}

const { ProblemReportModule } = NativeModules as { ProblemReportModule?: ProblemReportNative };

async function openMail(subject: string, body: string, attachmentPath?: string): Promise<boolean> {
  if (!ProblemReportModule) return false;
  try {
    return Platform.OS === 'ios'
      ? await ProblemReportModule.composeEmail(SUPPORT_EMAIL, subject, body, attachmentPath ?? '')
      : await ProblemReportModule.composeEmail(SUPPORT_EMAIL, subject, body);
  } catch {
    return false;
  }
}

export async function sendProblemReport(): Promise<void> {
  await flushDebugLogNow();
  const path = getDebugLogPath();
  const log = await readLog(path);
  const subject = `[Problem] Off Grid AI v${appVersion()}`;
  const header = `${appBuildLabel()}\n\nWhat went wrong:\n\n`;
  const attachLog = Platform.OS === 'ios' && log !== null;
  const body = attachLog || !log ? header : `${header}---\n${log.slice(-MAX_INLINE_LOG_CHARS)}`;
  track('problem_reported');
  if (await openMail(subject, body, attachLog ? path : undefined)) return;
  // No mail app: the share sheet cannot set To, so the address leads the message.
  const shareHeader = `To: ${SUPPORT_EMAIL}\n${body}`;
  await Share.share(
    attachLog ? { title: subject, message: shareHeader, url: `file://${path}` } : { title: subject, message: shareHeader },
    { subject },
  );
}
