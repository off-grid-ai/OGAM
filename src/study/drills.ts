/**
 * Accounting drills made entirely in code: the numbers are generated, the answer key is computed, and statements balance by
 * construction, so no model and no documents are needed and the key can never be wrong. Same seed, same drill.
 */
import type { Exercise, TableRow } from './exercises';
import { convertUnits, describe as describeNumbers, regression, sampleSize, tvm } from './mathTools';
import { molarMass } from './science';

export type DrillKind =
  | 'balance-sheet' | 'journal-entry' | 'net-income' | 'depreciation' | 'current-ratio'
  | 'compound-solve' | 'loan-payment' | 'effective-rate' | 'inventory-cost' | 'double-declining' | 'ratio' | 'break-even' | 'npv'
  | 'income-statement' | 'cash-flow' | 'trial-balance'
  | 'bond-price' | 'lease-liability' | 'bond-interest'
  | 'std-dev' | 'confidence-interval' | 't-statistic' | 'sample-size' | 'regression-slope'
  | 'linear-equation' | 'quadratic-roots' | 'system-equations' | 'fraction-sum' | 'percent-change' | 'percent-of' | 'circle-area' | 'rectangle-area' | 'pythagoras'
  | 'gcd-lcm' | 'line-slope' | 'mean-of-list' | 'unit-conversion' | 'combinations'
  | 'speed' | 'force' | 'kinetic-energy' | 'ohms-law' | 'density' | 'ideal-gas' | 'molar-mass' | 'moles-from-grams' | 'ph-of-acid';
export const DRILL_KINDS: DrillKind[] = [
  'balance-sheet', 'journal-entry', 'net-income', 'depreciation', 'current-ratio',
  'compound-solve', 'loan-payment', 'effective-rate', 'inventory-cost', 'double-declining', 'ratio', 'break-even', 'npv',
  'income-statement', 'cash-flow', 'trial-balance', 'bond-price', 'lease-liability', 'bond-interest',
  'std-dev', 'confidence-interval', 't-statistic', 'sample-size', 'regression-slope',
  'linear-equation', 'quadratic-roots', 'system-equations', 'fraction-sum', 'percent-change', 'percent-of', 'circle-area', 'rectangle-area', 'pythagoras',
  'gcd-lcm', 'line-slope', 'mean-of-list', 'unit-conversion', 'combinations',
  'speed', 'force', 'kinetic-energy', 'ohms-law', 'density', 'ideal-gas', 'molar-mass', 'moles-from-grams', 'ph-of-acid',
];
/** Drills for the doctoral research courses, and for the accounting courses. */
export const STATS_DRILLS: DrillKind[] = ['std-dev', 'confidence-interval', 't-statistic', 'sample-size', 'regression-slope'];
export const MATH_DRILLS: DrillKind[] = ['linear-equation', 'quadratic-roots', 'system-equations', 'fraction-sum', 'percent-change', 'percent-of', 'circle-area', 'rectangle-area', 'pythagoras', 'gcd-lcm', 'line-slope', 'mean-of-list', 'unit-conversion', 'combinations'];
export const SCIENCE_DRILLS: DrillKind[] = ['speed', 'force', 'kinetic-energy', 'ohms-law', 'density', 'ideal-gas', 'molar-mass', 'moles-from-grams', 'ph-of-acid'];
export const ACCOUNTING_DRILLS: DrillKind[] = DRILL_KINDS.filter((k) => !STATS_DRILLS.includes(k) && !MATH_DRILLS.includes(k) && !SCIENCE_DRILLS.includes(k));

