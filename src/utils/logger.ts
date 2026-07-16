// Under jest, console.* is mocked to jest.fn() (see jest.setup.ts), so logger output is invisible in tests.
// When DEBUG_LOGS is set (e.g. `DEBUG_LOGS=1 npx jest <file>`), ALSO mirror every log to process.stderr —
// which jest does NOT mock — so the source's [X-SM] state-machine traces become visible while debugging a
// test, without patching the logger per-test or sprinkling process.stderr.write through the source. Opt-in
// so normal test runs stay quiet.
const stderrDebug =
  typeof process !== 'undefined' &&
  !!process.env?.JEST_WORKER_ID &&
  !!process.env?.DEBUG_LOGS;

const toStderr = (level: string, args: unknown[]): void => {
  if (!stderrDebug) return;
  try {
    process.stderr.write(
      `[${level}] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}\n`,
    );
  } catch {
    /* stderr unavailable — ignore */
  }
};

const logger = {
  log: (...args: unknown[]): void => {
    toStderr('log', args);
    if (__DEV__) console.log(...args); // NOSONAR
  },
  warn: (...args: unknown[]): void => {
    toStderr('warn', args);
    if (__DEV__) console.warn(...args); // NOSONAR
  },
  error: (...args: unknown[]): void => {
    toStderr('error', args);
    if (__DEV__) console.error(...args); // NOSONAR
  },
};

export default logger;
