import { check } from '../../src/study/exercises';
import { DRILL_KINDS, makeDrill, makeDrillSet } from '../../src/study/drills';

describe('accounting drills', () => {
  it('are the same for the same seed and different for another', () => {
    expect(makeDrill('net-income', 5)).toEqual(makeDrill('net-income', 5));
    expect(makeDrill('net-income', 5)).not.toEqual(makeDrill('net-income', 6));
  });

  it('always balance: the answer key passes its own check, and breaking one amount fails it', () => {
    for (let seed = 1; seed <= 60; seed++) {
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

  it('computes the answers the way a textbook does (independent recalculation from the question text)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const loan: any = makeDrill('loan-payment', seed);
      const [, principal, rate, years] = loan.prompt.match(/\$([\d,]+) loan at ([\d.]+)% a year, paid monthly over (\d+) years/) as string[];
      const i = Number(rate) / 100 / 12; const n = Number(years) * 12; const p = Number(principal.replace(/,/g, ''));
      expect(loan.answer).toBeCloseTo((p * i) / (1 - (1 + i) ** -n), 1);

      const eff: any = makeDrill('effective-rate', seed);
      const [, nom, m] = eff.prompt.match(/nominal rate of ([\d.]+)% is compounded (\d+) times/) as string[];
      expect(eff.answer).toBeCloseTo(((1 + Number(nom) / 100 / Number(m)) ** Number(m) - 1) * 100, 1);

      const dev: any = makeDrill('std-dev', seed);
      const xs = (dev.prompt.match(/of: ([\d, ]+)\./) as string[])[1].split(',').map(Number);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(dev.answer).toBeCloseTo(Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)), 1);
    }
  });

  it('covers accounting and the research statistics the doctoral courses use', () => {
    expect(DRILL_KINDS.length).toBeGreaterThanOrEqual(20);
    const topics = new Set(DRILL_KINDS.map((k) => (makeDrill(k, 3) as any).topic));
    for (const t of ['Compound interest and loans', 'Inventory', 'Depreciation', 'Ratios', 'Cost-volume-profit', 'Capital budgeting', 'Income statement', 'Cash flow statement', 'Trial balance', 'Research statistics']) expect(topics.has(t)).toBe(true);
  });
});