/** Small deterministic generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const money = (r: () => number, range: { lo: number; hi: number; step?: number }) => { const { lo, hi, step = 100 } = range; return Math.round((lo + r() * (hi - lo)) / step) * step; };
const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
const TOPIC = 'Accounting drills';
const ACCOUNTS = ['Cash', 'Accounts receivable', 'Inventory', 'Equipment', 'Accounts payable', 'Notes payable', 'Common stock', 'Retained earnings'];
const withOptions = (rows: TableRow[]): TableRow[] => rows.map((row) => ({ ...row, options: ACCOUNTS }));

function balanceSheet(r: () => number, id: string): Exercise {
  const cash = money(r, { lo: 5000, hi: 40000 });
  const ar = money(r, { lo: 3000, hi: 25000 });
  const inv = money(r, { lo: 4000, hi: 30000 });
  const eq = money(r, { lo: 20000, hi: 90000 });
  const ap = money(r, { lo: 3000, hi: 20000 });
  const np = money(r, { lo: 5000, hi: 40000 });
  const stock = money(r, { lo: 10000, hi: 50000 });
  const assets = cash + ar + inv + eq;
  const retained = assets - ap - np - stock; // balances by construction
  const rows = withOptions([
    { label: `The company holds ${fmt(cash)} in its bank account.`, account: 'Cash', amount: cash, group: 'assets' },
    { label: `Customers owe the company ${fmt(ar)} for past sales.`, account: 'Accounts receivable', amount: ar, group: 'assets' },
    { label: `Goods waiting to be sold cost ${fmt(inv)}.`, account: 'Inventory', amount: inv, group: 'assets' },
    { label: `Machinery and fixtures are carried at ${fmt(eq)}.`, account: 'Equipment', amount: eq, group: 'assets' },
    { label: `The company owes suppliers ${fmt(ap)}.`, account: 'Accounts payable', amount: ap, group: 'liab' },
    { label: `A bank loan of ${fmt(np)} is outstanding.`, account: 'Notes payable', amount: np, group: 'liab' },
    { label: `Owners paid in ${fmt(stock)} for shares.`, account: 'Common stock', amount: stock, group: 'equity' },
    { label: `Retained earnings: whatever makes the balance sheet balance (total assets are ${fmt(assets)}).`, account: 'Retained earnings', amount: retained, group: 'equity' },
  ]);
  return {
    id, kind: 'table', topic: TOPIC, prompt: 'Build the balance sheet: choose the account for each item and enter its amount.', rows,
    totals: [{ name: 'Assets = liabilities + equity', groups: ['assets'], equals: ['liab', 'equity'] }],
    explain: `Assets ${fmt(assets)} = liabilities ${fmt(ap + np)} + equity ${fmt(stock + retained)}.`,
  };
}

function journalEntry(r: () => number, id: string): Exercise {
  const price = money(r, { lo: 4000, hi: 30000, step: 500 });
  const cashPaid = money(r, { lo: 1000, hi: price - 1000, step: 500 });
  const onAccount = price - cashPaid;
  const rows = withOptions([
    { label: 'Debit line', account: 'Equipment', amount: price, group: 'debit' },
    { label: 'Credit line 1', account: 'Cash', amount: cashPaid, group: 'credit' },
    { label: 'Credit line 2', account: 'Accounts payable', amount: onAccount, group: 'credit' },
  ]);
  return {
    id, kind: 'table', topic: TOPIC,
    prompt: `Record the entry: the company bought equipment for ${fmt(price)}, paying ${fmt(cashPaid)} in cash and the rest on account.`, rows,
    totals: [{ name: 'Debits = credits', groups: ['debit'], equals: ['credit'] }],
    explain: `Equipment up ${fmt(price)} (debit); cash down ${fmt(cashPaid)} and a payable of ${fmt(onAccount)} (credits).`,
  };
}

function netIncome(r: () => number, id: string): Exercise {
  const sales = money(r, { lo: 40000, hi: 150000 });
  const cogs = Math.round((sales * (0.4 + r() * 0.25)) / 100) * 100;
  const rent = money(r, { lo: 3000, hi: 15000 });
  const dep = money(r, { lo: 1000, hi: 8000 });
  const ni = sales - cogs - rent - dep;
  return {
    id, kind: 'calc', topic: TOPIC, answer: ni, unit: '$',
    prompt: `Sales were ${fmt(sales)}, cost of goods sold ${fmt(cogs)}, rent expense ${fmt(rent)} and depreciation expense ${fmt(dep)}. What is net income?`,
    explain: `${fmt(sales)} - ${fmt(cogs)} = gross profit ${fmt(sales - cogs)}; minus ${fmt(rent)} and ${fmt(dep)} = ${fmt(ni)}.`,
  };
}

function depreciation(r: () => number, id: string): Exercise {
  const cost = money(r, { lo: 20000, hi: 120000, step: 1000 });
  const salvage = money(r, { lo: 0, hi: cost * 0.2, step: 500 });
  const life = 3 + Math.floor(r() * 8);
  const yearly = Math.round(((cost - salvage) / life) * 100) / 100;
  return {
    id, kind: 'calc', topic: TOPIC, answer: yearly, tolerance: 0.5, unit: '$',
    prompt: `An asset costs ${fmt(cost)}, has a salvage value of ${fmt(salvage)} and a ${life}-year life. What is the annual straight-line depreciation?`,
    explain: `(${fmt(cost)} - ${fmt(salvage)}) / ${life} = ${fmt(yearly)} a year.`,
  };
}

function currentRatio(r: () => number, id: string): Exercise {
  const ca = money(r, { lo: 20000, hi: 90000 });
  const cl = money(r, { lo: 10000, hi: 60000 });
  const ratio = Math.round((ca / cl) * 100) / 100;
  return {
    id, kind: 'calc', topic: TOPIC, answer: ratio, tolerance: 0.01,
    prompt: `Current assets are ${fmt(ca)} and current liabilities are ${fmt(cl)}. What is the current ratio (2 decimals)?`,
    explain: `${fmt(ca)} / ${fmt(cl)} = ${ratio}.`,
  };
}

const calc = (id: string, topic: string, q: { prompt: string; answer: number; explain: string; tolerance?: number; unit?: string }): Exercise =>
  ({ id, kind: 'calc', topic, prompt: q.prompt, answer: q.answer, tolerance: q.tolerance ?? 0.01, explain: q.explain, ...(q.unit ? { unit: q.unit } : {}) });
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (x: number) => `${r2(x * 100)}%`;
const FIN = 'Compound interest and loans';

/** Compound interest: the missing one of future value, present value, rate or number of years is asked for. */
function compoundSolve(r: () => number, id: string): Exercise {
  const pv = money(r, { lo: 1000, hi: 20000, step: 500 });
  const rate = (2 + Math.floor(r() * 10)) / 100;
  const years = 2 + Math.floor(r() * 9);
  const fv = r2(pv * (1 + rate) ** years);
  const ask = Math.floor(r() * 4);
  if (ask === 0) return calc(id, FIN, { prompt: `${fmt(pv)} is invested at ${pct(rate)} compounded annually for ${years} years. What is it worth at the end?`, answer: fv, explain: `${fmt(pv)} x (1 + ${rate})^${years} = ${fmt(fv)}.`, tolerance: 0.01, unit: '$' });
  if (ask === 1) return calc(id, FIN, { prompt: `How much must be invested today at ${pct(rate)} compounded annually to have ${fmt(fv)} in ${years} years?`, answer: pv, explain: `${fmt(fv)} / (1 + ${rate})^${years} = ${fmt(pv)}.`, tolerance: 1, unit: '$' });
  if (ask === 2) return calc(id, FIN, { prompt: `${fmt(pv)} grows to ${fmt(fv)} in ${years} years, compounded annually. What is the annual rate, in percent?`, answer: rate * 100, explain: `(${fmt(fv)} / ${fmt(pv)})^(1/${years}) - 1 = ${pct(rate)}.`, tolerance: 0.05, unit: '%' });
  return calc(id, FIN, { prompt: `${fmt(pv)} grows to ${fmt(fv)} at ${pct(rate)} compounded annually. How many years does that take?`, answer: years, explain: `ln(${fmt(fv)} / ${fmt(pv)}) / ln(1 + ${rate}) = ${years} years.`, tolerance: 0.05, unit: 'years' });
}

function loanPayment(r: () => number, id: string): Exercise {
  const principal = money(r, { lo: 5000, hi: 60000, step: 500 });
  const annual = (3 + Math.floor(r() * 8)) / 100;
  const years = 2 + Math.floor(r() * 6);
  const pmt = -(tvm({ pv: principal, fv: 0, rate: annual / 12, nper: years * 12 }).pmt);
  return calc(id, FIN, { prompt: `A ${fmt(principal)} loan at ${pct(annual)} a year, paid monthly over ${years} years. What is the monthly payment?`, answer: r2(pmt), explain: `Payment = P x i / (1 - (1 + i)^-n) with i = ${r2(annual / 12 * 100)}% a month and n = ${years * 12}.`, tolerance: 0.05, unit: '$' });
}

