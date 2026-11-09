/**
 * Daily briefing: a short spoken news show about the user's interests, with fun facts.
 * Online: fresh headlines (news RSS feeds) + the top article for each interest.
 * Offline / off-grid: an "offline edition" from the offline library instead.
 * The episode is written by the model on the phone and saved like a study podcast.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Source, StudyResult, askModel, useStudyStore, writeEpisode } from '../study/engine';
import { WORDS_PER_MINUTE, avoided, cleanHeadlines, feedsFor, isPromotional, linesPerStory, onTopic, parseScreenReply, pickStories, screenPrompt, similarity, splitOutlet, spokenMinutes, storyBudget, type Headline } from './newsSources';

export const BRIEF_PROJECT = 'daily-brief';

interface BriefPrefs {
  interests: string[];
  minutes: number;
  hosts: 1 | 2;
  funFacts: boolean;
  /** also read the top article per interest (slower, more detail) */
  deep: boolean;
  /** Topics to leave out of the briefing entirely. */
  avoid: string[];
  /** Each topic presented by its own expert, with the anchor handing over. */
  experts: boolean;
  /** A short tune before and after the show. */
  jingles: boolean;
  setInterests: (v: string[]) => void;
  set: (p: Partial<Pick<BriefPrefs, 'minutes' | 'hosts' | 'funFacts' | 'deep' | 'avoid' | 'experts' | 'jingles'>>) => void;
}

export const useBriefPrefs = create<BriefPrefs>()(persist((set) => ({
  interests: ['world news', 'science', 'technology'],
  minutes: 5,
  hosts: 2,
  funFacts: true,
  deep: true,
  avoid: [],
  experts: false,
  jingles: true,
  setInterests: (interests) => set({ interests }),
  set: (p) => set(p),
}), { name: 'atlas-daily-brief', storage: createJSONStorage(() => AsyncStorage), partialize: (s) => ({ interests: s.interests, minutes: s.minutes, hosts: s.hosts, funFacts: s.funFacts, deep: s.deep, avoid: s.avoid, experts: s.experts, jingles: s.jingles }) }));

const EXPERT_NAMES = ['Maya', 'Theo', 'Priya', 'Marcus', 'Lena', 'Omar', 'Grace', 'Sam'];

/**
 * Cast for one part when each topic has its own expert: the anchor (A) introduces that
 * topic's expert by name, who explains the story. Experts alternate between voices B and C.
 */
export function expertCast(interest: string, index: number): string {
  const voice = index % 2 === 0 ? 'B' : 'C';
  return `A (the anchor) and ${voice} (${EXPERT_NAMES[index % EXPERT_NAMES.length]}, our ${interest} expert). A introduces ${EXPERT_NAMES[index % EXPERT_NAMES.length]} by name the first time, then ${voice} explains the story and A asks a short follow-up. Only A and ${voice} speak in this part.`;
}

