/**
 * Accounting drills made entirely in code: the numbers are generated, the answer key is computed, and statements balance by
 * construction, so no model and no documents are needed and the key can never be wrong. Same seed, same drill.
 */
import type { Exercise, TableRow } from './exercises';
import { describe as describeNumbers, regression, sampleSize, tvm } from './mathTools';

export type DrillKind =
  | 'balance-sheet' | 'journal-entry' | 'net-income' | 'depreciation' | 'current-ratio'
  | 'compound-solve' | 'loan-payment' | 'effective-rate' | 'inventory-cost' | 'double-declining' | 'ratio' | 'break-even' | 'npv'
  | 'income-statement' | 'cash-flow' | 'trial-balance'
  | 'std-dev' | 'confidence-interval' | 't-statistic' | 'sample-size' | 'regression-slope';
export const DRILL_KINDS: DrillKind[] = [
  'balance-sheet', 'journal-entry', 'net-income', 'depreciation', 'current-ratio',
  'compound-solve', 'loan-payment', 'effective-rate', 'inventory-cost', 'double-declining', 'ratio', 'break-even', 'npv',
  'income-statement', 'cash-flow', 'trial-balance',
  'std-dev', 'confidence-interval', 't-statistic', 'sample-size', 'regression-slope',
];
/** Drills for the doctoral research courses, and for the accounting courses. */
export const STATS_DRILLS: DrillKind[] = ['std-dev', 'confidence-interval', 't-statistic', 'sample-size', 'regression-slope'];
export const ACCOUNTING_DRILLS: DrillKind[] = DRILL_KINDS.filter((k) => !STATS_DRILLS.includes(k));

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
const money = (r: () => number, lo: number, hi: number, step = 100) => Math.round((lo + r() * (hi - lo)) / step) * step;
const fmt = (n: number) => `$${n.toLocaleString('en-US')}`;
const TOPIC = 'Accounting drills';
const ACCOUNTS = ['Cash', 'Accounts receivable', 'Inventory', 'Equipment', 'Accounts payable', 'Notes payable', 'Common stock', 'Retained earnings'];
const withOptions = (rows: TableRow[]): TableRow[] => rows.map((row) => ({ ...row, options: ACCOUNTS }));

function balanceSheet(r: () => number, id: string): Exercise {
  const cash = money(r, 5000, 40000);
  const ar = money(r, 3000, 25000);
  const inv = money(r, 4000, 30000);
  const eq = money(r, 20000, 90000);
  const ap = money(r, 3000, 20000);
  const np = money(r, 5000, 40000);
  const stock = money(r, 10000, 50000);
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
  const price = money(r, 4000, 30000, 500);
  const cashPaid = money(r, 1000, price - 1000, 500);
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
  const sales = money(r, 40000, 150000);
  const cogs = Math.round((sales * (0.4 + r() * 0.25)) / 100) * 100;
  const rent = money(r, 3000, 15000);
  const dep = money(r, 1000, 8000);
  const ni = sales - cogs - rent - dep;
  return {
    id, kind: 'calc', topic: TOPIC, answer: ni, unit: '$',
    prompt: `Sales were ${fmt(sales)}, cost of goods sold ${fmt(cogs)}, rent expense ${fmt(rent)} and depreciation expense ${fmt(dep)}. What is net income?`,
    explain: `${fmt(sales)} - ${fmt(cogs)} = gross profit ${fmt(sales - cogs)}; minus ${fmt(rent)} and ${fmt(dep)} = ${fmt(ni)}.`,
  };
}

function depreciation(r: () => number, id: string): Exercise {
  const cost = money(r, 20000, 120000, 1000);
  const salvage = money(r, 0, cost * 0.2, 500);
  const life = 3 + Math.floor(r() * 8);
  const yearly = Math.round(((cost - salvage) / life) * 100) / 100;
  return {
    id, kind: 'calc', topic: TOPIC, answer: yearly, tolerance: 0.5, unit: '$',
    prompt: `An asset costs ${fmt(cost)}, has a salvage value of ${fmt(salvage)} and a ${life}-year life. What is the annual straight-line depreciation?`,
    explain: `(${fmt(cost)} - ${fmt(salvage)}) / ${life} = ${fmt(yearly)} a year.`,
  };
}

