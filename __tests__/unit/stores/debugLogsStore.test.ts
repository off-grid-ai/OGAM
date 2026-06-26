import { useDebugLogsStore } from '../../../src/stores/debugLogsStore';

describe('debugLogsStore', () => {
  beforeEach(() => useDebugLogsStore.getState().clearLogs());

  it('appends log entries in order', () => {
    useDebugLogsStore.getState().addLog({ timestamp: 1, level: 'log', message: 'a' });
    useDebugLogsStore.getState().addLog({ timestamp: 2, level: 'warn', message: 'b' });
    expect(useDebugLogsStore.getState().logs.map(l => l.message)).toEqual(['a', 'b']);
  });

  it('caps the buffer at the in-memory limit, dropping the oldest', () => {
    for (let i = 0; i < 520; i++) {
      useDebugLogsStore.getState().addLog({ timestamp: i, level: 'log', message: `m${i}` });
    }
    const { logs } = useDebugLogsStore.getState();
    expect(logs.length).toBe(500);
    expect(logs[0].message).toBe('m20'); // oldest 20 dropped
    expect(logs[logs.length - 1].message).toBe('m519'); // newest kept
  });

  it('clearLogs empties the buffer', () => {
    useDebugLogsStore.getState().addLog({ timestamp: 1, level: 'error', message: 'x' });
    useDebugLogsStore.getState().clearLogs();
    expect(useDebugLogsStore.getState().logs).toEqual([]);
  });
});
