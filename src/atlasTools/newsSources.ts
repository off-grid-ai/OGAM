/**
 * Choosing real news for the daily briefing.
 *
 * Broad interests ("world news", "United States", "business") use Google News's top-stories
 * sections, which are edited news from established outlets. Specific interests use a recent
 * Google News search, with Bing News as a fallback. Press releases, sponsored posts and
 * shopping/deal items are dropped, near-duplicate stories are merged, and only the last two
 * days count, so a "daily" briefing is about today's news.
 */
export interface Headline { title: string; desc: string; url?: string; source?: string; date?: number }

const GN = 'hl=en-US&gl=US&ceid=US:en';

/** Google News section for a broad interest, or null for a specific one. */
export function sectionFor(interest: string): string | null {
  const t = ` ${interest.toLowerCase().replace(/[^a-z. ]+/g, ' ')
    .replace(/\b(news|headlines|top|latest|stories|today|the|current events?)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()} `;
  const rules: [RegExp, string][] = [
    [/ (world|international|global|foreign|worldwide) /, 'WORLD'],
    [/ (u\.?s\.?a?\.?|united states|us|national|america|american|domestic) /, 'NATION'],
    [/ (business|economy|economic|markets?|finance|financial) /, 'BUSINESS'],
    [/ (technology|tech) /, 'TECHNOLOGY'],
    [/ (science|space) /, 'SCIENCE'],
    [/ (health|medicine|medical) /, 'HEALTH'],
    [/ (sports?) /, 'SPORTS'],
    [/ (entertainment|movies|celebrity|celebrities|tv) /, 'ENTERTAINMENT'],
  ];
  if (t.trim() === '') return 'NATION'; // just "news"
  return rules.find(([re]) => re.test(t))?.[1] ?? null;
}

/** Feeds to try for an interest, best first. */
export function feedsFor(interest: string): string[] {
  const section = sectionFor(interest);
  const q = encodeURIComponent(interest);
  return [
    ...(section ? [`https://news.google.com/rss/headlines/section/topic/${section}?${GN}`] : []),
    `https://news.google.com/rss/search?q=${q}%20when:2d&${GN}`,
    `https://www.bing.com/news/search?q=${q}&format=rss`,
  ];
}

const PR_WIRES = /pr ?newswire|globe ?newswire|business ?wire|access ?wire|accessnewswire|ein ?presswire|newsfile|openpr|prweb|24-7 press release|press ?release|newswire\.com|marketersmedia|issuewire|prlog|send2press|prfire/i;
const AD_WORDS = /\b(sponsored|advertis(e|ement|ing)|paid (post|content|partner)|partner content|promo(tion)? code|coupons?|discount code|\d+% off|deals? (of|on|for) |black friday deals|best .{1,40} to buy|top \d+ .{1,40} (to buy|you can buy)|shop now|buy now|limited[- ]time offer|giveaway|webinar|free trial)\b/i;

/** True for press releases, sponsored posts and shopping/deal items, which are not news. */
export function isPromotional(h: Pick<Headline, 'title' | 'desc' | 'source' | 'url'>): boolean {
  const where = `${h.source ?? ''} ${h.url ?? ''}`;
  if (PR_WIRES.test(where)) return true;
  return AD_WORDS.test(h.title) || AD_WORDS.test(h.desc.slice(0, 200));
}

/** Google News titles end in " - Outlet": move the outlet into `source`. */
export function splitOutlet(h: Headline): Headline {
  const m = h.title.match(/^(.*\S)\s+[-–]\s+([^-–]{2,60})$/);
  if (!m) return h;
  return { ...h, title: m[1], source: h.source || m[2] };
}

const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2));

/** Word overlap between two headlines (0..1): same story from different outlets scores high. */
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  A.forEach((w) => { if (B.has(w)) shared++; });
  return shared / Math.min(A.size, B.size);
}

export const FRESH_MS = 48 * 3600e3;

/** Fresh, non-promotional, de-duplicated headlines, newest first. */
export function cleanHeadlines(items: Headline[], now = Date.now(), seen: string[] = []): Headline[] {
  const out: Headline[] = [];
  for (const raw of items) {
    const h = splitOutlet(raw);
    if (!h.title || isPromotional(h)) continue;
    if (h.date && now - h.date > FRESH_MS) continue;
    if ([...seen, ...out.map((o) => o.title)].some((t) => similarity(t, h.title) >= 0.6)) continue;
    out.push(h);
  }
  return out.sort((a, b) => (b.date || 0) - (a.date || 0));
}

/** Spoken words per minute used to size the briefing to the chosen length. */
export const WORDS_PER_MINUTE = 150;

/**
 * How many stories fill the chosen length. Each story is a short summary (about 60 spoken words, 40 without
 * reading the article), not a full read of it. At least three, at most thirty.
 */
export const storyBudget = (minutes: number, deep = true) =>
  Math.max(3, Math.min(30, Math.round((minutes * WORDS_PER_MINUTE) / (deep ? 60 : 40))));