function currentRatio(r: () => number, id: string): Exercise {
  const ca = money(r, 20000, 90000);
  const cl = money(r, 10000, 60000);
  const ratio = Math.round((ca / cl) * 100) / 100;
  return {
    id, kind: 'calc', topic: TOPIC, answer: ratio, tolerance: 0.01,
    prompt: `Current assets are ${fmt(ca)} and current liabilities are ${fmt(cl)}. What is the current ratio (2 decimals)?`,
    explain: `${fmt(ca)} / ${fmt(cl)} = ${ratio}.`,
  };
}

const calc = (id: string, topic: string, prompt: string, answer: number, explain: string, tolerance = 0.01, unit?: string): Exercise =>
  ({ id, kind: 'calc', topic, prompt, answer, tolerance, explain, ...(unit ? { unit } : {}) });
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (x: number) => `${r2(x * 100)}%`;
const FIN = 'Compound interest and loans';

/** Compound interest: the missing one of future value, present value, rate or number of years is asked for. */
function compoundSolve(r: () => number, id: string): Exercise {
  const pv = money(r, 1000, 20000, 500);
  const rate = (2 + Math.floor(r() * 10)) / 100;
  const years = 2 + Math.floor(r() * 9);
  const fv = r2(pv * (1 + rate) ** years);
  const ask = Math.floor(r() * 4);
  if (ask === 0) return calc(id, FIN, `${fmt(pv)} is invested at ${pct(rate)} compounded annually for ${years} years. What is it worth at the end?`, fv, `${fmt(pv)} x (1 + ${rate})^${years} = ${fmt(fv)}.`, 0.01, '$');
  if (ask === 1) return calc(id, FIN, `How much must be invested today at ${pct(rate)} compounded annually to have ${fmt(fv)} in ${years} years?`, pv, `${fmt(fv)} / (1 + ${rate})^${years} = ${fmt(pv)}.`, 1, '$');
  if (ask === 2) return calc(id, FIN, `${fmt(pv)} grows to ${fmt(fv)} in ${years} years, compounded annually. What is the annual rate, in percent?`, rate * 100, `(${fmt(fv)} / ${fmt(pv)})^(1/${years}) - 1 = ${pct(rate)}.`, 0.05, '%');
  return calc(id, FIN, `${fmt(pv)} grows to ${fmt(fv)} at ${pct(rate)} compounded annually. How many years does that take?`, years, `ln(${fmt(fv)} / ${fmt(pv)}) / ln(1 + ${rate}) = ${years} years.`, 0.05, 'years');
}

function loanPayment(r: () => number, id: string): Exercise {
  const principal = money(r, 5000, 60000, 500);
  const annual = (3 + Math.floor(r() * 8)) / 100;
  const years = 2 + Math.floor(r() * 6);
  const pmt = -(tvm({ pv: principal, fv: 0, rate: annual / 12, nper: years * 12 }).pmt);
  return calc(id, FIN, `A ${fmt(principal)} loan at ${pct(annual)} a year, paid monthly over ${years} years. What is the monthly payment?`, r2(pmt), `Payment = P x i / (1 - (1 + i)^-n) with i = ${r2(annual / 12 * 100)}% a month and n = ${years * 12}.`, 0.05, '$');
}

function effectiveRate(r: () => number, id: string): Exercise {
  const nominal = (4 + Math.floor(r() * 9)) / 100;
  const m = [2, 4, 12][Math.floor(r() * 3)];
  const ear = ((1 + nominal / m) ** m - 1) * 100;
  return calc(id, FIN, `A nominal rate of ${pct(nominal)} is compounded ${m} times a year. What is the effective annual rate, in percent?`, r2(ear), `(1 + ${nominal}/${m})^${m} - 1 = ${r2(ear)}%.`, 0.01, '%');
}

function inventoryCost(r: () => number, id: string): Exercise {
  const lots = [0, 1, 2].map(() => ({ units: money(r, 50, 200, 10), cost: 8 + Math.floor(r() * 10) }));
  const sold = Math.floor(lots.reduce((a, l) => a + l.units, 0) * 0.6 / 10) * 10;
  const method = ['FIFO', 'weighted-average'][Math.floor(r() * 2)];
  let cogs: number;
  if (method === 'FIFO') { let left = sold; cogs = 0; for (const l of lots) { const take = Math.min(left, l.units); cogs += take * l.cost; left -= take; } } else {
    const totalUnits = lots.reduce((a, l) => a + l.units, 0); const totalCost = lots.reduce((a, l) => a + l.units * l.cost, 0); cogs = sold * (totalCost / totalUnits);
  }
  const text = lots.map((l, i) => `purchase ${i + 1}: ${l.units} units at ${fmt(l.cost)}`).join('; ');
  return calc(id, 'Inventory', `Purchases in order: ${text}. ${sold} units were sold. Using ${method}, what is cost of goods sold?`, r2(cogs), `${method} cost of ${sold} units = ${fmt(r2(cogs))}.`, 0.05, '$');
}

