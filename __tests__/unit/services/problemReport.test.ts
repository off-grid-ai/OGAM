import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return { __esModule: true, default: boundary.module };
});

/**
 * Report a problem sends the debug log to support.
 *
 * The person must land in a mail they can send as is: support's address already in To, a subject
 * that names the version, and the log. Only the OS is faked here - the mail composer, the share
 * sheet and the file system (in memory). The log is written by the real log sink.
 */

interface Composed {
  to: string;
  subject: string;
  body: string;
  attachmentPath?: string;
}

interface Shared {
  content: { title?: string; message?: string; url?: string };
  options: { subject?: string };
}

// The OS side. Set before the service loads, since it reads NativeModules at import.
const composed: Composed[] = [];
const shared: Shared[] = [];
let mailApp = true;
const rn = require('react-native');
rn.NativeModules.ProblemReportModule = {
  composeEmail: async (to: string, subject: string, body: string, attachmentPath?: string) => {
    if (!mailApp) return false;
    composed.push({ to, subject, body, attachmentPath });
    return true;
  },
};
Object.defineProperty(rn.Share, 'share', {
  configurable: true,
  writable: true,
  value: async (content: Shared['content'], options: Shared['options']) => {
    shared.push({ content, options });
    return { action: 'sharedAction' };
  },
});

const logFile = require('../../../src/utils/debugLogFile');
const { sendProblemReport } = require('../../../src/services/problemReport');

function load(os: 'android' | 'ios', hasMailApp: boolean) {
  rn.Platform.OS = os;
  mailApp = hasMailApp;
  logFile.initDebugLogFile();
  return {
    sendProblemReport: sendProblemReport as () => Promise<void>,
    log: (line: string) => logFile.appendDebugLine('log', line),
    logPath: logFile.getDebugLogPath() as string,
    stop: logFile.stopDebugLogFile as () => void,
    composed,
    shared,
  };
}

describe('Report a problem', () => {
  const originalOS = rn.Platform.OS;
  let stop: (() => void) | undefined;

  beforeEach(() => {
    modelTransferFsBoundary.reset();
    modelTransferFsBoundary.seedDir(modelTransferFsBoundary.DocumentDirectoryPath);
    composed.length = 0;
    shared.length = 0;
  });

  afterEach(() => {
    stop?.();
    rn.Platform.OS = originalOS;
  });

  it('on Android opens a mail to support with the subject and the log in the message', async () => {
    const app = load('android', true);
    stop = app.stop;
    app.log('video render failed at frame 4');

    await app.sendProblemReport();

    expect(app.composed).toHaveLength(1);
    const [mail] = app.composed;
    expect(mail.to).toBe('support@getoffgridai.co');
    expect(mail.subject).toBe('[Problem] Off Grid AI v0.0.103');
    expect(mail.body).toContain('What went wrong:');
    expect(mail.body).toContain('video render failed at frame 4');
    expect(mail.body).not.toContain('To: ');
    expect(app.shared).toHaveLength(0);
  });

  it('on iOS opens a mail to support with the full log file attached', async () => {
    const app = load('ios', true);
    stop = app.stop;
    app.log('sync replay stalled');

    await app.sendProblemReport();

    const [mail] = app.composed;
    expect(mail.to).toBe('support@getoffgridai.co');
    expect(mail.subject).toBe('[Problem] Off Grid AI v0.0.103');
    expect(mail.body).not.toContain('To: ');
    expect(mail.attachmentPath).toBe(app.logPath);
    const attached = await modelTransferFsBoundary.module.readFile(mail.attachmentPath!, 'utf8');
    expect(attached).toContain('sync replay stalled');
  });

  it('with no mail app, the share sheet still carries the subject, the address and the log', async () => {
    const app = load('android', false);
    stop = app.stop;
    app.log('download stopped at 40%');

    await app.sendProblemReport();

    expect(app.shared).toHaveLength(1);
    const [{ content, options }] = app.shared;
    expect(content.title).toBe('[Problem] Off Grid AI v0.0.103');
    expect(options.subject).toBe('[Problem] Off Grid AI v0.0.103');
    expect(content.message).toContain('support@getoffgridai.co');
    expect(content.message).toContain('download stopped at 40%');
  });
});
