import {
  _clearHooksForTesting,
  callHook,
  HOOKS,
  registerHook,
} from '../../../src/bootstrap/hookRegistry';

describe('application lifecycle hook readiness', () => {
  beforeEach(() => {
    _clearHooksForTesting();
  });

  it('replays readiness when a feature registers after application start', () => {
    callHook(HOOKS.applicationStarted);
    let starts = 0;

    registerHook(HOOKS.applicationStarted, () => {
      starts += 1;
    });

    expect(starts).toBe(1);
  });

  it('does not replay stale readiness when a feature registers after application stop begins', () => {
    callHook(HOOKS.applicationStarted);
    callHook(HOOKS.applicationStopping);
    let starts = 0;

    registerHook(HOOKS.applicationStarted, () => {
      starts += 1;
    });

    expect(starts).toBe(0);
  });
});
