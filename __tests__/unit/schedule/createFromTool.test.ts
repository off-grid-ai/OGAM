import { createScheduledTask, parseClock } from '../../../src/schedule/createFromTool';
import { useSchedule } from '../../../src/schedule/store';

beforeEach(() => useSchedule.setState({ tasks: [] }));

describe('making a scheduled task from what you say', () => {
  it('understands the ways a time is written', () => {
    expect(parseClock('07:30')).toEqual({ hour: 7, minute: 30 });
    expect(parseClock('7am')).toEqual({ hour: 7, minute: 0 });
    expect(parseClock('7 pm')).toEqual({ hour: 19, minute: 0 });
    expect(parseClock('12am')).toEqual({ hour: 0, minute: 0 });
    expect(parseClock('25:00')).toBeNull();
    expect(parseClock('soon')).toBeNull();
  });
  it('saves a repeating task and says what it did', () => {
    const said = createScheduledTask({ task: 'Read me the top tech news', time: '7am', repeat: 'weekdays', name: 'Tech news' });
    expect(said).toContain('Tech news');
    expect(said).toContain('weekdays at 07:00');
    expect(useSchedule.getState().tasks[0]).toMatchObject({ name: 'Tech news', kind: 'prompt', repeat: 'weekdays', hour: 7, minute: 0, enabled: true });
  });
  it('makes a daily briefing task without a prompt, and a weekly one on its day', () => {
    createScheduledTask({ kind: 'briefing', time: '08:15', repeat: 'daily' });
    createScheduledTask({ task: 'Weekly review', time: '18:00', repeat: 'weekly', weekday: 'Sunday' });
    const [brief, weekly] = useSchedule.getState().tasks;
    expect(brief).toMatchObject({ kind: 'briefing', prompt: '', name: 'Daily briefing' });
    expect(weekly).toMatchObject({ repeat: 'weekly', weekday: 0 });
  });
  it('asks for what is missing instead of saving half a task', () => {
    expect(createScheduledTask({ task: 'x', time: 'whenever', repeat: 'daily' })).toMatch(/time was not clear/);
    expect(createScheduledTask({ task: 'x', time: '9:00', repeat: 'weekly' })).toMatch(/which day/);
    expect(createScheduledTask({ time: '9:00', repeat: 'daily' })).toMatch(/what the task should do/);
    expect(useSchedule.getState().tasks).toHaveLength(0);
  });
  it('a one-time task is set for the next time that clock reading comes round', () => {
    const now = new Date(2026, 10, 4, 9, 0).getTime();
    createScheduledTask({ task: 'Call the bank', time: '8am', repeat: 'once' }, now);
    expect(useSchedule.getState().tasks[0].onceAt).toBe(new Date(2026, 10, 5, 8, 0).getTime());
  });
});
