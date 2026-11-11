/**
 * Spanish verb conjugation, offline: regular verbs by rule, the common irregular and stem-changing
 * verbs from tables. Pure, so it is tested without a device. Other languages get their conjugation
 * from the AI (languageService.conjugation).
 */
export const PERSONS = ['yo', 'tú', 'él / ella', 'nosotros', 'vosotros', 'ellos'];
export interface Tense { name: string; forms: string[] }

const ENDINGS = {
  ar: { pres: ['o', 'as', 'a', 'amos', 'áis', 'an'], pret: ['é', 'aste', 'ó', 'amos', 'asteis', 'aron'], imp: ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban'] },
  er: { pres: ['o', 'es', 'e', 'emos', 'éis', 'en'], pret: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'], imp: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'] },
  ir: { pres: ['o', 'es', 'e', 'imos', 'ís', 'en'], pret: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'], imp: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'] },
} as const;
const FUTURE = ['é', 'ás', 'á', 'emos', 'éis', 'án'];
const CONDITIONAL = ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'];

interface Irregular { pres?: string[]; pret?: string[]; imp?: string[]; stem?: string }
const six = (s: string) => s.split(' ');
/** Fully or partly irregular verbs; anything not listed is conjugated by rule. */
const IRREGULAR: Record<string, Irregular> = {
  ser: { pres: six('soy eres es somos sois son'), pret: six('fui fuiste fue fuimos fuisteis fueron'), imp: six('era eras era éramos erais eran') },
  estar: { pres: six('estoy estás está estamos estáis están'), pret: six('estuve estuviste estuvo estuvimos estuvisteis estuvieron') },
  ir: { pres: six('voy vas va vamos vais van'), pret: six('fui fuiste fue fuimos fuisteis fueron'), imp: six('iba ibas iba íbamos ibais iban') },
  tener: { pres: six('tengo tienes tiene tenemos tenéis tienen'), pret: six('tuve tuviste tuvo tuvimos tuvisteis tuvieron'), stem: 'tendr' },
  hacer: { pres: six('hago haces hace hacemos hacéis hacen'), pret: six('hice hiciste hizo hicimos hicisteis hicieron'), stem: 'har' },
  poder: { pres: six('puedo puedes puede podemos podéis pueden'), pret: six('pude pudiste pudo pudimos pudisteis pudieron'), stem: 'podr' },
  querer: { pres: six('quiero quieres quiere queremos queréis quieren'), pret: six('quise quisiste quiso quisimos quisisteis quisieron'), stem: 'querr' },
  decir: { pres: six('digo dices dice decimos decís dicen'), pret: six('dije dijiste dijo dijimos dijisteis dijeron'), stem: 'dir' },
  ver: { pres: six('veo ves ve vemos veis ven'), pret: six('vi viste vio vimos visteis vieron'), imp: six('veía veías veía veíamos veíais veían') },
  dar: { pres: six('doy das da damos dais dan'), pret: six('di diste dio dimos disteis dieron') },
  saber: { pres: six('sé sabes sabe sabemos sabéis saben'), pret: six('supe supiste supo supimos supisteis supieron'), stem: 'sabr' },
  venir: { pres: six('vengo vienes viene venimos venís vienen'), pret: six('vine viniste vino vinimos vinisteis vinieron'), stem: 'vendr' },
  poner: { pres: six('pongo pones pone ponemos ponéis ponen'), pret: six('puse pusiste puso pusimos pusisteis pusieron'), stem: 'pondr' },
  salir: { pres: six('salgo sales sale salimos salís salen'), stem: 'saldr' },
  traer: { pres: six('traigo traes trae traemos traéis traen'), pret: six('traje trajiste trajo trajimos trajisteis trajeron') },
  oír: { pres: six('oigo oyes oye oímos oís oyen'), pret: six('oí oíste oyó oímos oísteis oyeron') },
};

/** Verbs whose stem vowel changes in the present (not for nosotros / vosotros), and in the 3rd person past. */
const STEM_CHANGE: Record<string, { pres: 'ie' | 'ue' | 'i'; pret?: 'i' | 'u' }> = {
  pensar: { pres: 'ie' }, empezar: { pres: 'ie' }, comenzar: { pres: 'ie' }, cerrar: { pres: 'ie' }, entender: { pres: 'ie' },
  perder: { pres: 'ie' }, preferir: { pres: 'ie', pret: 'i' }, sentir: { pres: 'ie', pret: 'i' }, mentir: { pres: 'ie', pret: 'i' },
  divertir: { pres: 'ie', pret: 'i' }, despertar: { pres: 'ie' }, recomendar: { pres: 'ie' },
  encontrar: { pres: 'ue' }, contar: { pres: 'ue' }, recordar: { pres: 'ue' }, volver: { pres: 'ue' }, mover: { pres: 'ue' },
  costar: { pres: 'ue' }, almorzar: { pres: 'ue' }, dormir: { pres: 'ue', pret: 'u' }, morir: { pres: 'ue', pret: 'u' },
  jugar: { pres: 'ue' }, mostrar: { pres: 'ue' }, probar: { pres: 'ue' },
  pedir: { pres: 'i', pret: 'i' }, servir: { pres: 'i', pret: 'i' }, repetir: { pres: 'i', pret: 'i' }, vestir: { pres: 'i', pret: 'i' },
  elegir: { pres: 'i', pret: 'i' }, seguir: { pres: 'i', pret: 'i' },
};