function effectiveRate(r: () => number, id: string): Exercise {
  const nominal = (4 + Math.floor(r() * 9)) / 100;
  const m = [2, 4, 12][Math.floor(r() * 3)];
  const ear = ((1 + nominal / m) ** m - 1) * 100;
  return calc(id, FIN, { prompt: `A nominal rate of ${pct(nominal)} is compounded ${m} times a year. What is the effective annual rate, in percent?`, answer: r2(ear), explain: `(1 + ${nominal}/${m})^${m} - 1 = ${r2(ear)}%.`, tolerance: 0.01, unit: '%' });
}

function inventoryCost(r: () => number, id: string): Exercise {
  const lots = [0, 1, 2].map(() => ({ units: money(r, { lo: 50, hi: 200, step: 10 }), cost: 8 + Math.floor(r() * 10) }));
  const sold = Math.floor(lots.reduce((a, l) => a + l.units, 0) * 0.6 / 10) * 10;
  const method = ['FIFO', 'weighted-average'][Math.floor(r() * 2)];
  let cogs: number;
  if (method === 'FIFO') { let left = sold; cogs = 0; for (const l of lots) { const take = Math.min(left, l.units); cogs += take * l.cost; left -= take; } } else {
    const totalUnits = lots.reduce((a, l) => a + l.units, 0); const totalCost = lots.reduce((a, l) => a + l.units * l.cost, 0); cogs = sold * (totalCost / totalUnits);
  }
  const text = lots.map((l, i) => `purchase ${i + 1}: ${l.units} units at ${fmt(l.cost)}`).join('; ');
  return calc(id, 'Inventory', { prompt: `Purchases in order: ${text}. ${sold} units were sold. Using ${method}, what is cost of goods sold?`, answer: r2(cogs), explain: `${method} cost of ${sold} units = ${fmt(r2(cogs))}.`, tolerance: 0.05, unit: '$' });
}

function doubleDeclining(r: () => number, id: string): Exercise {
  const cost = money(r, { lo: 20000, hi: 100000, step: 1000 });
  const life = 4 + Math.floor(r() * 6);
  const year = 1 + Math.floor(r() * 2);
  const rate = 2 / life;
  const bookStart = cost * (1 - rate) ** (year - 1);
  return calc(id, 'Depreciation', { prompt: `An asset costs ${fmt(cost)} with a ${life}-year life (no salvage). Using double-declining balance, what is depreciation in year ${year}?`, answer: r2(bookStart * rate), explain: `Rate ${r2(rate * 100)}% x book value at the start of year ${year} (${fmt(r2(bookStart))}).`, tolerance: 0.5, unit: '$' });
}

function ratioDrill(r: () => number, id: string): Exercise {
  const kinds = ['debt-to-equity', 'return on equity', 'gross margin', 'quick ratio'] as const;
  const k = kinds[Math.floor(r() * kinds.length)];
  const a = money(r, { lo: 20000, hi: 90000 });
  const b = money(r, { lo: 10000, hi: 70000 });
  const c = money(r, { lo: 5000, hi: 30000 });
  if (k === 'debt-to-equity') return calc(id, 'Ratios', { prompt: `Total liabilities are ${fmt(a)} and total equity is ${fmt(b)}. What is the debt-to-equity ratio (2 decimals)?`, answer: r2(a / b), explain: `${fmt(a)} / ${fmt(b)}.` });
  if (k === 'return on equity') return calc(id, 'Ratios', { prompt: `Net income is ${fmt(c)} and average equity is ${fmt(b)}. What is return on equity, in percent (2 decimals)?`, answer: r2((c / b) * 100), explain: `${fmt(c)} / ${fmt(b)} x 100.`, tolerance: 0.01, unit: '%' });
  if (k === 'gross margin') return calc(id, 'Ratios', { prompt: `Sales were ${fmt(a + b)} and cost of goods sold was ${fmt(b)}. What is the gross margin, in percent (2 decimals)?`, answer: r2((a / (a + b)) * 100), explain: `(${fmt(a + b)} - ${fmt(b)}) / ${fmt(a + b)} x 100.`, tolerance: 0.01, unit: '%' });
  return calc(id, 'Ratios', { prompt: `Cash ${fmt(c)}, receivables ${fmt(b)}, inventory ${fmt(a)}, current liabilities ${fmt(a + c)}. What is the quick ratio (2 decimals)?`, answer: r2((c + b) / (a + c)), explain: `(cash + receivables) / current liabilities = ${fmt(c + b)} / ${fmt(a + c)}.` });
}

function breakEven(r: () => number, id: string): Exercise {
  const price = 20 + Math.floor(r() * 40);
  const variable = Math.floor(price * (0.3 + r() * 0.3));
  const fixed = money(r, { lo: 10000, hi: 80000, step: 500 });
  const units = fixed / (price - variable);
  return calc(id, 'Cost-volume-profit', { prompt: `Price is ${fmt(price)} a unit, variable cost ${fmt(variable)} a unit, fixed costs ${fmt(fixed)}. How many units are needed to break even (2 decimals)?`, answer: r2(units), explain: `${fmt(fixed)} / (${fmt(price)} - ${fmt(variable)}).`, tolerance: 0.05, unit: 'units' });
}

function npv(r: () => number, id: string): Exercise {
  const outlay = money(r, { lo: 10000, hi: 40000, step: 500 });
  const flows = [money(r, { lo: 4000, hi: 15000, step: 500 }), money(r, { lo: 4000, hi: 15000, step: 500 }), money(r, { lo: 4000, hi: 15000, step: 500 })];
  const rate = (6 + Math.floor(r() * 8)) / 100;
  const value = flows.reduce((a, f, i) => a + f / (1 + rate) ** (i + 1), 0) - outlay;
  return calc(id, 'Capital budgeting', { prompt: `A project costs ${fmt(outlay)} now and returns ${flows.map(fmt).join(', ')} at the end of years 1, 2 and 3. At a ${pct(rate)} discount rate, what is the NPV?`, answer: r2(value), explain: `Sum of each cash flow / (1 + ${rate})^t, minus ${fmt(outlay)}.`, tolerance: 0.5, unit: '$' });
}