/** "I like space, the Bears and cooking" -> ['space', 'the Bears', 'cooking'] */
export function parseInterests(text: string): string[] {
  const cleaned = text.replace(/^\s*(i\s+(really\s+)?(like|love|enjoy|follow|am into|'m into)|my interests are|interests?:)\s*/i, '');
  const parts = cleaned.split(/,|;|\n|\band\b|&|\//i).map((x) => x.replace(/^\s*(also|plus)\s+/i, '').replace(/[.!]+$/, '').trim()).filter((x) => x.length > 1 && x.length < 60);
  return [...new Set(parts.map((p) => p.toLowerCase()))].map((l) => parts.find((p) => p.toLowerCase() === l)!).slice(0, 12);
}

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const briefings = (): StudyResult[] => useStudyStore.getState().saved[BRIEF_PROJECT] || [];
export const todaysBrief = (): StudyResult | undefined => briefings().find((r) => todayKey(new Date(r.createdAt)) === todayKey());

const decode = (t: string) => t
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/\s+/g, ' ').trim();

async function fetchText(url: string, ms = 12000): Promise<string> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

export function parseRss(xml: string): Headline[] {
  const out: Headline[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const it = m[0];
    const tag = (n: string) => it.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i'))?.[1] ?? '';
    const title = decode(tag('title'));
    if (!title) continue;
    const date = Date.parse(decode(tag('pubDate')));
    out.push({ title, desc: decode(tag('description')).slice(0, 400), url: decode(tag('link')) || undefined, source: decode(tag('source') || tag('News:Source')) || undefined, date: isNaN(date) ? undefined : date });
  }
  return out;
}

/** Fresh real headlines that fit one interest, from the first feed that has any (see newsSources). */
async function headlines({ topic, interests, seen, want }: { topic: string; interests: string[]; seen: string[]; want: number }): Promise<Headline[]> {
  for (const f of feedsFor(topic)) {
    try {
      const fromSection = f.includes('/headlines/section/');
      const items = onTopic(cleanHeadlines(parseRss(await fetchText(f)), Date.now(), seen), { interest: topic, interests, fromSection });
      if (items.length) return items.slice(0, Math.max(6, want));
    } catch { /* try the next feed */ }
  }
  return [];
}

/** A few of today's real headlines on a topic (for the language course's news square). */
export const latestHeadlines = (topic: string, want: number): Promise<Headline[]> =>
  headlines({ topic, interests: [topic], seen: [], want }).then((h) => h.slice(0, want));

/**
 * More detail for one story: the same story in Bing News (a summary and a direct link, since
 * Google News links are redirects), then optionally the article itself.
 */
async function storyDetail(h: Headline, deep: boolean): Promise<{ text: string; url?: string }> {
  let summary = '';
  let url = h.url && !/news\.google\.com/.test(h.url) ? h.url : undefined;
  try {
    const match = parseRss(await fetchText(`https://www.bing.com/news/search?q=${encodeURIComponent(h.title)}&format=rss`, 8000))
      .map(splitOutlet).find((x) => !isPromotional(x) && similarity(x.title, h.title) >= 0.5);
    if (match) { summary = match.desc; url = url || match.url; }
  } catch { /* the headline alone is enough */ }
  let article = '';
  if (deep && url) {
    try {
      const { readPage } = require('../services/tools/handlers');
      const txt: string = await readPage(url, 2500);
      if (txt && txt.length > 300) article = txt.replace(/\s+/g, ' ').slice(0, 900);
    } catch { /* summary is enough */ }
  }
  return { text: [summary, article].filter(Boolean).join('\n'), url };
}

async function libraryFacts(topic: string, startN: number): Promise<Source[]> {
  try {
    const { searchLibrary, readArticle } = require('./offlineLibrary');
    const hits = await searchLibrary(topic, 2);
    const out: Source[] = [];
    for (const h of hits.slice(0, 1)) {
      const a = await readArticle(h.uri, h.path, 1400);
      out.push({ n: startN + out.length, doc: `${h.library}: ${a.title}`, part: 1, text: a.text.replace(/\s+/g, ' ').slice(0, 1200), origin: 'library' });
    }
    return out;
  } catch { return []; }
}

type OutlineItem = { topic: string; sources: Source[]; always?: boolean };

function storyHeader(h: Headline): string {
  const when = h.date ? new Date(h.date).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  return [`Headline: ${h.title}`, h.source && `Outlet: ${h.source}`, when && `Published: ${when}`].filter(Boolean).join('\n');
}

/** One outline item for one real story: its headline, outlet, time and any detail found. */
async function storyItem({ h, interest, deep, n }: { h: Headline; interest: string; deep: boolean; n: number }): Promise<OutlineItem> {
  const detail = await storyDetail(h, deep);
  const outlet = h.source ? ` (${h.source})` : '';
  return {
    topic: `${h.title}${outlet} - ${interest}`,
    sources: [{ n, doc: h.source || 'News', part: 1, text: `${storyHeader(h)}\n${detail.text || h.desc || ''}`.slice(0, 1800), origin: 'web', url: detail.url || h.url }],
  };
}

/** Library items: one fun fact with the news, or several for an offline edition. */
async function libraryItems(interests: string[], withNews: boolean, firstN: number): Promise<OutlineItem[]> {
  const out: OutlineItem[] = [];
  let n = firstN;
  for (const topic of interests.slice(0, withNews ? 2 : 6)) {
    const facts = await libraryFacts(topic, n);
    if (!facts.length) continue;
    n += facts.length;
    out.push({ topic: withNews ? `A fun fact about ${topic} from the offline library` : `From the offline library: ${topic}`, sources: facts, always: true });
    if (withNews) break;
  }
  return out;
}

type Picked = { interest: number; headline: Headline };

/**
 * Word lists miss stories ("Chiefs beat Bills" never says sports), so the AI on the phone also reads the headlines and names
 * the ones about a topic the listener wants left out. Returns the positions to drop; if the AI cannot be asked, the word
 * lists alone have to do.
 */
export async function aiScreen(titles: string[], avoid: string[]): Promise<Set<number>> {
  if (!avoid.length || !titles.length) return new Set();
  const drop = new Set<number>();
  try {
    for (let from = 0; from < titles.length; from += 25) {
      const batch = titles.slice(from, from + 25);
      const { system, user } = screenPrompt(batch, avoid);
      parseScreenReply(await askModel(system, user), batch.length).forEach((i) => drop.add(from + i));
    }
  } catch { /* the word lists already ran */ }
  return drop;
}

/**
 * Real headlines for each interest (top-story sections for broad ones), no ads, press
 * releases or avoided topics, read one by one until what the stories can carry adds up to the
 * chosen length. Twice the planned number are fetched, so thin stories can be topped up.
 */
async function gatherStories(o: { interests: string[]; minutes: number; deep: boolean; avoid: string[] }, onStep: (m: string) => void): Promise<{ outline: OutlineItem[]; stories: Picked[] }> {
  const { interests, minutes, deep, avoid } = o;
  const perInterest: Headline[][] = [];
  const budget = storyBudget(minutes, deep);
  const seen: string[] = [];
  const topics = interests.slice(0, 8);
  for (const topic of topics) {
    onStep(`Checking news: ${topic}...`);
    const hs = (await headlines({ topic, interests, seen, want: Math.ceil((budget * 2) / topics.length) + 2 }))
      .filter((h) => !avoided(h, avoid));
    perInterest.push(hs);
    hs.forEach((h) => seen.push(h.title));
  }
  if (avoid.length) {
    onStep('Checking the headlines against your topics to avoid...');
    const flat = perInterest.flatMap((list, interest) => list.map((h) => ({ interest, h })));
    const dropped = await aiScreen(flat.map(({ h }) => h.title), avoid);
    const gone = new Set([...dropped].map((i) => flat[i].h));
    perInterest.forEach((list, k) => { perInterest[k] = list.filter((h) => !gone.has(h)); });
  }
  const outline: OutlineItem[] = [];
  const stories: Picked[] = [];
  // A few more than the length needs are read, so the script can keep going until it really reaches the length.
  const want = Math.min(24, budget + 4);
  for (const pick of pickStories(perInterest, Math.min(30, budget * 2))) {
    if (stories.length >= want) break;
    // The same event under another outlet's wording is one card, not two.
    if (stories.some((x) => similarity(x.headline.title, pick.headline.title) >= 0.5 || (!!x.headline.url && !/news\.google\.com/.test(x.headline.url) && x.headline.url === pick.headline.url))) continue;
    onStep(`Reading story ${stories.length + 1}: ${pick.headline.title.slice(0, 50)}...`);
    const item = await storyItem({ h: pick.headline, interest: interests[pick.interest], deep, n: outline.length + 1 });
    outline.push(item);
    stories.push(pick);
  }
  return { outline, stories };
}

function offGridNow(): boolean { try { return require('./offGrid').offGridOn(); } catch { return false; } }

/** The interests to cover: those that are not themselves something to avoid (by word lists, then by asking the AI). */
async function wantedInterests(all: string[], avoid: string[]): Promise<string[]> {
  const byWords = all.filter((i) => !avoided({ title: i, desc: '' }, avoid));
  const byAi = avoid.length && !offGridNow() ? await aiScreen(byWords, avoid) : new Set<number>();
  const wanted = byWords.filter((_, k) => !byAi.has(k));
  return wanted.length ? wanted : ['world news'];
}

const NO_WELCOME = 'Do not greet listeners, welcome them, name the show or say the date: the opening greeting is added for you. Start straight into the first story, never repeat a line, and move between stories with a few words.';

/** The opening line, made here so the date is always said first (the model was leaving it out or putting it mid-show). */
export function greetingLine(now = new Date()): string {
  const part = now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening';
  const date = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return `Good ${part}. Today is ${date}, and this is your briefing.`;
}
/** Rules every part of the briefing must follow. */
const briefingRules = (avoid: string[], gotNews: boolean): string | undefined =>
  [avoid.length ? `Never bring up: ${avoid.join(', ')}.` : '', gotNews ? NO_WELCOME : ''].filter(Boolean).join(' ') || undefined;

/** Builds today's briefing from real, current stories and saves it. */
export async function makeBriefing(onStep: (m: string) => void, voicesAvailable: number): Promise<StudyResult> {
  const p = useBriefPrefs.getState();
  const interests = await wantedInterests(p.interests, p.avoid ?? []);
  let offline = false;
  try { offline = require('./offGrid').offGridOn(); } catch { /* ignore */ }

  const avoid = p.avoid ?? [];
  const { outline, stories } = offline ? { outline: [] as OutlineItem[], stories: [] as Picked[] }
    : await gatherStories({ interests, minutes: p.minutes, deep: p.deep, avoid }, onStep);

  // 3. Fun facts come only from the offline library, never from the model's memory.
  const gotNews = outline.length > 0;
  if (p.funFacts || !gotNews) {
    onStep(gotNews ? 'Finding a fun fact in the offline library...' : 'No news - making an offline edition from your library...');
    outline.push(...await libraryItems(interests, gotNews, outline.length + 1));
  }
  if (!outline.length) {
    throw new Error(offline
      ? 'Off-grid mode is on and the offline library has nothing on your interests yet. Turn off off-grid mode, or download a library pack in Offline library.'
      : 'Could not reach the news and found nothing in the offline library. Check your internet connection and try again.');
  }

  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const rules = briefingRules(avoid, gotNews);
  const withExperts = p.experts && gotNews && voicesAvailable >= 2;
  let usedStories = stories.length;
  const r = await writeEpisode([], {
    title: `${gotNews ? 'Daily briefing' : 'Offline edition'} - ${date}`,
    prompt: gotNews
      ? `A daily news briefing for ${date} on: ${interests.join(', ')}. Each item is one real story: summarize it in your own words in two to four sentences (what happened, who is involved, why it matters) and name the outlet. Never read an article aloud or quote it, and report only what its source says.`
      : `An "offline edition" for ${date}: there is no live news today, so share interesting things from the library about: ${interests.join(', ')}.`,
    minutes: p.minutes,
    hosts: withExperts ? 3 : voicesAvailable >= 2 ? p.hosts : 1,
    rules,
    noWelcome: gotNews,
    castFor: withExperts ? (i) => (stories[i] ? expertCast(interests[stories[i].interest], stories[i].interest) : undefined) : undefined,
    style: 'news',
    research: false,
    funFacts: false,
    outline,
    // Enough lines per story that the stories add up to the length the user picked.
    linesPerItem: linesPerStory(p.minutes, storyBudget(p.minutes, p.deep)),
    targetWords: p.minutes * WORDS_PER_MINUTE,
    onItemsUsed: (count) => { usedStories = count; },
  }, onStep);
  if (gotNews && r.podcast) r.podcast = [{ host: 'A', text: greetingLine() }, ...r.podcast];
  // The greeting is now line 0, so every story start moves down one line.
  if (gotNews && r.storyStarts) r.storyStarts = r.storyStarts.map((n) => n + 1);
  r.minutes = Math.max(1, Math.round(spokenMinutes((r.podcast ?? []).map((l) => l.text))));
  r.headlines = stories.slice(0, usedStories).map(({ interest, headline: h }, i) => ({
    title: h.title, source: h.source, date: h.date, interest: interests[interest], url: outline[i]?.sources[0]?.url || h.url,
  }));
  useStudyStore.getState().add(BRIEF_PROJECT, r);
  preRenderBriefing(r);
  return r;
}

/** Saves the briefing's audio in the background now, so it starts at once and plays without gaps. */
function preRenderBriefing(r: StudyResult): void {
  try {
    const { listVoices } = require('../atlasVoice/tts');
    const { castLine, preRenderEpisode } = require('../atlasVoice/podcastAudio');
    listVoices('en').then((voices: { name: string }[]) => preRenderEpisode(`${BRIEF_PROJECT}-${r.createdAt}`,
      (r.podcast ?? []).map((l) => ({ text: l.text, ...castLine(l.host, r.hosts ?? 2, voices) }))))
      .catch(() => undefined);
  } catch { /* no voice engine: it is spoken live */ }
}
