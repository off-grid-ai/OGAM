import { conjugateSpanish, isSpanishInfinitive } from '../../../src/language/conjugation';

const forms = (verb: string, tense: string) => conjugateSpanish(verb)!.find((t) => t.name.startsWith(tense))!.forms;

describe('Spanish conjugation', () => {
  it('conjugates regular verbs by rule', () => {
    expect(forms('hablar', 'Present')).toEqual(['hablo', 'hablas', 'habla', 'hablamos', 'habláis', 'hablan']);
    expect(forms('comer', 'Past')).toEqual(['comí', 'comiste', 'comió', 'comimos', 'comisteis', 'comieron']);
    expect(forms('vivir', 'Imperfect')).toEqual(['vivía', 'vivías', 'vivía', 'vivíamos', 'vivíais', 'vivían']);
    expect(forms('hablar', 'Future')).toEqual(['hablaré', 'hablarás', 'hablará', 'hablaremos', 'hablaréis', 'hablarán']);
    expect(forms('vivir', 'Conditional')[0]).toBe('viviría');
  });

  it('knows the common irregular verbs', () => {
    expect(forms('ser', 'Present')).toEqual(['soy', 'eres', 'es', 'somos', 'sois', 'son']);
    expect(forms('ir', 'Imperfect')[3]).toBe('íbamos');
    expect(forms('tener', 'Present')[0]).toBe('tengo');
    expect(forms('tener', 'Future')[2]).toBe('tendrá');
    expect(forms('hacer', 'Past')[2]).toBe('hizo');
  });

  it('changes the stem vowel where the verb does (not for nosotros / vosotros)', () => {
    expect(forms('querer', 'Present')).toEqual(['quiero', 'quieres', 'quiere', 'queremos', 'queréis', 'quieren']);
    expect(forms('dormir', 'Present')).toEqual(['duermo', 'duermes', 'duerme', 'dormimos', 'dormís', 'duermen']);
    expect(forms('dormir', 'Past')[2]).toBe('durmió');
    expect(forms('pedir', 'Present')[0]).toBe('pido');
    expect(forms('pedir', 'Past')[5]).toBe('pidieron');
    expect(forms('jugar', 'Present')[0]).toBe('juego');
    expect(forms('empezar', 'Present')[0]).toBe('empiezo');
  });

  it('keeps the sound with spelling changes', () => {
    expect(forms('buscar', 'Past')[0]).toBe('busqué');
    expect(forms('llegar', 'Past')[0]).toBe('llegué');
    expect(forms('empezar', 'Past')[0]).toBe('empecé');
    expect(forms('coger', 'Present')[0]).toBe('cojo');
    expect(forms('conocer', 'Present')[0]).toBe('conozco');
    expect(forms('seguir', 'Present')[0]).toBe('sigo');
    expect(forms('seguir', 'Past')[2]).toBe('siguió');
    expect(forms('leer', 'Past')).toEqual(['leí', 'leíste', 'leyó', 'leímos', 'leísteis', 'leyeron']);
  });

  it('only accepts infinitives', () => {
    expect(isSpanishInfinitive('hablar')).toBe(true);
    expect(isSpanishInfinitive('ir')).toBe(true);
    expect(isSpanishInfinitive('casa')).toBe(false);
    expect(conjugateSpanish('hola')).toBeNull();
  });
});