function incomeStatement(r: () => number, id: string): Exercise {
  const sales = money(r, { lo: 50000, hi: 160000 });
  const cogs = Math.round((sales * (0.35 + r() * 0.25)) / 100) * 100;
  const wages = money(r, { lo: 5000, hi: 20000 });
  const rent = money(r, { lo: 2000, hi: 9000 });
  const tax = Math.round(((sales - cogs - wages - rent) * 0.21) / 100) * 100;
  const ni = sales - cogs - wages - rent - tax;
  const rows = withOptions([
    { label: `Revenue from customers: ${fmt(sales)}`, account: 'Sales revenue', amount: sales, group: 'rev' },
    { label: `Cost of the goods sold: ${fmt(cogs)}`, account: 'Cost of goods sold', amount: cogs, group: 'exp' },
    { label: `Staff pay: ${fmt(wages)}`, account: 'Wages expense', amount: wages, group: 'exp' },
    { label: `Premises: ${fmt(rent)}`, account: 'Rent expense', amount: rent, group: 'exp' },
    { label: `Income tax: ${fmt(tax)}`, account: 'Income tax expense', amount: tax, group: 'exp' },
    { label: 'Net income (what is left)', account: 'Net income', amount: ni, group: 'exp' },
  ]).map((row) => ({ ...row, options: ['Sales revenue', 'Cost of goods sold', 'Wages expense', 'Rent expense', 'Income tax expense', 'Net income', 'Cash'] }));
  return { id, kind: 'table', topic: 'Income statement', prompt: 'Complete the income statement: choose the account and enter the amount for each line.', rows, totals: [{ name: 'Revenue = expenses + net income', groups: ['rev'], equals: ['exp'] }], explain: `Net income = ${fmt(sales)} - ${fmt(cogs + wages + rent + tax)} = ${fmt(ni)}.` };
}

function cashFlow(r: () => number, id: string): Exercise {
  const ni = money(r, { lo: 8000, hi: 40000 });
  const dep = money(r, { lo: 1000, hi: 8000 });
  const arChange = money(r, { lo: 500, hi: 5000 });
  const capex = money(r, { lo: 5000, hi: 30000 });
  const loan = money(r, { lo: 5000, hi: 25000 });
  const dividends = money(r, { lo: 1000, hi: 8000 });
  const cfo = ni + dep - arChange;
  const cfi = -capex;
  const cff = loan - dividends;
  const net = cfo + cfi + cff;
  const opts = ['Net income', 'Depreciation', 'Increase in receivables', 'Purchase of equipment', 'Loan proceeds', 'Dividends paid', 'Net change in cash'];
  const rows: TableRow[] = [
    { label: `Start with net income of ${fmt(ni)}`, account: 'Net income', amount: ni, group: 'cfo' },
    { label: `Add back non-cash depreciation of ${fmt(dep)}`, account: 'Depreciation', amount: dep, group: 'cfo' },
    { label: `Receivables rose by ${fmt(arChange)} (a use of cash, enter as negative)`, account: 'Increase in receivables', amount: -arChange, group: 'cfo' },
    { label: `Bought equipment for ${fmt(capex)} (enter as negative)`, account: 'Purchase of equipment', amount: -capex, group: 'cfo' },
    { label: `Borrowed ${fmt(loan)}`, account: 'Loan proceeds', amount: loan, group: 'cfo' },
    { label: `Paid dividends of ${fmt(dividends)} (enter as negative)`, account: 'Dividends paid', amount: -dividends, group: 'cfo' },
    { label: 'Net change in cash', account: 'Net change in cash', amount: net, group: 'net' },
  ].map((row) => ({ ...row, options: opts }));
  return { id, kind: 'table', topic: 'Cash flow statement', prompt: 'Complete the cash flow statement (indirect method): pick each line and enter its amount; outflows are negative. The lines must add up to the net change in cash.', rows, totals: [{ name: 'Lines add up to the net change in cash', groups: ['cfo'], equals: ['net'] }], explain: `Operating ${fmt(cfo)}, investing ${fmt(cfi)}, financing ${fmt(cff)}: net change ${fmt(net)}.` };
}

function trialBalance(r: () => number, id: string): Exercise {
  const cash = money(r, { lo: 5000, hi: 30000 });
  const ar = money(r, { lo: 2000, hi: 15000 });
  const equipment = money(r, { lo: 10000, hi: 50000 });
  const ap = money(r, { lo: 2000, hi: 15000 });
  const sales = money(r, { lo: 20000, hi: 60000 });
  const rent = money(r, { lo: 2000, hi: 9000 });
  const stock = cash + ar + equipment + rent - ap - sales;
  const opts = ['Cash', 'Accounts receivable', 'Equipment', 'Rent expense', 'Accounts payable', 'Sales revenue', 'Common stock'];
  const rows: TableRow[] = [
    { label: `Cash has a debit balance of ${fmt(cash)}`, account: 'Cash', amount: cash, group: 'debit' },
    { label: `Customers owe ${fmt(ar)}`, account: 'Accounts receivable', amount: ar, group: 'debit' },
    { label: `Equipment at cost ${fmt(equipment)}`, account: 'Equipment', amount: equipment, group: 'debit' },
    { label: `Rent expense so far ${fmt(rent)}`, account: 'Rent expense', amount: rent, group: 'debit' },
    { label: `Owed to suppliers ${fmt(ap)}`, account: 'Accounts payable', amount: ap, group: 'credit' },
    { label: `Sales so far ${fmt(sales)}`, account: 'Sales revenue', amount: sales, group: 'credit' },
    { label: 'Common stock: the credit balance that makes the trial balance agree', account: 'Common stock', amount: stock, group: 'credit' },
  ].map((row) => ({ ...row, options: opts }));
  return { id, kind: 'table', topic: 'Trial balance', prompt: 'Complete the trial balance: pick the account and enter its balance. Total debits must equal total credits.', rows, totals: [{ name: 'Debits = credits', groups: ['debit'], equals: ['credit'] }], explain: `Debits ${fmt(cash + ar + equipment + rent)} = credits ${fmt(ap + sales + stock)}.` };
}