function doubleDeclining(r: () => number, id: string): Exercise {
  const cost = money(r, 20000, 100000, 1000);
  const life = 4 + Math.floor(r() * 6);
  const year = 1 + Math.floor(r() * 2);
  const rate = 2 / life;
  const bookStart = cost * (1 - rate) ** (year - 1);
  return calc(id, 'Depreciation', `An asset costs ${fmt(cost)} with a ${life}-year life (no salvage). Using double-declining balance, what is depreciation in year ${year}?`, r2(bookStart * rate), `Rate ${r2(rate * 100)}% x book value at the start of year ${year} (${fmt(r2(bookStart))}).`, 0.5, '$');
}

function ratioDrill(r: () => number, id: string): Exercise {
  const kinds = ['debt-to-equity', 'return on equity', 'gross margin', 'quick ratio'] as const;
  const k = kinds[Math.floor(r() * kinds.length)];
  const a = money(r, 20000, 90000);
  const b = money(r, 10000, 70000);
  const c = money(r, 5000, 30000);
  if (k === 'debt-to-equity') return calc(id, 'Ratios', `Total liabilities are ${fmt(a)} and total equity is ${fmt(b)}. What is the debt-to-equity ratio (2 decimals)?`, r2(a / b), `${fmt(a)} / ${fmt(b)}.`);
  if (k === 'return on equity') return calc(id, 'Ratios', `Net income is ${fmt(c)} and average equity is ${fmt(b)}. What is return on equity, in percent (2 decimals)?`, r2((c / b) * 100), `${fmt(c)} / ${fmt(b)} x 100.`, 0.01, '%');
  if (k === 'gross margin') return calc(id, 'Ratios', `Sales were ${fmt(a + b)} and cost of goods sold was ${fmt(b)}. What is the gross margin, in percent (2 decimals)?`, r2((a / (a + b)) * 100), `(${fmt(a + b)} - ${fmt(b)}) / ${fmt(a + b)} x 100.`, 0.01, '%');
  return calc(id, 'Ratios', `Cash ${fmt(c)}, receivables ${fmt(b)}, inventory ${fmt(a)}, current liabilities ${fmt(a + c)}. What is the quick ratio (2 decimals)?`, r2((c + b) / (a + c)), `(cash + receivables) / current liabilities = ${fmt(c + b)} / ${fmt(a + c)}.`);
}

function breakEven(r: () => number, id: string): Exercise {
  const price = 20 + Math.floor(r() * 40);
  const variable = Math.floor(price * (0.3 + r() * 0.3));
  const fixed = money(r, 10000, 80000, 500);
  const units = fixed / (price - variable);
  return calc(id, 'Cost-volume-profit', `Price is ${fmt(price)} a unit, variable cost ${fmt(variable)} a unit, fixed costs ${fmt(fixed)}. How many units are needed to break even (2 decimals)?`, r2(units), `${fmt(fixed)} / (${fmt(price)} - ${fmt(variable)}).`, 0.05, 'units');
}

function npv(r: () => number, id: string): Exercise {
  const outlay = money(r, 10000, 40000, 500);
  const flows = [money(r, 4000, 15000, 500), money(r, 4000, 15000, 500), money(r, 4000, 15000, 500)];
  const rate = (6 + Math.floor(r() * 8)) / 100;
  const value = flows.reduce((a, f, i) => a + f / (1 + rate) ** (i + 1), 0) - outlay;
  return calc(id, 'Capital budgeting', `A project costs ${fmt(outlay)} now and returns ${flows.map(fmt).join(', ')} at the end of years 1, 2 and 3. At a ${pct(rate)} discount rate, what is the NPV?`, r2(value), `Sum of each cash flow / (1 + ${rate})^t, minus ${fmt(outlay)}.`, 0.5, '$');
}

