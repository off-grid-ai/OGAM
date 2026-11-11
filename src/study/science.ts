/**
 * Science facts the tutor looks up instead of recalling: the periodic table, molar masses, pH and common constants.
 * Atomic masses are standard atomic weights (3 decimals or fewer); for elements with no stable isotope the number is the mass
 * number of the longest-lived isotope.
 */
const RAW = `H Hydrogen 1.008|He Helium 4.0026|Li Lithium 6.94|Be Beryllium 9.0122|B Boron 10.81|C Carbon 12.011|N Nitrogen 14.007|O Oxygen 15.999|F Fluorine 18.998|Ne Neon 20.180|
Na Sodium 22.990|Mg Magnesium 24.305|Al Aluminium 26.982|Si Silicon 28.085|P Phosphorus 30.974|S Sulfur 32.06|Cl Chlorine 35.45|Ar Argon 39.948|K Potassium 39.098|Ca Calcium 40.078|
Sc Scandium 44.956|Ti Titanium 47.867|V Vanadium 50.942|Cr Chromium 51.996|Mn Manganese 54.938|Fe Iron 55.845|Co Cobalt 58.933|Ni Nickel 58.693|Cu Copper 63.546|Zn Zinc 65.38|
Ga Gallium 69.723|Ge Germanium 72.630|As Arsenic 74.922|Se Selenium 78.971|Br Bromine 79.904|Kr Krypton 83.798|Rb Rubidium 85.468|Sr Strontium 87.62|Y Yttrium 88.906|Zr Zirconium 91.224|
Nb Niobium 92.906|Mo Molybdenum 95.95|Tc Technetium 98|Ru Ruthenium 101.07|Rh Rhodium 102.91|Pd Palladium 106.42|Ag Silver 107.87|Cd Cadmium 112.41|In Indium 114.82|Sn Tin 118.71|
Sb Antimony 121.76|Te Tellurium 127.60|I Iodine 126.90|Xe Xenon 131.29|Cs Caesium 132.91|Ba Barium 137.33|La Lanthanum 138.91|Ce Cerium 140.12|Pr Praseodymium 140.91|Nd Neodymium 144.24|
Pm Promethium 145|Sm Samarium 150.36|Eu Europium 151.96|Gd Gadolinium 157.25|Tb Terbium 158.93|Dy Dysprosium 162.50|Ho Holmium 164.93|Er Erbium 167.26|Tm Thulium 168.93|Yb Ytterbium 173.05|
Lu Lutetium 174.97|Hf Hafnium 178.49|Ta Tantalum 180.95|W Tungsten 183.84|Re Rhenium 186.21|Os Osmium 190.23|Ir Iridium 192.22|Pt Platinum 195.08|Au Gold 196.97|Hg Mercury 200.59|
Tl Thallium 204.38|Pb Lead 207.2|Bi Bismuth 208.98|Po Polonium 209|At Astatine 210|Rn Radon 222|Fr Francium 223|Ra Radium 226|Ac Actinium 227|Th Thorium 232.04|
Pa Protactinium 231.04|U Uranium 238.03|Np Neptunium 237|Pu Plutonium 244|Am Americium 243|Cm Curium 247|Bk Berkelium 247|Cf Californium 251|Es Einsteinium 252|Fm Fermium 257|
Md Mendelevium 258|No Nobelium 259|Lr Lawrencium 266|Rf Rutherfordium 267|Db Dubnium 268|Sg Seaborgium 269|Bh Bohrium 270|Hs Hassium 277|Mt Meitnerium 278|Ds Darmstadtium 281|
Rg Roentgenium 282|Cn Copernicium 285|Nh Nihonium 286|Fl Flerovium 289|Mc Moscovium 290|Lv Livermorium 293|Ts Tennessine 294|Og Oganesson 294`;

export interface Element { number: number; symbol: string; name: string; mass: number; period: number; group: number | null; category: string }

const PERIOD_ENDS = [2, 10, 18, 36, 54, 86, 118];
const periodOf = (z: number) => PERIOD_ENDS.findIndex((end) => z <= end) + 1;
const METALLOIDS = new Set(['B', 'Si', 'Ge', 'As', 'Sb', 'Te']);
const OTHER_NONMETALS = new Set(['H', 'C', 'N', 'O', 'P', 'S', 'Se']);
const POST_TRANSITION = new Set(['Al', 'Ga', 'In', 'Tl', 'Nh', 'Sn', 'Pb', 'Fl', 'Bi', 'Mc', 'Po', 'Lv']);