const BONDS = 'Bonds and leases';
/** Price of a bond: the present value of its coupons plus its face value at the market rate. */
function bondPrice(r: () => number, id: string): Exercise {
  const face = [1000, 5000, 10000][Math.floor(r() * 3)] * (1 + Math.floor(r() * 5));
  const coupon = (4 + Math.floor(r() * 6)) / 100;
  const market = (3 + Math.floor(r() * 8)) / 100;
  const years = 3 + Math.floor(r() * 8);
  const pay = face * coupon;
  const price = pay * ((1 - (1 + market) ** -years) / market) + face / (1 + market) ** years;
  return calc(id, BONDS, { prompt: `A ${years}-year bond with a face value of ${fmt(face)} pays ${pct(coupon)} interest once a year. The market rate is ${pct(market)}. What should it sell for?`, answer: r2(price), explain: `Coupons of ${fmt(pay)} for ${years} years discounted at ${pct(market)}, plus ${fmt(face)} discounted ${years} years.`, tolerance: 0.5, unit: '$' });
}
/** Lease liability: the present value of the lease payments at the incremental borrowing rate. */
function leaseLiability(r: () => number, id: string): Exercise {
  const payment = money(r, { lo: 2000, hi: 20000, step: 500 });
  const rate = (4 + Math.floor(r() * 7)) / 100;
  const years = 3 + Math.floor(r() * 6);
  const due = r() < 0.5;
  const ordinary = payment * ((1 - (1 + rate) ** -years) / rate);
  const value = due ? ordinary * (1 + rate) : ordinary;
  return calc(id, BONDS, { prompt: `A lease requires ${fmt(payment)} ${due ? 'at the start' : 'at the end'} of each year for ${years} years. The borrowing rate is ${pct(rate)}. What is the initial lease liability?`, answer: r2(value), explain: `Present value of ${years} payments of ${fmt(payment)} at ${pct(rate)}${due ? ', annuity due (multiply the ordinary annuity by 1 + rate)' : ', ordinary annuity'}.`, tolerance: 0.5, unit: '$' });
}
/** First-year interest expense on a bond issued at a discount or premium, by the effective interest method. */
function bondInterest(r: () => number, id: string): Exercise {
  const carrying = money(r, { lo: 90000, hi: 110000, step: 500 });
  const market = (4 + Math.floor(r() * 6)) / 100;
  return calc(id, BONDS, { prompt: `A bond is issued with a carrying amount of ${fmt(carrying)} and a market rate of ${pct(market)}. Using the effective interest method, what is interest expense for the first year?`, answer: r2(carrying * market), explain: `${fmt(carrying)} x ${pct(market)}.`, tolerance: 0.5, unit: '$' });
}

const MATH = 'Maths';
const SCI = 'Science';
const pick = <T,>(r: () => number, xs: T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function linearEquation(r: () => number, id: string): Exercise {
  const x = int(r, -9, 12); const a = pick(r, [2, 3, 4, 5, 6, 7]); const b = int(r, -15, 15);
  return calc(id, MATH, { prompt: `Solve for x: ${a}x ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${a * x + b}`, answer: x, explain: `Subtract ${b} from both sides, then divide by ${a}: x = ${x}.`, tolerance: 0.001 });
}
function quadraticRoots(r: () => number, id: string): Exercise {
  const p = int(r, -6, 8); let q = int(r, -6, 8); if (q === p) q += 1;
  const sum = p + q; const prod = p * q;
  return calc(id, MATH, { prompt: `Find the larger root of x^2 ${sum === 0 ? '' : `${-sum < 0 ? '-' : '+'} ${Math.abs(sum)}x `}${prod < 0 ? '-' : '+'} ${Math.abs(prod)} = 0`, answer: Math.max(p, q), explain: `It factors as (x - ${p})(x - ${q}) = 0, so the roots are ${p} and ${q}.`, tolerance: 0.001 });
}
function systemEquations(r: () => number, id: string): Exercise {
  const x = int(r, -5, 8); const y = int(r, -5, 8); const a1 = int(r, 1, 4); const b1 = int(r, 1, 4); const a2 = int(r, 1, 4); let b2 = -int(r, 1, 4);
  if (a1 * b2 - a2 * b1 === 0) b2 -= 1;
  return calc(id, MATH, { prompt: `Solve the system: ${a1}x + ${b1}y = ${a1 * x + b1 * y} and ${a2}x - ${Math.abs(b2)}y = ${a2 * x + b2 * y}. What is x?`, answer: x, explain: `Eliminate y or substitute; x = ${x}, y = ${y}.`, tolerance: 0.001 });
}
function fractionSum(r: () => number, id: string): Exercise {
  const a = int(r, 1, 5); const b = pick(r, [2, 3, 4, 5, 6, 8]); const c = int(r, 1, 5); const d = pick(r, [2, 3, 4, 5, 6, 8]);
  return calc(id, MATH, { prompt: `What is ${a}/${b} + ${c}/${d}? Give a decimal to 3 places.`, answer: Math.round(((a / b) + (c / d)) * 1000) / 1000, explain: `Common denominator ${b * d}: (${a * d} + ${c * b}) / ${b * d}.`, tolerance: 0.002 });
}
function percentChange(r: () => number, id: string): Exercise {
  const from = int(r, 20, 400); const to = Math.max(1, Math.round(from * (0.5 + r())));
  return calc(id, MATH, { prompt: `A price goes from ${from} to ${to}. What is the percent change (2 decimals; a fall is negative)?`, answer: r2(((to - from) / from) * 100), explain: `(${to} - ${from}) / ${from} x 100.`, tolerance: 0.01, unit: '%' });
}
function percentOf(r: () => number, id: string): Exercise {
  const pc = pick(r, [5, 8, 12, 15, 20, 25, 35, 45, 60, 75]); const v = int(r, 40, 900);
  return calc(id, MATH, { prompt: `What is ${pc}% of ${v}?`, answer: r2((pc / 100) * v), explain: `${pc}/100 x ${v}.`, tolerance: 0.01 });
}
function circleArea(r: () => number, id: string): Exercise {
  const rad = int(r, 2, 15);
  return calc(id, MATH, { prompt: `A circle has radius ${rad}. What is its area? (2 decimals)`, answer: r2(Math.PI * rad * rad), explain: `pi x ${rad}^2.`, tolerance: 0.02 });
}
function rectangleArea(r: () => number, id: string): Exercise {
  const w = int(r, 3, 25); const h = int(r, 3, 25); const asked = pick(r, ['area', 'perimeter']);
  return calc(id, MATH, { prompt: `A rectangle is ${w} by ${h}. What is its ${asked}?`, answer: asked === 'area' ? w * h : 2 * (w + h), explain: asked === 'area' ? `${w} x ${h}.` : `2 x (${w} + ${h}).`, tolerance: 0.001 });
}
function pythagoras(r: () => number, id: string): Exercise {
  const [a, b, c] = pick(r, [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [20, 21, 29]]);
  return calc(id, MATH, { prompt: `A right triangle has legs ${a} and ${b}. How long is the hypotenuse?`, answer: c, explain: `sqrt(${a}^2 + ${b}^2) = ${c}.`, tolerance: 0.001 });
}
const gcdOf = (x: number, y: number): number => (y === 0 ? x : gcdOf(y, x % y));
function gcdLcm(r: () => number, id: string): Exercise {
  const g = int(r, 2, 9); const a = g * int(r, 2, 9); let b = g * int(r, 2, 9); if (a === b) b += g;
  const gg = gcdOf(a, b);
  const asked = pick(r, ['greatest common divisor', 'least common multiple']);
  return calc(id, MATH, { prompt: `What is the ${asked} of ${a} and ${b}?`, answer: asked.startsWith('greatest') ? gg : (a * b) / gg, explain: `Their greatest common divisor is ${gg}; the least common multiple is ${(a * b) / gg}.`, tolerance: 0.001 });
}
function lineSlope(r: () => number, id: string): Exercise {
  const x1 = int(r, -5, 5); const y1 = int(r, -5, 5); const dx = int(r, 1, 6); const m = pick(r, [-3, -2, -1, 1, 2, 3, 4]);
  return calc(id, MATH, { prompt: `What is the slope of the line through (${x1}, ${y1}) and (${x1 + dx}, ${y1 + m * dx})?`, answer: m, explain: `(${y1 + m * dx} - ${y1}) / (${x1 + dx} - ${x1}).`, tolerance: 0.001 });
}
function meanOfList(r: () => number, id: string): Exercise {
  const xs = Array.from({ length: 6 }, () => int(r, 4, 60)); const d = describeNumbers(xs); const asked = pick(r, ['mean', 'median']);
  return calc(id, MATH, { prompt: `What is the ${asked} of ${xs.join(', ')}? (2 decimals)`, answer: asked === 'mean' ? r2(d.mean as number) : r2(d.median as number), explain: `Mean ${d.mean}, median ${d.median}.`, tolerance: 0.02 });
}
function unitConversion(r: () => number, id: string): Exercise {
  const pairs: Array<[string, string, string, string]> = [['km', 'mi', 'kilometres', 'miles'], ['kg', 'lb', 'kilograms', 'pounds'], ['l', 'gal', 'litres', 'US gallons'], ['ft', 'm', 'feet', 'metres'], ['in', 'cm', 'inches', 'centimetres']];
  const [from, to, fromName, toName] = pick(r, pairs); const v = int(r, 5, 200);
  return calc(id, MATH, { prompt: `Convert ${v} ${fromName} to ${toName} (2 decimals).`, answer: r2(convertUnits(v, from, to)), explain: `Multiply by the conversion factor for ${fromName} to ${toName}.`, tolerance: 0.05 });
}
function combinationsDrill(r: () => number, id: string): Exercise {
  const n = int(r, 5, 12); const k = int(r, 2, 4); let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - i + 1)) / i;
  return calc(id, MATH, { prompt: `How many ways can you choose ${k} items from ${n}, order not mattering?`, answer: Math.round(c), explain: `${n}! / (${k}! x ${n - k}!) = ${Math.round(c)}.`, tolerance: 0.001 });
}

