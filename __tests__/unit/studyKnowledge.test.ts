import { findElement, molarMass, scienceData, ELEMENTS, constant } from '../../src/study/science';
import { studyMath } from '../../src/study/mathTools';
import { studyHelpers } from '../../src/study/helperTool';
import { relevantTools } from '../../src/services/tools/relevantTools';
import { STUDY_TOOL_IDS } from '../../src/stores/appStore';

describe('science look-ups', () => {
  it('has all 118 elements with correct groups and categories', () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(ELEMENTS.map((e) => e.number)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    const g = (s: string) => findElement(s)!;
    expect([g('H').group, g('He').group, g('Na').group, g('Mg').group, g('Al').group, g('Cl').group, g('Ar').group, g('Fe').group, g('Zn').group, g('Br').group, g('Hf').group, g('Rn').group, g('Og').group]).toEqual([1, 18, 1, 2, 13, 17, 18, 8, 12, 17, 4, 18, 18]);
    expect([g('La').group, g('U').group]).toEqual([null, null]);
    expect([g('Na').category, g('Ca').category, g('Fe').category, g('Si').category, g('O').category, g('F').category, g('Ne').category, g('Pb').category, g('La').category, g('U').category]).toEqual(['alkali metal', 'alkaline earth metal', 'transition metal', 'metalloid', 'nonmetal', 'halogen', 'noble gas', 'post-transition metal', 'lanthanide', 'actinide']);
    expect([g('Li').period, g('Cl').period, g('Fe').period, g('Au').period, g('Og').period]).toEqual([2, 3, 4, 6, 7]);
    expect(findElement('Aluminum')?.symbol).toBe('Al');
    expect(findElement('26')?.name).toBe('Iron');
    expect(findElement('Unobtainium')).toBeUndefined();
  });
  it('computes molar masses of formulas, brackets and hydrates', () => {
    expect(molarMass('H2O').mass).toBeCloseTo(18.015, 3);
    expect(molarMass('NaCl').mass).toBeCloseTo(58.44, 2);
    expect(molarMass('Ca(OH)2').mass).toBeCloseTo(74.092, 2);
    expect(molarMass('C6H12O6').mass).toBeCloseTo(180.156, 2);
    expect(molarMass('CuSO4.5H2O').mass).toBeCloseTo(249.68, 1);
    expect(molarMass('Al2(SO4)3').counts).toEqual({ Al: 2, S: 3, O: 12 });
    expect(() => molarMass('Xx2')).toThrow(/not an element/);
    expect(() => molarMass('Ca(OH')).toThrow(/Unbalanced/);
  });
  it('answers pH, moles and constants through the tool', () => {
    expect(JSON.parse(scienceData('ph', '{"concentration":0.001}')).pH).toBe(3);
    expect(JSON.parse(scienceData('ph', '{"concentration":0.01,"of":"OH-"}')).pH).toBe(12);
    expect(JSON.parse(scienceData('moles', '{"formula":"H2O","grams":36.03}')).moles).toBeCloseTo(2, 2);
    expect(constant('NA')?.value).toBe('6.02214076e23');
    expect(JSON.parse(scienceData('element', 'gold')).symbol).toBe('Au');
    expect(() => scienceData('nope', '')).toThrow(/action must be/);
  });
});

describe('everyday maths', () => {
  const run = (action: string, input: object) => JSON.parse(studyMath({ action, input: JSON.stringify(input) }));
  it('solves equations, number problems, percents, shapes and fractions', () => {
    expect(run('solve', { type: 'quadratic', a: 1, b: -3, c: 2 }).roots).toEqual([1, 2]);
    expect(run('solve', { type: 'quadratic', a: 1, b: 2, c: 5 }).kind).toBe('two complex roots');
    expect(run('solve', { type: 'linear', a: 2, b: -6 }).x).toBe(3);
    expect(run('solve', { type: 'system', a1: 1, b1: 1, c1: 5, a2: 1, b2: -1, c2: 1 })).toMatchObject({ x: 3, y: 2 });
    expect(run('number', { op: 'gcd', a: 48, b: 18 }).gcd).toBe(6);
    expect(run('number', { op: 'lcm', a: 4, b: 6 }).lcm).toBe(12);
    expect(run('number', { op: 'choose', n: 5, k: 2 }).combinations).toBe(10);
    expect(run('number', { op: 'prime_factors', n: 84 }).factors).toEqual([2, 2, 3, 7]);
    expect(run('percent', { op: 'change', from: 80, to: 100 }).percentChange).toBe(25);
    expect(run('percent', { op: 'of', percent: 15, value: 200 }).result).toBe(30);
    expect(run('geometry', { shape: 'circle', r: 2 }).area).toBeCloseTo(12.5664, 3);
    expect(run('geometry', { shape: 'right_triangle', a: 3, b: 4 }).hypotenuse).toBe(5);
    expect(run('fraction', { op: 'add', a: '1/2', b: '1/3' }).fraction).toBe('5/6');
    expect(run('fraction', { op: 'divide', a: '3/4', b: '3/8' }).fraction).toBe('2');
    expect(() => run('solve', { type: 'quadratic', a: 0, b: 1, c: 1 })).toThrow(/cannot be 0/);
    expect(() => studyMath({ action: 'number', input: 'not json' })).toThrow(/valid JSON/);
  });
});

describe('English help', () => {
  it('measures a passage', () => {
    const r = JSON.parse(studyHelpers({ action: 'text_stats', text: 'The cat sat. The cat sat on the mat again and again.' }));
    expect(r).toMatchObject({ words: 12, sentences: 2 });
    expect(r.mostUsed[0]).toMatch(/^(again|sat|cat)/);
    expect(r.fleschReadingEase).toBeGreaterThan(80);
    expect(() => studyHelpers({ action: 'text_stats', text: '' })).toThrow(/some text/);
  });
});

describe('no subject has to be chosen: the right tools come with the message', () => {
  const enabled = [...STUDY_TOOL_IDS, 'web_search', 'calculator'];
  const picked = (m: string) => relevantTools(m, enabled);
  it('offers the maths tool for sums and equations, the science tool for chemistry, the helper for essays', () => {
    expect(picked('solve 2x^2 - 5x + 3 = 0')).toContain('study_math');
    expect(picked('what is the molar mass of calcium hydroxide')).toContain('science_data');
    expect(picked('which element is in group 17 period 3')).toContain('science_data');
    expect(picked('how readable is my essay paragraph')).toContain('study_helpers');
    expect(picked('what is a good name for a dog')).not.toContain('science_data');
  });
  it('turns the study tools on by default', () => {
    expect(STUDY_TOOL_IDS).toEqual(['study_math', 'science_data', 'study_helpers', 'find_image']);
  });
});