/** Script lines per story (about 20 spoken words each) so the stories add up to the chosen length. */
export const linesPerStory = (minutes: number, stories: number) =>
  Math.max(2, Math.min(8, Math.ceil((minutes * WORDS_PER_MINUTE) / Math.max(1, stories) / 20)));

/** Estimated listening time of a script, in minutes. */
export const spokenMinutes = (texts: string[]) =>
  texts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0) / WORDS_PER_MINUTE;

const SPORTS = /\b(nfl|nba|wnba|mlb|nhl|mls|ncaa|big ten|espn|playoffs?|postseason|preseason|quarterback|touchdown|field goal|home runs?|innings?|world series|super bowl|stanley cup|grand slam|wimbledon|premier league|champions league|la liga|serie a|bundesliga|coach(es|ing)?|draft picks?|halftime|game \d|series opener|season opener|regular season|transfer window|formula 1|f1|nascar|ufc|boxing|wrestling|olympics?|world cup|golf|pga|tennis|soccer|football|baseball|basketball|hockey|volleyball|softball|athletes?|pitcher|striker|linebacker|goalkeeper|rookie|roster|mvp|all-star|free agen(t|cy)|trade deadline|tournament|championships?|semifinals?|quarterfinals?|varsity|scoreboard|box score|standings|league)\b/i;

/** Team nicknames and scorelines: most sports headlines ("Chiefs beat Bills 27-20") never use a sports word. */
const TEAMS = /\b(chiefs|bills|bengals|ravens|browns|steelers|texans|colts|jaguars|broncos|raiders|chargers|dolphins|patriots|cowboys|commanders|packers|bears|lions|vikings|falcons|buccaneers|49ers|niners|seahawks|rams|cardinals|lakers|celtics|warriors|knicks|sixers|76ers|bucks|cavaliers|cavs|pistons|pacers|hornets|raptors|wizards|nuggets|timberwolves|blazers|clippers|mavericks|mavs|grizzlies|pelicans|yankees|red sox|dodgers|cubs|white sox|astros|braves|mets|phillies|padres|brewers|pirates|orioles|blue jays|guardians|tigers|royals|mariners|nationals|marlins|rockies|diamondbacks|bruins|canadiens|maple leafs|blackhawks|penguins|flyers|oilers|canucks|avalanche|panthers|golden knights|red wings|manchester united|man city|liverpool|arsenal|chelsea|tottenham|barcelona|real madrid|juventus|bayern|psg|inter miami)\b/i;
const SCORELINE = /\b\d{1,3}\s?[-–]\s?\d{1,3}\b.*\b(win|wins|beat|beats|defeat|defeats|rout|routs|edge|edges|top|tops|lose|loses|lost|rally|rallies|upset|upsets)\b|\b(win|wins|beat|beats|defeat|defeats|rout|routs|edge|edges|tops?|lose|loses|lost|rally|rallies|upset|upsets)\b.*\b\d{1,3}\s?[-–]\s?\d{1,3}\b/i;
const isSportsText = (t: string) => SPORTS.test(t) || SCORELINE.test(t) || (TEAMS.test(t) && /\b(game|win|wins|beat|beats|loss|lose|season|team|play|plays|score|scores|trade|signs?|injur\w+|coach|playoffs?|rally|rallies|defeat\w*|edge|edges|vs|versus)\b/i.test(t));
const ENTERTAINMENT = /\b(box office|celebrit(y|ies)|album|grammys?|oscars?|emmys?|netflix|trailer|red carpet|reality tv|kardashians?|taylor swift|concert tour|movie review|tv series|streaming hit)\b/i;
const CATEGORY: Record<'SPORTS' | 'ENTERTAINMENT', { test: (t: string) => boolean }> = { SPORTS: { test: isSportsText }, ENTERTAINMENT };
const POLITICS = /\b(congress|senate|senators?|house (republicans|democrats)|democrats?|republicans?|gop|white house|election|midterms?|campaign trail|governors?|legislat(ure|ion|ors?)|supreme court|impeach\w*|lawmakers?|partisan|ballots?|primary (election|race)|prime minister|parliament)\b/i;
const CRIME = /\b(murder(ed|s)?|shooting|shot dead|stabb(ed|ing)|arrest(ed|s)?|homicide|robbery|kidnapp\w*|manslaughter|police say|suspects?|sentenced|convicted|indicted|manhunt|carjacking|assault(ed)?)\b/i;

/**
 * Words a person types under "Topics to avoid" that mean a whole kind of story rather than a keyword. A headline
 * about the Bears never contains the word "sports", so avoiding "sports" must look for what sports stories are about.
 */
const AVOID_KINDS: { label: string; topic: RegExp; content: RegExp }[] = [
  { label: 'Sports', topic: /\b(sports?|sporting|athletics?)\b/, content: { test: isSportsText } as unknown as RegExp },
  { label: 'Celebrity gossip', topic: /\b(celebrit\w*|gossip|entertainment|showbiz|hollywood)\b/, content: ENTERTAINMENT },
  { label: 'Politics', topic: /\b(politics?|political)\b/, content: POLITICS },
  { label: 'Crime', topic: /\bcrimes?\b/, content: CRIME },
];
/** Topics offered as one-tap suggestions on the briefing screen. */
export const AVOID_SUGGESTIONS = AVOID_KINDS.map((k) => k.label);

