/**
 * The deferred-STT scheduler — pure, so the battery/routing/ordering policy is tested without a
 * device. Guards: battery protection (and the flagged-moment exception), Mac-when-reachable routing,
 * oldest-first ordering, batch bounding, and the retry cap.
 */

import {
  planTranscription,
  DEFAULT_STT_SCHEDULER_CONFIG,
  type DeviceConditions,
  type PendingSegment,
  type SttSchedulerConfig
} from '../../../../src/services/ambient/sttScheduler';

const CONFIG: SttSchedulerConfig = { lowBatteryLevel: 0.2, maxBatch: 3, maxAttempts: 3 };

const HEALTHY: DeviceConditions = { batteryLevel: 0.8, charging: false, macReachable: false };

function seg(id: string, startMs: number, extra: Partial<PendingSegment> = {}): PendingSegment {
  return { id, startMs, attempts: 0, ...extra };
}

describe('sttScheduler.planTranscription', () => {
  it('reports nothing-pending for an empty queue', () => {
    expect(planTranscription([], HEALTHY, CONFIG)).toEqual({
      jobs: [],
      deferred: false,
      reason: 'nothing-pending'
    });
  });

  it('transcribes oldest-first on the phone when the Mac is unreachable', () => {
    const plan = planTranscription([seg('b', 200), seg('a', 100)], HEALTHY, CONFIG);
    expect(plan.deferred).toBe(false);
    expect(plan.jobs).toEqual([
      { segmentId: 'a', executor: 'phone' },
      { segmentId: 'b', executor: 'phone' }
    ]);
  });

  it('routes to the Mac when it is reachable over the mesh', () => {
    const plan = planTranscription([seg('a', 100)], { ...HEALTHY, macReachable: true }, CONFIG);
    expect(plan.jobs).toEqual([{ segmentId: 'a', executor: 'mac' }]);
  });

  it('defers when the battery is low and unplugged', () => {
    const plan = planTranscription(
      [seg('a', 100)],
      { batteryLevel: 0.1, charging: false, macReachable: false },
      CONFIG
    );
    expect(plan).toEqual({ jobs: [], deferred: true, reason: 'low-battery' });
  });

  it('still transcribes a flagged segment on low battery, skipping the unflagged ones', () => {
    const plan = planTranscription(
      [seg('a', 100), seg('b', 200, { flagged: true })],
      { batteryLevel: 0.1, charging: false, macReachable: false },
      CONFIG
    );
    expect(plan.deferred).toBe(false);
    expect(plan.jobs).toEqual([{ segmentId: 'b', executor: 'phone' }]);
  });

  it('transcribes normally on low battery while charging', () => {
    const plan = planTranscription(
      [seg('a', 100)],
      { batteryLevel: 0.1, charging: true, macReachable: false },
      CONFIG
    );
    expect(plan.jobs).toEqual([{ segmentId: 'a', executor: 'phone' }]);
  });

  it('orders flagged segments ahead of older unflagged ones', () => {
    const plan = planTranscription(
      [seg('old', 100), seg('flag', 500, { flagged: true }), seg('mid', 300)],
      HEALTHY,
      CONFIG
    );
    expect(plan.jobs.map((j) => j.segmentId)).toEqual(['flag', 'old', 'mid']);
  });

  it('bounds the burst to maxBatch', () => {
    const many = Array.from({ length: 10 }, (_, i) => seg(`s${i}`, i * 100));
    const plan = planTranscription(many, HEALTHY, CONFIG);
    expect(plan.jobs).toHaveLength(CONFIG.maxBatch);
    expect(plan.jobs.map((j) => j.segmentId)).toEqual(['s0', 's1', 's2']);
  });

  it('drops segments that exceeded the attempt cap', () => {
    const plan = planTranscription(
      [seg('dead', 100, { attempts: 3 }), seg('live', 200, { attempts: 1 })],
      HEALTHY,
      CONFIG
    );
    expect(plan.jobs).toEqual([{ segmentId: 'live', executor: 'phone' }]);
  });

  it('reports nothing-pending when every segment is over the attempt cap', () => {
    const plan = planTranscription([seg('dead', 100, { attempts: 5 })], HEALTHY, CONFIG);
    expect(plan).toEqual({ jobs: [], deferred: false, reason: 'nothing-pending' });
  });

  it('ships sane defaults', () => {
    expect(DEFAULT_STT_SCHEDULER_CONFIG.lowBatteryLevel).toBeGreaterThan(0);
    expect(DEFAULT_STT_SCHEDULER_CONFIG.maxAttempts).toBeGreaterThan(0);
  });
});