function speedDrill(r: () => number, id: string): Exercise {
  const v = int(r, 4, 30); const t = int(r, 5, 90);
  return calc(id, SCI, { prompt: `A cyclist rides at ${v} m/s for ${t} seconds. How far does she go, in metres?`, answer: v * t, explain: `distance = speed x time = ${v} x ${t}.`, tolerance: 0.01, unit: 'm' });
}
function forceDrill(r: () => number, id: string): Exercise {
  const m = int(r, 2, 80); const a = r2(1 + r() * 8);
  return calc(id, SCI, { prompt: `What force is needed to give a ${m} kg object an acceleration of ${a} m/s^2?`, answer: r2(m * a), explain: 'F = m x a.', tolerance: 0.02, unit: 'N' });
}
function kineticEnergy(r: () => number, id: string): Exercise {
  const m = int(r, 2, 60); const v = int(r, 2, 25);
  return calc(id, SCI, { prompt: `What is the kinetic energy of a ${m} kg mass moving at ${v} m/s?`, answer: r2(0.5 * m * v * v), explain: `KE = 1/2 x ${m} x ${v}^2.`, tolerance: 0.05, unit: 'J' });
}
function ohmsLaw(r: () => number, id: string): Exercise {
  const i = int(r, 1, 9); const rr = int(r, 2, 60); const asked = pick(r, ['voltage', 'current']);
  return asked === 'voltage'
    ? calc(id, SCI, { prompt: `A ${rr} ohm resistor carries ${i} A. What is the voltage across it?`, answer: rr * i, explain: 'V = I x R.', tolerance: 0.01, unit: 'V' })
    : calc(id, SCI, { prompt: `${rr * i} V is applied across a ${rr} ohm resistor. What current flows?`, answer: i, explain: 'I = V / R.', tolerance: 0.01, unit: 'A' });
}
function densityDrill(r: () => number, id: string): Exercise {
  const vol = int(r, 5, 80); const dens = r2(0.5 + r() * 12);
  return calc(id, SCI, { prompt: `A sample has volume ${vol} cm^3 and mass ${r2(vol * dens)} g. What is its density?`, answer: dens, explain: 'density = mass / volume.', tolerance: 0.02, unit: 'g/cm^3' });
}
function idealGas(r: () => number, id: string): Exercise {
  const n = r2(0.5 + r() * 3); const t = int(r, 250, 400); const v = r2(5 + r() * 40);
  const p = (n * 8.314462618 * t) / (v / 1000) / 1000;
  return calc(id, SCI, { prompt: `${n} mol of an ideal gas is at ${t} K in ${v} litres. What is its pressure in kPa? (R = 8.314 J/mol/K)`, answer: r2(p), explain: 'P = nRT / V, with V in cubic metres.', tolerance: Math.max(0.5, p * 0.005), unit: 'kPa' });
}
const FORMULAS = ['H2O', 'CO2', 'NaCl', 'CaCO3', 'C6H12O6', 'H2SO4', 'Ca(OH)2', 'NH3', 'Mg(NO3)2', 'Al2O3', 'C2H5OH', 'KMnO4'];
function molarMassDrill(r: () => number, id: string): Exercise {
  const f = pick(r, FORMULAS); const m = molarMass(f);
  return calc(id, SCI, { prompt: `What is the molar mass of ${f}? (g/mol, 1 decimal; use the periodic table)`, answer: r2(m.mass), explain: `Add the atomic masses of each atom: ${Object.entries(m.counts).map(([e, c]) => `${c} x ${e}`).join(', ')}.`, tolerance: 0.15, unit: 'g/mol' });
}
function molesFromGrams(r: () => number, id: string): Exercise {
  const f = pick(r, FORMULAS); const g = int(r, 5, 200); const m = molarMass(f).mass;
  return calc(id, SCI, { prompt: `How many moles are in ${g} g of ${f}? (2 decimals)`, answer: r2(g / m), explain: `moles = mass / molar mass = ${g} / ${m}.`, tolerance: 0.02, unit: 'mol' });
}
function phOfAcid(r: () => number, id: string): Exercise {
  const exp = int(r, 1, 6); const mant = pick(r, [1, 2, 5]); const c = mant * 10 ** -exp;
  return calc(id, SCI, { prompt: `What is the pH of a ${c} mol/L solution of a strong monoprotic acid? (2 decimals)`, answer: r2(-Math.log10(c)), explain: 'pH = -log10[H+].', tolerance: 0.02 });
}