/** Group 1-18, or null for the lanthanides and actinides (the f-block). */
function groupOf(z: number): number | null {
  if (z === 1) return 1;
  if (z === 2) return 18;
  if (z >= 3 && z <= 18) { const i = (z - 3) % 8; return i < 2 ? i + 1 : i + 11; }
  if (z >= 19 && z <= 54) return ((z - 19) % 18) + 1;
  if (z >= 55 && z <= 56) return z - 54;
  if ((z >= 57 && z <= 71) || (z >= 89 && z <= 103)) return null;
  if (z >= 72 && z <= 86) return z - 68;
  if (z >= 87 && z <= 88) return z - 86;
  return z - 100; // 104-118
}
function categoryOf(z: number, symbol: string, group: number | null): string {
  if (group === null) return z <= 71 ? 'lanthanide' : 'actinide';
  if (METALLOIDS.has(symbol)) return 'metalloid';
  if (OTHER_NONMETALS.has(symbol)) return 'nonmetal';
  if (group === 18) return 'noble gas';
  if (group === 17) return 'halogen';
  if (group === 1) return 'alkali metal';
  if (group === 2) return 'alkaline earth metal';
  if (POST_TRANSITION.has(symbol)) return 'post-transition metal';
  return 'transition metal';
}

export const ELEMENTS: Element[] = RAW.replace(/\n/g, '').split('|').map((row, i) => {
  const [symbol, name, mass] = row.trim().split(' ');
  const number = i + 1; const group = groupOf(number);
  return { number, symbol, name, mass: Number(mass), period: periodOf(number), group, category: categoryOf(number, symbol, group) };
});

const norm = (s: string) => s.trim().toLowerCase();
/** Finds an element by symbol, name (either spelling of aluminium/caesium/sulfur) or atomic number. */
export function findElement(query: string | number): Element | undefined {
  const q = norm(String(query));
  const alias: Record<string, string> = { aluminum: 'aluminium', cesium: 'caesium', sulphur: 'sulfur' };
  if (/^\d+$/.test(q)) return ELEMENTS[Number(q) - 1];
  return ELEMENTS.find((e) => norm(e.symbol) === q || norm(e.name) === (alias[q] ?? q));
}

/** Molar mass of a formula such as H2O, Ca(OH)2 or CuSO4.5H2O, with the count of each element. */
export function molarMass(formula: string): { mass: number; counts: Record<string, number> } {
  const f = formula.replace(/\s+/g, '');
  if (!f) throw new Error('Give a formula such as H2O.');
  const parts = f.split(/[·*.]/); // hydrates: CuSO4.5H2O
  const counts: Record<string, number> = {};
  parts.forEach((part, idx) => {
    const lead = idx > 0 ? part.match(/^(\d+)/) : null;
    const mult = lead ? Number(lead[1]) : 1;
    const body = lead ? part.slice(lead[1].length) : part;
    const stack: Array<Record<string, number>> = [{}];
    let i = 0;
    const readNum = () => { const m = body.slice(i).match(/^\d+/); if (!m) return 1; i += m[0].length; return Number(m[0]); };
    while (i < body.length) {
      const ch = body[i];
      if (ch === '(' || ch === '[') { stack.push({}); i++; } else if (ch === ')' || ch === ']') {
        i++; const n = readNum(); const top = stack.pop();
        if (!top || !stack.length) throw new Error(`Unbalanced brackets in ${formula}.`);
        for (const [k, v] of Object.entries(top)) stack[stack.length - 1][k] = (stack[stack.length - 1][k] ?? 0) + v * n;
      } else {
        const m = body.slice(i).match(/^[A-Z][a-z]?/);
        if (!m) throw new Error(`Cannot read "${body.slice(i, i + 3)}" in ${formula}.`);
        i += m[0].length;
        if (!findElement(m[0])) throw new Error(`${m[0]} is not an element symbol.`);
        const n = readNum();
        stack[stack.length - 1][m[0]] = (stack[stack.length - 1][m[0]] ?? 0) + n;
      }
    }
    if (stack.length !== 1) throw new Error(`Unbalanced brackets in ${formula}.`);
    for (const [k, v] of Object.entries(stack[0])) counts[k] = (counts[k] ?? 0) + v * mult;
  });
  const mass = Object.entries(counts).reduce((s, [sym, n]) => s + (findElement(sym) as Element).mass * n, 0);
  return { mass: Math.round(mass * 1000) / 1000, counts };
}

