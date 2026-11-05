/**
 * Accounting drills made entirely in code: the numbers are generated, the answer key is computed, and statements balance by
 * construction, so no model and no documents are needed and the key can never be wrong. Same seed, same drill.
 */
import type { Exercise, TableRow } from './exercises';

export type DrillKind = 'balance-sheet' | 'journal-entry' | 'net-income' | 'depreciation' | 'current-ratio';
export const DRILL_KINDS: DrillKind[] = ['balance-sheet', 'journal-entry', 'net-income', 'depreciation', 'current-ratio'];

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

const MAKERS: Record<DrillKind, (r: () => number, id: string) => Exercise> = {
  'balance-sheet': balanceSheet, 'journal-entry': journalEntry, 'net-income': netIncome, depreciation, 'current-ratio': currentRatio,
};

export function makeDrill(kind: DrillKind, seed: number): Exercise {
  return MAKERS[kind](rng(seed * 7919 + DRILL_KINDS.indexOf(kind) * 104729 + 1), `drill-${kind}-${seed}`);
}

/** A mixed set of drills, different each call. */
export function makeDrillSet(count = 6, start = Date.now() % 100000): Exercise[] {
  return Array.from({ length: count }, (_, i) => makeDrill(DRILL_KINDS[i % DRILL_KINDS.length], start + i));
}
