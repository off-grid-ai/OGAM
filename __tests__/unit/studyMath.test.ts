import { convertUnits, dateMath, describe as desc, regression, sampleSize, studyMath, tTest, tvm } from '../../src/study/mathTools';

describe('study maths', () => {
  it('gets statistics right', () => {
    const d = desc([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(d.mean).toBe(5); expect(d.median).toBe(4.5); expect(d.populationStdev).toBe(2);
  });
  it('runs t tests and a regression with known answers', () => {
    const t = tTest([5.1, 4.9, 5.6, 5.8, 6.0, 5.2], undefined, { mu0: 5 });
    expect(t.df).toBe(5); expect(t.p).toBeGreaterThan(0.02); expect(t.p).toBeLessThan(0.1);
    const r = regression([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]);
    expect(r.slope).toBe(0.6); expect(r.intercept).toBe(2.2);
  });
  it('sizes a sample, converts units and does date and money maths', () => {
    expect(sampleSize(0.05)).toBe(385);
    expect(convertUnits(100, 'c', 'f')).toBe(212); expect(convertUnits(1, 'mi', 'km')).toBe(1.609344);
    expect(() => convertUnits(1, 'kg', 'm')).toThrow(/Cannot convert/);
    expect(dateMath({ from: '2026-11-05', to: '2027-01-15' }).days).toBe(71);
    expect(dateMath({ from: '2026-11-05', add_days: 30 })).toEqual({ date: '2026-12-05', weekday: 'Saturday' });
    expect(tvm({ pv: -1000, rate: 0.05, nper: 10, pmt: 0 }).fv).toBe(1628.8946);
    expect(tvm({ pv: 10000, fv: 0, rate: 0.01, nper: 12 }).pmt).toBeCloseTo(-888.4879, 3);
  });
  it('refuses bad input with a clear message', () => {
    expect(() => studyMath({ action: 'describe', values: 'a b' })).toThrow(/Not a number/);
    expect(() => studyMath({ action: 'nope' })).toThrow(/action must be/);
    expect(() => dateMath({ from: '2026-02-30' })).toThrow(/Not a real date/);
  });
});
