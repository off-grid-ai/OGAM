/**
 * Exact study maths done in code, never by the model: statistics, unit conversion, date arithmetic and time-value of money.
 * One entry point (`studyMath`) so the tutor calls a single tool with an action name.
 */
const num = (v: unknown): number => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Not a number: ${String(v)}`); return n; };
const list = (v: unknown): number[] => {
  const a = Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/).filter(Boolean);
  if (!a.length) throw new Error('Give at least one number.');
  return a.map(num);
};
const round = (n: number, d = 6) => Number(n.toFixed(d));

export const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
export const median = (x: number[]) => { const s = [...x].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const variance = (x: number[], sample = true) => { const m = mean(x); return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - (sample ? 1 : 0)); };
export const stdev = (x: number[], sample = true) => Math.sqrt(variance(x, sample));

/** Regularised incomplete beta by continued fraction: gives the t distribution's p-value. */
function betacf(a: number, b: number, x: number): number {
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < 1e-30) d = 1e-30; c = 1 + aa / c; if (Math.abs(c) < 1e-30) c = 1e-30; d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}
function lgamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = z, x = z; let t = x + 5.5; t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015; for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-sided p-value of a t statistic with df degrees of freedom. */
export const tPValue = (t: number, df: number) => betai(df / 2, 0.5, df / (df + t * t));

export function describe(x: number[]) {
  return { n: x.length, sum: round(x.reduce((s, v) => s + v, 0)), mean: round(mean(x)), median: round(median(x)), min: Math.min(...x), max: Math.max(...x),
    sampleVariance: x.length > 1 ? round(variance(x)) : null, sampleStdev: x.length > 1 ? round(stdev(x)) : null, populationStdev: round(stdev(x, false)) };
}

export function tTest(a: number[], b?: number[], opts: { mu0?: number; paired?: boolean } = {}) {
  const mu0 = opts.mu0 ?? 0;
  if (b && opts.paired) { if (a.length !== b.length) throw new Error('Paired samples need equal lengths.'); return tTest(a.map((v, i) => v - b[i])); }
  if (!b) { const df = a.length - 1; if (df < 1) throw new Error('Need at least 2 values.'); const t = (mean(a) - mu0) / (stdev(a) / Math.sqrt(a.length)); return { kind: 'one-sample', t: round(t), df, p: round(tPValue(t, df)) }; }
  const v1 = variance(a), v2 = variance(b), n1 = a.length, n2 = b.length;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = (mean(a) - mean(b)) / se;
  const df = (v1 / n1 + v2 / n2) ** 2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  return { kind: 'welch two-sample', t: round(t), df: round(df, 3), p: round(tPValue(t, df)) };
}

export function regression(x: number[], y: number[]) {
  if (x.length !== y.length || x.length < 3) throw new Error('Need equal-length x and y with at least 3 points.');
  const mx = mean(x), my = mean(y);
  const sxy = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0), sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0), syy = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const slope = sxy / sxx, intercept = my - slope * mx, r = sxy / Math.sqrt(sxx * syy);
  const df = x.length - 2, t = r * Math.sqrt(df / (1 - r * r));
  return { slope: round(slope), intercept: round(intercept), r: round(r), rSquared: round(r * r), n: x.length, p: round(tPValue(t, df)) };
}

const Z: Record<string, number> = { '0.80': 1.2816, '0.90': 1.6449, '0.95': 1.96, '0.99': 2.5758 };
/** Sample size to estimate a proportion (p, default 0.5) within a margin of error. */
export function sampleSize(margin: number, confidence = 0.95, p = 0.5) {
  const z = Z[confidence.toFixed(2)]; if (!z) throw new Error('Confidence must be 0.80, 0.90, 0.95 or 0.99.');
  return Math.ceil((z * z * p * (1 - p)) / (margin * margin));
}

const LINEAR: Record<string, [string, number]> = {
  m: ['length', 1], km: ['length', 1000], cm: ['length', 0.01], mm: ['length', 0.001], mi: ['length', 1609.344], ft: ['length', 0.3048], in: ['length', 0.0254], yd: ['length', 0.9144],
  kg: ['mass', 1], g: ['mass', 0.001], lb: ['mass', 0.45359237], oz: ['mass', 0.028349523125],
  l: ['volume', 1], ml: ['volume', 0.001], gal: ['volume', 3.785411784], qt: ['volume', 0.946352946], cup: ['volume', 0.2365882365],
  s: ['time', 1], min: ['time', 60], h: ['time', 3600], day: ['time', 86400],
  mph: ['speed', 0.44704], kph: ['speed', 1 / 3.6], 'm/s': ['speed', 1],
};
export function convertUnits(value: number, from: string, to: string) {
  const f = from.toLowerCase(), t = to.toLowerCase();
  const temp = (v: number, a: string, b: string) => { const c = a === 'c' ? v : a === 'f' ? ((v - 32) * 5) / 9 : v - 273.15; return b === 'c' ? c : b === 'f' ? (c * 9) / 5 + 32 : c + 273.15; };
  if (['c', 'f', 'k'].includes(f) && ['c', 'f', 'k'].includes(t)) return round(temp(value, f, t));
  const a = LINEAR[f], b = LINEAR[t];
  if (!a || !b) throw new Error(`Unknown unit: ${!a ? from : to}`);
  if (a[0] !== b[0]) throw new Error(`Cannot convert ${a[0]} to ${b[0]}.`);
  return round((value * a[1]) / b[1]);
}

const parseDate = (s: unknown): Date => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) throw new Error(`Use YYYY-MM-DD, got: ${String(s)}`); const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (d.getUTCMonth() !== +m[2] - 1) throw new Error(`Not a real date: ${String(s)}`); return d; };
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function dateMath(a: { from?: string; to?: string; add_days?: number }) {
  const from = parseDate(a.from);
  if (a.add_days !== undefined) { const d = new Date(from.getTime() + num(a.add_days) * 86400000); return { date: iso(d), weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) }; }
  if (a.to) { const to = parseDate(a.to); const days = Math.round((to.getTime() - from.getTime()) / 86400000); return { days, weeks: round(days / 7, 2) }; }
  return { weekday: from.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) };
}

type Tvm = { pv?: number; fv?: number; pmt?: number; rate?: number; nper?: number };
const annuity = (r: number, n: number) => (r === 0 ? n : ((1 + r) ** n - 1) / r);
const solveRate = (a: Tvm): number => {
  const f = (x: number) => (a.pv ?? 0) * (1 + x) ** (a.nper ?? 0) + (a.pmt ?? 0) * annuity(x, a.nper ?? 0) + (a.fv ?? 0);
  let lo = -0.99, hi = 10;
  if (f(lo) * f(hi) > 0) throw new Error('No rate found for these values.');
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
};
const SOLVERS: Record<string, (a: Required<Pick<Tvm, 'pv' | 'fv' | 'pmt' | 'rate' | 'nper'>>) => number> = {
  fv: ({ pv, rate: r, nper: n, pmt }) => -(pv * (1 + r) ** n + pmt * annuity(r, n)),
  pv: ({ fv, rate: r, nper: n, pmt }) => -(fv + pmt * annuity(r, n)) / (1 + r) ** n,
  pmt: ({ pv, fv, rate: r, nper: n }) => (r === 0 ? -(pv + fv) / n : -((pv * (1 + r) ** n + fv) * r) / ((1 + r) ** n - 1)),
  nper: ({ pv, fv, rate: r, pmt }) => (r === 0 ? -(pv + fv) / pmt : Math.log((pmt - fv * r) / (pmt + pv * r)) / Math.log(1 + r)),
};
/** Time value of money: give every input but one (fv, pv, pmt, rate, nper) and it solves the missing value. Rate is per period, pmt at period end. */
export function tvm(a: Tvm): Record<string, number> {
  const missing = (['pv', 'fv', 'pmt', 'rate', 'nper'] as const).filter((k) => a[k] === undefined);
  if (missing.length !== 1) throw new Error('Leave exactly one of pv, fv, pmt, rate, nper out.');
  const key = missing[0];
  if (key === 'rate') return { rate: round(solveRate(a), 8) };
  const full = { pv: a.pv ?? 0, fv: a.fv ?? 0, pmt: a.pmt ?? 0, rate: a.rate ?? 0, nper: a.nper ?? 0 };
  return { [key]: round(SOLVERS[key](full), 4) };
}


// ---------------------------------------------------------------- everyday maths: equations, numbers, percents, shapes, fractions
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const nInt = (v: unknown, what: string): number => { const n = num(v); if (!Number.isInteger(n)) throw new Error(`${what} must be a whole number.`); return n; };
function choose(n: number, k: number): number { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= Math.min(k, n - k); i++) r = (r * (n - i + 1)) / i; return Math.round(r); }

export function solveEquation(i: any) {
  switch (i.type) {
    case 'linear': { const a = num(i.a); const b = num(i.b); if (a === 0) throw new Error('a cannot be 0 in ax + b = 0.'); return { equation: `${a}x + ${b} = 0`, x: round(-b / a) }; }
    case 'quadratic': {
      const a = num(i.a); const b = num(i.b); const c = num(i.c); if (a === 0) throw new Error('a cannot be 0 in a quadratic.');
      const d = b * b - 4 * a * c;
      if (d > 0) return { discriminant: round(d), roots: [round((-b + Math.sqrt(d)) / (2 * a)), round((-b - Math.sqrt(d)) / (2 * a))].sort((x, y) => x - y), kind: 'two real roots' };
      if (d === 0) return { discriminant: 0, roots: [round(-b / (2 * a))], kind: 'one repeated root' };
      return { discriminant: round(d), roots: [`${round(-b / (2 * a))} + ${round(Math.sqrt(-d) / (2 * a))}i`, `${round(-b / (2 * a))} - ${round(Math.sqrt(-d) / (2 * a))}i`], kind: 'two complex roots' };
    }
    case 'system': {
      const [a1, b1, c1, a2, b2, c2] = ['a1', 'b1', 'c1', 'a2', 'b2', 'c2'].map((k) => num(i[k]));
      const det = a1 * b2 - a2 * b1; if (det === 0) throw new Error('No single solution: the lines are parallel or the same.');
      return { x: round((c1 * b2 - c2 * b1) / det), y: round((a1 * c2 - a2 * c1) / det), note: 'for a1 x + b1 y = c1 and a2 x + b2 y = c2' };
    }
    default: throw new Error('type must be linear, quadratic or system.');
  }
}

export function numberOps(i: any) {
  switch (i.op) {
    case 'gcd': return { gcd: gcd(nInt(i.a, 'a'), nInt(i.b, 'b')) };
    case 'lcm': { const a = nInt(i.a, 'a'); const b = nInt(i.b, 'b'); return { lcm: Math.abs(a * b) / (gcd(a, b) || 1) }; }
    case 'factorial': { const n = nInt(i.n, 'n'); if (n < 0 || n > 170) throw new Error('n must be 0 to 170.'); let f = 1; for (let k = 2; k <= n; k++) f *= k; return { factorial: f }; }
    case 'choose': return { combinations: choose(nInt(i.n, 'n'), nInt(i.k, 'k')) };
    case 'permute': { const n = nInt(i.n, 'n'); const k = nInt(i.k, 'k'); if (k < 0 || k > n) return { permutations: 0 }; let p = 1; for (let t = 0; t < k; t++) p *= n - t; return { permutations: p }; }
    case 'prime_factors': { let n = nInt(i.n, 'n'); if (n < 2) throw new Error('n must be 2 or more.'); const out: number[] = []; for (let f = 2; f * f <= n; f++) while (n % f === 0) { out.push(f); n /= f; } if (n > 1) out.push(n); return { factors: out }; }
    case 'is_prime': { const n = nInt(i.n, 'n'); if (n < 2) return { prime: false }; for (let f = 2; f * f <= n; f++) if (n % f === 0) return { prime: false, smallestFactor: f }; return { prime: true }; }
    default: throw new Error('op must be gcd, lcm, factorial, choose, permute, prime_factors or is_prime.');
  }
}

export function percentOps(i: any) {
  switch (i.op) {
    case 'change': { const from = num(i.from); const to = num(i.to); if (from === 0) throw new Error('The starting value cannot be 0.'); return { percentChange: round(((to - from) / Math.abs(from)) * 100, 4) }; }
    case 'of': return { result: round((num(i.percent) / 100) * num(i.value), 6) };
    case 'what_percent': { const whole = num(i.whole); if (whole === 0) throw new Error('The whole cannot be 0.'); return { percent: round((num(i.part) / whole) * 100, 4) }; }
    default: throw new Error('op must be change, of or what_percent.');
  }
}

export function geometry(i: any) {
  const d = (k: string) => { const v = num(i[k]); if (v < 0) throw new Error(`${k} cannot be negative.`); return v; };
  switch (i.shape) {
    case 'circle': { const r = d('r'); return { area: round(Math.PI * r * r), circumference: round(2 * Math.PI * r) }; }
    case 'rectangle': { const w = d('w'); const h = d('h'); return { area: round(w * h), perimeter: round(2 * (w + h)), diagonal: round(Math.hypot(w, h)) }; }
    case 'triangle': {
      if (i.base !== undefined) return { area: round(0.5 * d('base') * d('height')) };
      const a = d('a'); const b = d('b'); const c = d('c'); if (a + b <= c || a + c <= b || b + c <= a) throw new Error('Those sides cannot make a triangle.');
      const p = (a + b + c) / 2; return { area: round(Math.sqrt(p * (p - a) * (p - b) * (p - c))), perimeter: round(a + b + c), note: "Heron's formula" };
    }
    case 'right_triangle': { const a = d('a'); const b = d('b'); return { hypotenuse: round(Math.hypot(a, b)), area: round(0.5 * a * b) }; }
    case 'sphere': { const r = d('r'); return { volume: round((4 / 3) * Math.PI * r ** 3), surfaceArea: round(4 * Math.PI * r * r) }; }
    case 'cylinder': { const r = d('r'); const h = d('h'); return { volume: round(Math.PI * r * r * h), surfaceArea: round(2 * Math.PI * r * (r + h)) }; }
    case 'cone': { const r = d('r'); const h = d('h'); return { volume: round((Math.PI * r * r * h) / 3), slantHeight: round(Math.hypot(r, h)), surfaceArea: round(Math.PI * r * (r + Math.hypot(r, h))) }; }
    default: throw new Error('shape must be circle, rectangle, triangle, right_triangle, sphere, cylinder or cone.');
  }
}

const frac = (t: unknown): [number, number] => {
  const m = String(t).trim().match(/^(-?\d+)\s*(?:\/\s*(\d+))?$/); if (!m) throw new Error(`Not a fraction: ${String(t)} (write 3/4 or 5).`);
  const d = m[2] ? Number(m[2]) : 1; if (d === 0) throw new Error('The denominator cannot be 0.'); return [Number(m[1]), d];
};
export function fractionOps(i: any) {
  const [an, ad] = frac(i.a); const b = i.b !== undefined ? frac(i.b) : ([0, 1] as [number, number]);
  let n: number; let d: number;
  switch (i.op) {
    case 'add': n = an * b[1] + b[0] * ad; d = ad * b[1]; break;
    case 'subtract': n = an * b[1] - b[0] * ad; d = ad * b[1]; break;
    case 'multiply': n = an * b[0]; d = ad * b[1]; break;
    case 'divide': if (b[0] === 0) throw new Error('Cannot divide by zero.'); n = an * b[1]; d = ad * b[0]; break;
    case 'simplify': n = an; d = ad; break;
    default: throw new Error('op must be add, subtract, multiply, divide or simplify.');
  }
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1; n /= g; d /= g;
  const whole = Math.trunc(n / d); const rem = Math.abs(n) % d;
  return { fraction: d === 1 ? `${n}` : `${n}/${d}`, mixed: d !== 1 && Math.abs(n) > d ? `${whole} ${rem}/${d}` : undefined, decimal: round(n / d, 6) };
}

const JSON_ACTIONS: Record<string, (i: any) => unknown> = { solve: solveEquation, number: numberOps, percent: percentOps, geometry, fraction: fractionOps };
function jsonInput(v: unknown): any {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(String(v ?? '')); } catch { throw new Error('input must be valid JSON, for example {"type":"quadratic","a":1,"b":-3,"c":2}.'); }
}

export type StudyMathArgs = { action?: string; values?: unknown; x?: unknown; y?: unknown; second?: unknown; mu0?: unknown; paired?: unknown; margin?: unknown; confidence?: unknown;
  input?: unknown; value?: unknown; from?: string; to?: string; add_days?: unknown; pv?: unknown; fv?: unknown; pmt?: unknown; rate?: unknown; nper?: unknown };

/** The tutor's one maths tool. Returns plain JSON text; throws a clear error for bad input. */
export function studyMath(a: StudyMathArgs): string {
  const opt = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : num(v));
  switch (a.action) {
    case 'describe': return JSON.stringify(describe(list(a.values)));
    case 't_test': return JSON.stringify(tTest(list(a.values), a.second !== undefined && a.second !== '' ? list(a.second) : undefined, { mu0: opt(a.mu0) ?? 0, paired: a.paired === true || a.paired === 'true' }));
    case 'regression': return JSON.stringify(regression(list(a.x), list(a.y)));
    case 'sample_size': return JSON.stringify({ n: sampleSize(num(a.margin), opt(a.confidence) ?? 0.95) });
    case 'convert': return JSON.stringify({ value: convertUnits(num(a.value), String(a.from), String(a.to)), unit: a.to });
    case 'date': return JSON.stringify(dateMath({ from: a.from, to: a.to, add_days: opt(a.add_days) }));
    case 'solve': case 'number': case 'percent': case 'geometry': case 'fraction': return JSON.stringify(JSON_ACTIONS[a.action as string](jsonInput(a.input)));
    case 'tvm': return JSON.stringify(tvm({ pv: opt(a.pv), fv: opt(a.fv), pmt: opt(a.pmt), rate: opt(a.rate), nper: opt(a.nper) }));
    default: throw new Error('action must be one of: describe, t_test, regression, sample_size, convert, date, tvm, solve, number, percent, geometry, fraction');
  }
}

// ---------------------------------------------------------------- safe expression evaluator
const FUNCS: Record<string, (x: number) => number> = { sqrt: Math.sqrt, abs: Math.abs, ln: Math.log, log: Math.log10, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, round: Math.round, floor: Math.floor, ceil: Math.ceil };
/**
 * Evaluates a plain arithmetic expression: + - * / ^ ( ) %, pi, e and sqrt, abs, ln, log, exp, sin, cos, tan, round, floor, ceil.
 * Nothing else is accepted (no variables, no code), so text written by a model can be checked safely. Throws on anything unreadable.
 */
export function evalExpression(text: string): number {
  const src = text.replace(/[×]/g, '*').replace(/[÷]/g, '/').replace(/−/g, '-').replace(/,(?=\d{3}\b)/g, '').replace(/\s+/g, '').replace(/\$/g, '');
  if (!src || src.length > 200) throw new Error('Not an expression.');
  let i = 0;
  const peek = () => src[i];
  const fail = (): never => { throw new Error(`Cannot read "${text.slice(0, 40)}".`); };
  const primary = (): number => {
    const c = peek();
    if (c === '(') { i++; const v = expr(); if (peek() !== ')') fail(); i++; return v; }
    const n = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
    if (n) { i += n[0].length; return Number(n[0]); }
    const w = src.slice(i).match(/^[a-z]+/i);
    if (w) {
      const name = w[0].toLowerCase(); i += w[0].length;
      if (name === 'pi') return Math.PI;
      if (name === 'e') return Math.E;
      const f = FUNCS[name]; if (!f || peek() !== '(') return fail();
      i++; const v = expr(); if (peek() !== ')') fail(); i++; return f(v);
    }
    return fail();
  };
  const postfix = (): number => { let v = primary(); while (peek() === '%') { i++; v /= 100; } return v; };
  const unary = (): number => { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return postfix(); };
  const power = (): number => { const b = unary(); if (peek() === '^') { i++; return b ** power(); } return b; };
  const term = (): number => { let v = power(); while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = power(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = (): number => { let v = term(); while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  const value = expr();
  if (i !== src.length) fail();
  if (!Number.isFinite(value)) throw new Error('The result is not a finite number.');
  return value;
}