const sample = (r: () => number, spec: { n: number; lo: number; hi: number }) => Array.from({ length: spec.n }, () => Math.round(spec.lo + r() * (spec.hi - spec.lo)));
const RS = 'Research statistics';

function stdDev(r: () => number, id: string): Exercise {
  const x = sample(r, { n: 6, lo: 10, hi: 40 });
  const d = describeNumbers(x);
  return calc(id, RS, { prompt: `Find the sample standard deviation (2 decimals) of: ${x.join(', ')}.`, answer: r2(d.sampleStdev as number), explain: `Mean ${d.mean}; sample variance ${d.sampleVariance}; standard deviation = its square root.`, tolerance: 0.02 });
}

function confidenceInterval(r: () => number, id: string): Exercise {
  const n = 25 + Math.floor(r() * 75);
  const sd = 5 + Math.floor(r() * 15);
  const z = 1.96;
  return calc(id, RS, { prompt: `A sample of ${n} has a standard deviation of ${sd}. Using z = 1.96, what is the margin of error of a 95% confidence interval for the mean (2 decimals)?`, answer: r2((z * sd) / Math.sqrt(n)), explain: `1.96 x ${sd} / sqrt(${n}).`, tolerance: 0.02 });
}

function tStatistic(r: () => number, id: string): Exercise {
  const x = sample(r, { n: 8, lo: 40, hi: 70 });
  const mu = 50 + Math.floor(r() * 10);
  const d = describeNumbers(x);
  const t = ((d.mean as number) - mu) / ((d.sampleStdev as number) / Math.sqrt(x.length));
  return calc(id, RS, { prompt: `Test whether the mean of ${x.join(', ')} differs from ${mu}. What is the one-sample t statistic (2 decimals)?`, answer: r2(t), explain: `(${d.mean} - ${mu}) / (${d.sampleStdev} / sqrt(${x.length})), with ${x.length - 1} degrees of freedom.`, tolerance: 0.02 });
}

function sampleSizeDrill(r: () => number, id: string): Exercise {
  const margin = [0.03, 0.04, 0.05, 0.1][Math.floor(r() * 4)];
  const conf = [0.9, 0.95, 0.99][Math.floor(r() * 3)];
  return calc(id, RS, { prompt: `How many people are needed to estimate a proportion within ${pct(margin)} at ${pct(conf)} confidence, assuming p = 0.5? (round up)`, answer: sampleSize(margin, conf), explain: 'n = z^2 x p(1-p) / margin^2, rounded up.', tolerance: 0.5, unit: 'people' });
}

function regressionSlope(r: () => number, id: string): Exercise {
  const x = [1, 2, 3, 4, 5, 6];
  const slope = 1 + Math.floor(r() * 4);
  const y = x.map((v) => slope * v + Math.round(r() * 4 - 2) + 5);
  const fit = regression(x, y);
  return calc(id, RS, { prompt: `x = ${x.join(', ')} and y = ${y.join(', ')}. What is the slope of the least-squares line (2 decimals)?`, answer: r2(fit.slope), explain: `Slope = sum((x - mean x)(y - mean y)) / sum((x - mean x)^2); intercept ${fit.intercept}, r = ${fit.r}.`, tolerance: 0.02 });
}

const MAKERS: Record<DrillKind, (r: () => number, id: string) => Exercise> = {
  'balance-sheet': balanceSheet, 'journal-entry': journalEntry, 'net-income': netIncome, depreciation, 'current-ratio': currentRatio,
  'compound-solve': compoundSolve, 'loan-payment': loanPayment, 'effective-rate': effectiveRate, 'inventory-cost': inventoryCost, 'double-declining': doubleDeclining,
  'bond-price': bondPrice, 'lease-liability': leaseLiability, 'bond-interest': bondInterest,
  ratio: ratioDrill, 'break-even': breakEven, npv, 'income-statement': incomeStatement, 'cash-flow': cashFlow, 'trial-balance': trialBalance,
  'linear-equation': linearEquation, 'quadratic-roots': quadraticRoots, 'system-equations': systemEquations, 'fraction-sum': fractionSum, 'percent-change': percentChange, 'percent-of': percentOf,
  'circle-area': circleArea, 'rectangle-area': rectangleArea, pythagoras, 'gcd-lcm': gcdLcm, 'line-slope': lineSlope, 'mean-of-list': meanOfList, 'unit-conversion': unitConversion, combinations: combinationsDrill,
  speed: speedDrill, force: forceDrill, 'kinetic-energy': kineticEnergy, 'ohms-law': ohmsLaw, density: densityDrill, 'ideal-gas': idealGas, 'molar-mass': molarMassDrill, 'moles-from-grams': molesFromGrams, 'ph-of-acid': phOfAcid,
  'std-dev': stdDev, 'confidence-interval': confidenceInterval, 't-statistic': tStatistic, 'sample-size': sampleSizeDrill, 'regression-slope': regressionSlope,
};

export function makeDrill(kind: DrillKind, seed: number): Exercise {
  return MAKERS[kind](rng(seed * 7919 + DRILL_KINDS.indexOf(kind) * 104729 + 1), `drill-${kind}-${seed}`);
}

