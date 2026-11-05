import { check } from '../../src/study/exercises';
import { DRILL_KINDS, makeDrill, makeDrillSet } from '../../src/study/drills';

describe('accounting drills', () => {
  it('are the same for the same seed and different for another', () => {
    expect(makeDrill('net-income', 5)).toEqual(makeDrill('net-income', 5));
    expect(makeDrill('net-income', 5)).not.toEqual(makeDrill('net-income', 6));
  });

  it('always balance: the answer key passes its own check, and breaking one amount fails it', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const kind of DRILL_KINDS) {
        const ex: any = makeDrill(kind, seed);
        const key = ex.kind === 'table' ? ex.rows.map((r: any) => ({ account: r.account, amount: String(r.amount) })) : String(ex.answer);
        expect(check(ex, key).correct).toBe(true);
        if (ex.kind === 'table') {
          const bad = key.map((k: any, i: number) => (i === 0 ? { ...k, amount: String(Number(k.amount) + 100) } : k));
          expect(check(ex, bad).correct).toBe(false);
        }
      }
    }
  });

  it('makes a mixed set with unique ids', () => {
    const set = makeDrillSet(6, 10);
    expect(set).toHaveLength(6);
    expect(new Set(set.map((e) => e.id)).size).toBe(6);
  });
});