/** A stem ending in a, e or o (leer, creer, caer): the past needs y and accents (leyó, leíste). */
const OPEN_STEM = /[aeoáéó]$/;

/** Changes the last e / o of the stem (jugar: u) as the stem-changing verb needs. */
function changeStem(stem: string, change: 'ie' | 'ue' | 'i' | 'u'): string {
  if (stem === 'jug') return 'jueg'; // jugar: u -> ue
  const wanted = change === 'ie' || change === 'i' ? 'e' : 'o';
  const at = stem.lastIndexOf(wanted);
  if (at < 0) return stem;
  const replacement = change === 'u' ? 'u' : change;
  return stem.slice(0, at) + replacement + stem.slice(at + 1);
}

/** The ending class of an infinitive, or null when it is not one. */
function kind(inf: string): 'ar' | 'er' | 'ir' | null {
  if (/ar$/.test(inf)) return 'ar';
  if (/er$/.test(inf)) return 'er';
  if (/(ir|ír)$/.test(inf)) return 'ir';
  return null;
}

/** Spelling changes that keep the sound: -car/-gar/-zar in the yo past, -ger/-gir in the yo present. */
function spell(stem: string, k: 'ar' | 'er' | 'ir', tense: 'pres' | 'pret'): string {
  // Only the yo form (the first person) is spelled differently.
  if (k === 'ar' && tense === 'pret') {
    if (stem.endsWith('c')) return `${stem.slice(0, -1)}qu`;
    if (stem.endsWith('g')) return `${stem}u`;
    if (stem.endsWith('z')) return `${stem.slice(0, -1)}c`;
  }
  if (k !== 'ar' && tense === 'pres') {
    if (stem.endsWith('g')) return `${stem.slice(0, -1)}j`;
    if (stem.endsWith('gu')) return stem.slice(0, -1); // seguir -> sigo
    if (/[aeiou]c$/.test(stem)) return `${stem.slice(0, -1)}zc`; // conocer -> conozco
  }
  return stem;
}

function regular(inf: string, k: 'ar' | 'er' | 'ir', tense: 'pres' | 'pret' | 'imp'): string[] {
  const stem = inf.replace(/(ar|er|ir|ír)$/, '');
  const change = STEM_CHANGE[inf];
  return ENDINGS[k][tense].map((ending, p) => {
    let s = stem;
    if (tense === 'pres' && change && [0, 1, 2, 5].includes(p)) s = changeStem(stem, change.pres);
    if (tense === 'pret' && change?.pret && [2, 5].includes(p)) s = changeStem(stem, change.pret);
    if (tense !== 'imp' && p === 0) s = spell(s, k, tense);
    if (tense === 'pret' && k !== 'ar' && OPEN_STEM.test(s)) {
      if ([2, 5].includes(p)) return s + ending.replace(/^i/, 'y'); // leyó, leyeron
      return s + ending.replace(/^i/, 'í'); // leí, leíste, leímos, leísteis
    }
    return s + ending;
  });
}

/** True for a Spanish infinitive this conjugator can handle. */
export const isSpanishInfinitive = (word: string): boolean =>
  /^[a-záéíóúüñ]{2,}$/.test(word) && (word.length >= 3 || word === 'ir') && kind(word) !== null;

/** The tenses of a Spanish verb: present, past, imperfect, future and conditional. Null if it is not an infinitive. */
export function conjugateSpanish(infinitive: string): Tense[] | null {
  const inf = infinitive.toLocaleLowerCase();
  const k = kind(inf);
  if (!k || !isSpanishInfinitive(inf)) return null;
  const irr = IRREGULAR[inf];
  const stem = irr?.stem ?? inf;
  return [
    { name: 'Present', forms: irr?.pres ?? regular(inf, k, 'pres') },
    { name: 'Past (preterite)', forms: irr?.pret ?? regular(inf, k, 'pret') },
    { name: 'Imperfect (used to)', forms: irr?.imp ?? regular(inf, k, 'imp') },
    { name: 'Future', forms: FUTURE.map((e) => stem + e) },
    { name: 'Conditional (would)', forms: CONDITIONAL.map((e) => stem + e) },
  ];
}