function incomeStatement(r: () => number, id: string): Exercise {
  const sales = money(r, 50000, 160000);
  const cogs = Math.round((sales * (0.35 + r() * 0.25)) / 100) * 100;
  const wages = money(r, 5000, 20000);
  const rent = money(r, 2000, 9000);
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
  const ni = money(r, 8000, 40000);
  const dep = money(r, 1000, 8000);
  const arChange = money(r, 500, 5000);
  const capex = money(r, 5000, 30000);
  const loan = money(r, 5000, 25000);
  const dividends = money(r, 1000, 8000);
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
  const cash = money(r, 5000, 30000);
  const ar = money(r, 2000, 15000);
  const equipment = money(r, 10000, 50000);
  const ap = money(r, 2000, 15000);
  const sales = money(r, 20000, 60000);
  const rent = money(r, 2000, 9000);
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

const sample = (r: () => number, n: number, lo: number, hi: number) => Array.from({ length: n }, () => Math.round(lo + r() * (hi - lo)));
const RS = 'Research statistics';

function stdDev(r: () => number, id: string): Exercise {
  const x = sample(r, 6, 10, 40);
  const d = describeNumbers(x);
  return calc(id, RS, `Find the sample standard deviation (2 decimals) of: ${x.join(', ')}.`, r2(d.sampleStdev as number), `Mean ${d.mean}; sample variance ${d.sampleVariance}; standard deviation = its square root.`, 0.02);
}

function confidenceInterval(r: () => number, id: string): Exercise {
  const n = 25 + Math.floor(r() * 75);
  const sd = 5 + Math.floor(r() * 15);
  const z = 1.96;
  return calc(id, RS, `A sample of ${n} has a standard deviation of ${sd}. Using z = 1.96, what is the margin of error of a 95% confidence interval for the mean (2 decimals)?`, r2((z * sd) / Math.sqrt(n)), `1.96 x ${sd} / sqrt(${n}).`, 0.02);
}

function tStatistic(r: () => number, id: string): Exercise {
  const x = sample(r, 8, 40, 70);
  const mu = 50 + Math.floor(r() * 10);
  const d = describeNumbers(x);
  const t = ((d.mean as number) - mu) / ((d.sampleStdev as number) / Math.sqrt(x.length));
  return calc(id, RS, `Test whether the mean of ${x.join(', ')} differs from ${mu}. What is the one-sample t statistic (2 decimals)?`, r2(t), `(${d.mean} - ${mu}) / (${d.sampleStdev} / sqrt(${x.length})), with ${x.length - 1} degrees of freedom.`, 0.02);
}

function sampleSizeDrill(r: () => number, id: string): Exercise {
  const margin = [0.03, 0.04, 0.05, 0.1][Math.floor(r() * 4)];
  const conf = [0.9, 0.95, 0.99][Math.floor(r() * 3)];
  return calc(id, RS, `How many people are needed to estimate a proportion within ${pct(margin)} at ${pct(conf)} confidence, assuming p = 0.5? (round up)`, sampleSize(margin, conf), 'n = z^2 x p(1-p) / margin^2, rounded up.', 0.5, 'people');
}

function regressionSlope(r: () => number, id: string): Exercise {
  const x = [1, 2, 3, 4, 5, 6];
  const slope = 1 + Math.floor(r() * 4);
  const y = x.map((v) => slope * v + Math.round(r() * 4 - 2) + 5);
  const fit = regression(x, y);
  return calc(id, RS, `x = ${x.join(', ')} and y = ${y.join(', ')}. What is the slope of the least-squares line (2 decimals)?`, r2(fit.slope), `Slope = sum((x - mean x)(y - mean y)) / sum((x - mean x)^2); intercept ${fit.intercept}, r = ${fit.r}.`, 0.02);
}

const MAKERS: Record<DrillKind, (r: () => number, id: string) => Exercise> = {
  'balance-sheet': balanceSheet, 'journal-entry': journalEntry, 'net-income': netIncome, depreciation, 'current-ratio': currentRatio,
  'compound-solve': compoundSolve, 'loan-payment': loanPayment, 'effective-rate': effectiveRate, 'inventory-cost': inventoryCost, 'double-declining': doubleDeclining,
  ratio: ratioDrill, 'break-even': breakEven, npv, 'income-statement': incomeStatement, 'cash-flow': cashFlow, 'trial-balance': trialBalance,
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