/** The kinds of story a headline is (Sports, Politics...), by what it is about: to offer "avoid this kind". */
export function storyKinds(h: Pick<Headline, 'title' | 'desc'>): string[] {
  const text = `${h.title} ${h.desc.slice(0, 200)}`;
  return AVOID_KINDS.filter((k) => k.content.test(text)).map((k) => k.label);
}

/**
 * Broad sections such as U.S. or world news mix in sports and celebrity stories. Those are
 * dropped unless one of the user's interests is about them (a section or a matching name).
 */
export function unwantedCategory(h: Pick<Headline, 'title' | 'desc'>, interests: string[]): boolean {
  const text = `${h.title} ${h.desc.slice(0, 200)}`;
  return (Object.keys(CATEGORY) as (keyof typeof CATEGORY)[]).some((cat) =>
    CATEGORY[cat].test(text) && !interests.some((i) => sectionFor(i) === cat || CATEGORY[cat].test(i)));
}

const STOP = new Set(['the', 'and', 'news', 'about', 'with', 'from', 'latest', 'today', 'update', 'updates', 'stories']);

/** A search result really is about the interest: it names at least one of its words. */
export function mentions(h: Pick<Headline, 'title' | 'desc'>, interest: string): boolean {
  const keys = interest.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!keys.length) return true;
  const text = `${h.title} ${h.desc}`.toLowerCase();
  return keys.some((k) => text.includes(k.length > 4 ? k.slice(0, -1) : k));
}

/**
 * Keeps only stories that fit this interest: no sports or celebrity items unless an interest
 * is about them (in sections and in searches alike: a search for a city or a state is mostly
 * its teams' results otherwise), and search results that really name the interest.
 */
export function onTopic(items: Headline[], { interest, interests, fromSection }: { interest: string; interests: string[]; fromSection: boolean }): Headline[] {
  // An interest that is itself a team or player ("Chicago Bears") keeps its stories: the
  // headline names the whole interest, not just one of its words (a place like "Austin Texas").
  const named = (h: Headline) => h.title.toLowerCase().includes(interest.toLowerCase().trim());
  return items.filter((h) => (fromSection
    ? !unwantedCategory(h, interests)
    : mentions(h, interest) && (!unwantedCategory(h, interests) || named(h))));
}

/**
 * True when a story is about a topic the user wants to avoid: every word of the avoided topic
 * appears in the headline or summary (so "royal family" does not drop every story with "family").
 */
export function avoided(h: Pick<Headline, 'title' | 'desc'>, avoid: string[]): boolean {
  const text = `${h.title} ${h.desc}`.toLowerCase();
  const kinds = `${h.title} ${h.desc.slice(0, 200)}`;
  return avoid.some((topic) => {
    const kind = AVOID_KINDS.find((k) => k.topic.test(topic.trim().toLowerCase()));
    if (kind) return kind.content.test(kinds);
    const keys = topic.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
    return keys.length > 0 && keys.every((w) => text.includes(w.length > 4 ? w.slice(0, -1) : w));
  });
}

/**
 * Spoken words a story can carry from its sources (about one script line, ~20 words, per
 * 80 characters of source, never more than the lines per story): used to keep adding
 * stories until the briefing really fills the chosen length.
 */
export const storyWords = (sourceChars: number, maxLines: number) =>
  Math.min(maxLines, Math.max(4, Math.round(sourceChars / 80))) * 20;

/** Spreads the story budget over the interests in turn, so every interest is covered. */
export function pickStories(perInterest: Headline[][], budget: number): { interest: number; headline: Headline }[] {
  const picked: { interest: number; headline: Headline }[] = [];
  for (let round = 0; picked.length < budget; round++) {
    let added = false;
    perInterest.forEach((list, interest) => {
      if (picked.length < budget && list[round]) { picked.push({ interest, headline: list[round] }); added = true; }
    });
    if (!added) break;
  }
  return picked;
}

/** The question put to the AI: which of these numbered headlines are about a topic the listener wants left out. */
export function screenPrompt(headlines: string[], avoid: string[]): { system: string; user: string } {
  return {
    system: 'You screen news headlines for a listener. Answer only with numbers.',
    user: `The listener does NOT want any story about: ${avoid.join(', ')}.\nBe strict. A story counts if it is about the topic in any way, even when the word is never used (for sports: any team, player, coach, game, score, league, transfer or season; for politics: any politician, party, election or government fight).\n\nHeadlines:\n${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nReply with the numbers of the headlines to LEFT OUT, separated by commas, or NONE.`,
  };
}

/** The zero-based positions the AI said to leave out (ignores anything that is not a valid number). */
export function parseScreenReply(reply: string, count: number): Set<number> {
  const out = new Set<number>();
  if (/^\s*none\b/i.test(reply)) return out;
  for (const m of reply.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (n >= 1 && n <= count) out.add(n - 1);
  }
  return out;
}