const CONSTANTS: Record<string, { value: string; unit: string; name: string }> = {
  c: { name: 'speed of light in a vacuum', value: '299792458', unit: 'm/s' },
  g: { name: 'standard gravity', value: '9.80665', unit: 'm/s^2' },
  G: { name: 'gravitational constant', value: '6.67430e-11', unit: 'm^3 kg^-1 s^-2' },
  h: { name: 'Planck constant', value: '6.62607015e-34', unit: 'J s' },
  kB: { name: 'Boltzmann constant', value: '1.380649e-23', unit: 'J/K' },
  NA: { name: 'Avogadro constant', value: '6.02214076e23', unit: '1/mol' },
  R: { name: 'gas constant', value: '8.314462618', unit: 'J mol^-1 K^-1' },
  e: { name: 'elementary charge', value: '1.602176634e-19', unit: 'C' },
  me: { name: 'electron mass', value: '9.1093837015e-31', unit: 'kg' },
  mp: { name: 'proton mass', value: '1.67262192369e-27', unit: 'kg' },
  F: { name: 'Faraday constant', value: '96485.33212', unit: 'C/mol' },
  atm: { name: 'standard atmosphere', value: '101325', unit: 'Pa' },
};
export function constant(name: string): { symbol: string; name: string; value: string; unit: string } | undefined {
  const key = Object.keys(CONSTANTS).find((k) => k.toLowerCase() === norm(name)) ?? Object.keys(CONSTANTS).find((k) => norm(CONSTANTS[k].name).includes(norm(name)) && norm(name).length > 3);
  return key ? { symbol: key, ...CONSTANTS[key] } : undefined;
}

const num = (v: unknown): number => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`Not a number: ${String(v)}`); return n; };
const r = (n: number, d = 4) => Number(n.toFixed(d));

/** The tutor's science tool: action + a JSON `input`. */
export function scienceData(action: string, inputText: string): string {
  const raw = inputText.trim();
  let input: any = raw;
  if (raw.startsWith('{')) { try { input = JSON.parse(raw); } catch { throw new Error('input must be valid JSON or plain text.'); } }
  const text = typeof input === 'string' ? input : String(input.query ?? input.formula ?? input.name ?? '');
  switch (action) {
    case 'element': {
      const e = findElement(text);
      if (!e) throw new Error(`No element matches "${text}".`);
      return JSON.stringify({ ...e, groupNote: e.group === null ? 'f-block (no group number)' : `group ${e.group}` });
    }
    case 'molar_mass': { const m = molarMass(text); return JSON.stringify({ formula: text, molarMass: m.mass, unit: 'g/mol', counts: m.counts }); }
    case 'ph': {
      const conc = num(input.concentration ?? input.c);
      if (conc <= 0) throw new Error('Concentration must be above zero.');
      const kind = String(input.of ?? 'H+').toLowerCase();
      const pH = kind.startsWith('oh') ? 14 + Math.log10(conc) : -Math.log10(conc);
      return JSON.stringify({ pH: r(pH), pOH: r(14 - pH), note: 'at 25 C; for strong acids and bases, fully dissociated' });
    }
    case 'constant': { const c = constant(text); if (!c) throw new Error(`No constant matches "${text}". Try c, g, G, h, kB, NA, R, e, me, mp, F, atm.`); return JSON.stringify(c); }
    case 'moles': {
      const grams = input.grams !== undefined ? num(input.grams) : undefined;
      const moles = input.moles !== undefined ? num(input.moles) : undefined;
      const m = molarMass(String(input.formula ?? ''));
      if (grams !== undefined) return JSON.stringify({ moles: r(grams / m.mass), molarMass: m.mass });
      if (moles !== undefined) return JSON.stringify({ grams: r(moles * m.mass), molarMass: m.mass });
      throw new Error('Give grams or moles with the formula.');
    }
    default: throw new Error('action must be one of: element, molar_mass, ph, constant, moles');
  }
}