/** A mixed set of drills, different each call. */
export function makeDrillSet(count = 6, start = Date.now() % 100000, kinds: DrillKind[] = DRILL_KINDS): Exercise[] {
  // A shuffled walk through the kinds, so a set of six is not always the same six.
  const order = [...kinds].sort((a, b) => ((Math.sin(start + kinds.indexOf(a)) * 1e4) % 1) - ((Math.sin(start + kinds.indexOf(b)) * 1e4) % 1));
  return Array.from({ length: count }, (_, i) => makeDrill(order[i % order.length], start + i));
}

/** Plain names for the drill picker. */
export const DRILL_LABELS: Record<DrillKind, string> = {
  'balance-sheet': 'Balance sheet', 'journal-entry': 'Journal entry', 'net-income': 'Net income', depreciation: 'Straight-line depreciation', 'current-ratio': 'Current ratio',
  'compound-solve': 'Compound interest', 'loan-payment': 'Loan payment', 'effective-rate': 'Effective rate', 'inventory-cost': 'Inventory (FIFO, average)', 'double-declining': 'Double-declining depreciation',
  ratio: 'Financial ratios', 'break-even': 'Break-even', npv: 'Net present value', 'income-statement': 'Income statement', 'cash-flow': 'Cash flow statement', 'trial-balance': 'Trial balance',
  'bond-price': 'Bond price', 'lease-liability': 'Lease liability', 'bond-interest': 'Bond interest expense',
  'std-dev': 'Standard deviation', 'confidence-interval': 'Margin of error', 't-statistic': 't statistic', 'sample-size': 'Sample size', 'regression-slope': 'Regression slope',
  'linear-equation': 'Linear equations', 'quadratic-roots': 'Quadratic equations', 'system-equations': 'Pairs of equations', 'fraction-sum': 'Adding fractions', 'percent-change': 'Percent change', 'percent-of': 'Percent of a number',
  'circle-area': 'Area of a circle', 'rectangle-area': 'Area and perimeter', pythagoras: 'Pythagoras', 'gcd-lcm': 'Common divisors and multiples', 'line-slope': 'Slope of a line', 'mean-of-list': 'Mean and median',
  'unit-conversion': 'Unit conversion', combinations: 'Combinations',
  speed: 'Speed and distance', force: 'Force and acceleration', 'kinetic-energy': 'Kinetic energy', 'ohms-law': 'Ohm\'s law', density: 'Density', 'ideal-gas': 'Ideal gas law',
  'molar-mass': 'Molar mass', 'moles-from-grams': 'Moles from grams', 'ph-of-acid': 'pH of an acid',
};

const KEYWORDS: Array<[DrillKind, RegExp]> = [
  ['linear-equation', /linear equation|one.step|two.step|solve for x|algebra basics/],
  ['quadratic-roots', /quadratic|factoring|polynomial/],
  ['system-equations', /system of equations|simultaneous|pairs of equations/],
  ['fraction-sum', /fraction/],
  ['percent-change', /percent change|percentage change|increase and decrease/],
  ['percent-of', /percent(age)? of|percentages?/],
  ['circle-area', /circle|circumference/],
  ['rectangle-area', /perimeter|area of|rectangle/],
  ['pythagoras', /pythag|right triangle|hypotenuse/],
  ['gcd-lcm', /greatest common|least common|gcd|lcm|divisib|multiples/],
  ['line-slope', /slope|gradient|linear graph|coordinate/],
  ['mean-of-list', /mean|median|average|data set/],
  ['unit-conversion', /unit conversion|convert|metric|imperial/],
  ['combinations', /combination|permutation|counting|choose/],
  ['speed', /speed|velocity|distance|motion|kinematic/],
  ['force', /force|newton|acceleration/],
  ['kinetic-energy', /kinetic|energy|work and power/],
  ['ohms-law', /ohm|circuit|voltage|current|resistance|electric/],
  ['density', /density/],
  ['ideal-gas', /ideal gas|gas law|pressure/],
  ['molar-mass', /molar mass|molecular (weight|mass)|formula mass/],
  ['moles-from-grams', /mole|stoichiometr/],
  ['ph-of-acid', /\bph\b|acid|base|logarithm/],
  ['balance-sheet', /balance sheet|accounting equation|assets.*liabilities/],
  ['journal-entry', /journal|debit|credit|double.entry/],
  ['net-income', /net income|profit and loss|p&l/],
  ['income-statement', /income statement|statement of (operations|earnings)/],
  ['cash-flow', /cash flow/],
  ['trial-balance', /trial balance|ledger/],
  ['depreciation', /straight.line|depreciation/],
  ['double-declining', /double.declining|declining balance|accelerated/],
  ['compound-solve', /compound|future value|present value|time value|annuit|interest/],
  ['loan-payment', /loan|mortgage|amortiz/],
  ['effective-rate', /effective (annual )?rate|apr|apy|nominal/],
  ['inventory-cost', /inventory|fifo|lifo|weighted.average|cost of goods/],
  ['ratio', /ratio|return on equity|margin|liquidity|leverage|debt.to.equity/],
  ['current-ratio', /current ratio|working capital/],
  ['break-even', /break.even|cost.volume|cvp/],
  ['npv', /\bnpv\b|net present value|capital budget|discount rate/],
  ['bond-price', /bond/],
  ['lease-liability', /lease/],
  ['bond-interest', /bond interest|effective interest/],
  ['std-dev', /standard deviation|variance|dispersion/],
  ['confidence-interval', /confidence interval|margin of error/],
  ['t-statistic', /t.?test|t statistic|hypothesis|significance/],
  ['sample-size', /sample size|sampling/],
  ['regression-slope', /regression|slope|correlation|least.squares/],
];
/** The code-made drill that fits a square's title and focus, or undefined. The longest matching words win ("bond interest" beats "bond"). */
export function drillFor(text: string): DrillKind | undefined {
  const t = text.toLowerCase();
  const hits = KEYWORDS.filter(([, re]) => re.test(t));
  if (hits.length) return hits.sort((a, b) => (t.match(b[1])?.[0].length ?? 0) - (t.match(a[1])?.[0].length ?? 0))[0][0];
  return DRILL_KINDS.find((k) => t.includes(DRILL_LABELS[k].toLowerCase()));
}
