import { sectionFor, feedsFor, isPromotional, splitOutlet, cleanHeadlines, pickStories, storyBudget, similarity, linesPerStory, onTopic, spokenMinutes, avoided } from '../../../src/atlasTools/newsSources';
import { parseRss } from '../../../src/atlasTools/dailyBrief';

const NOW = Date.parse('2026-10-19T15:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600e3).toUTCString();

// Google News section feed shape: "Title - Outlet" plus a <source> tag.
const GOOGLE = `<rss><channel>
<item><title>Senate passes funding bill to avert shutdown - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>${hoursAgo(3)}</pubDate><description>&lt;a href="x"&gt;Senate passes funding bill&lt;/a&gt;</description><source url="https://www.reuters.com">Reuters</source></item>
<item><title>Senate approves stopgap funding bill, averting shutdown - AP News</title><link>https://news.google.com/rss/articles/def</link><pubDate>${hoursAgo(2)}</pubDate><description>dup</description><source url="https://apnews.com">AP News</source></item>
<item><title>Old story from last week - CNN</title><link>https://news.google.com/rss/articles/old</link><pubDate>${hoursAgo(24 * 6)}</pubDate><description>old</description><source url="https://cnn.com">CNN</source></item>
</channel></rss>`;

// Bing News search shape: outlet in <News:Source>, links are redirects carrying the real URL.
const BING = `<rss xmlns:News="https://www.bing.com/news/search?q=United+States&amp;format=rss"><channel>
<item><title>EDvance Software Announces AI Platform for United States Schools</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.globenewswire.com%2fnews-release%2f2026%2f10%2f19%2fedvance</link><description>EDvance today announced...</description><pubDate>${hoursAgo(1)}</pubDate><News:Source>GlobeNewswire</News:Source></item>
<item><title>Sponsored: Best credit cards to buy this fall</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fexample.com</link><description>Partner content</description><pubDate>${hoursAgo(1)}</pubDate><News:Source>Example Deals</News:Source></item>
<item><title>Supreme Court hears arguments on tariff case</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fwww.npr.org%2f2026%2f10%2f19%2ftariffs</link><description>The justices weighed...</description><pubDate>${hoursAgo(4)}</pubDate><News:Source>NPR</News:Source></item>
</channel></rss>`;

describe('daily briefing news sources', () => {
  it('uses top-story sections for broad interests and search for specific ones', () => {
    expect(sectionFor('United States')).toBe('NATION');
    expect(sectionFor('U.S. news')).toBe('NATION');
    expect(sectionFor('international news')).toBe('WORLD');
    expect(sectionFor('world')).toBe('WORLD');
    expect(sectionFor('tech')).toBe('TECHNOLOGY');
    expect(sectionFor('news')).toBe('NATION');
    expect(sectionFor('the Chicago Bears')).toBeNull();
    expect(feedsFor('United States')[0]).toContain('/headlines/section/topic/NATION');
    expect(feedsFor('Chicago Bears')[0]).toContain('/rss/search?q=Chicago%20Bears');
  });

  it('reads the outlet from both Google <source> and Bing <News:Source>', () => {
    expect(parseRss(GOOGLE)[0].source).toBe('Reuters');
    expect(parseRss(BING)[2].source).toBe('NPR');
  });

  it('drops press releases and sponsored/shopping items (the "EDvance software" problem)', () => {
    const items = parseRss(BING);
    expect(isPromotional(items[0])).toBe(true); // GlobeNewswire press release
    expect(isPromotional(items[1])).toBe(true); // sponsored deals
    expect(isPromotional(items[2])).toBe(false);
    expect(cleanHeadlines(items, NOW).map(h => h.title)).toEqual(['Supreme Court hears arguments on tariff case']);
  });

  it('moves the outlet out of Google titles, merges the same story from two outlets, drops old news', () => {
    expect(splitOutlet({ title: 'A big story - The Guardian', desc: '' })).toMatchObject({ title: 'A big story', source: 'The Guardian' });
    const clean = cleanHeadlines(parseRss(GOOGLE), NOW);
    expect(clean).toHaveLength(1);
    expect(clean[0].source).toBe('Reuters');
    expect(similarity('Senate passes funding bill to avert shutdown', 'Senate approves stopgap funding bill, averting shutdown')).toBeGreaterThanOrEqual(0.6);
  });

  it('does not repeat a story another interest already covers', () => {
    const seen = ['Senate passes funding bill to avert shutdown'];
    expect(cleanHeadlines(parseRss(GOOGLE), NOW, seen)).toHaveLength(0);
  });

  it('covers every interest before adding a second story to any of them', () => {
    const h = (t: string) => ({ title: t, desc: '' });
    const picked = pickStories([[h('us1'), h('us2'), h('us3')], [h('w1')], [h('b1'), h('b2')]], 5);
    expect(picked.map(p => p.headline.title)).toEqual(['us1', 'w1', 'b1', 'us2', 'b2']);
    expect(storyBudget(1)).toBe(3);
    expect(storyBudget(5)).toBe(13);
    expect(storyBudget(10, false)).toBe(20);
    expect(storyBudget(30)).toBe(20);
  });

  it('sizes the script to the length the user picked', () => {
    // 10 minutes over 20 stories: about 75 words each, about 4 lines of 20 words. A story is never read at length.
    expect(linesPerStory(10, 20)).toBe(4);
    expect(linesPerStory(15, 3)).toBe(5);
    expect(spokenMinutes(Array(75).fill('word '.repeat(20)))).toBe(10);
  });

  it('keeps sports and celebrity stories out of U.S. and world news unless asked for, and search results on topic', () => {
    const h = (title: string) => ({ title, desc: '' });
    const section = [h('Senate passes the budget bill'), h('Yankees beat Red Sox in MLB opener'), h('Storm closes highways in Texas')];
    expect(onTopic(section, { interest: 'United States', interests: ['United States', 'international news'], fromSection: true }).map(x => x.title))
      .toEqual(['Senate passes the budget bill', 'Storm closes highways in Texas']);
    expect(onTopic(section, { interest: 'United States', interests: ['United States', 'sports'], fromSection: true })).toHaveLength(3);
    const search = [h('Chicago Bears sign new quarterback'), h('Stock market closes higher')];
    expect(onTopic(search, { interest: 'Chicago Bears', interests: ['Chicago Bears'], fromSection: false }).map(x => x.title)).toEqual(['Chicago Bears sign new quarterback']);
  });
});

describe('the briefing does not drift into sports', () => {
  const h = (title: string) => ({ title, desc: '' });
  it('drops local team results from a search for a place, unless sports is an interest', () => {
    const items = [
      h('Austin city council approves new transit plan'),
      h('Texas Longhorns coach praises defense after win'),
      h('Austin FC tops league standings after weekend'),
      h('Texas legislature debates property tax relief'),
    ];
    const interests = ['Austin Texas', 'climate'];
    expect(onTopic(items, { interest: 'Austin Texas', interests, fromSection: false }).map((x: any) => x.title))
      .toEqual(['Austin city council approves new transit plan', 'Texas legislature debates property tax relief']);
    expect(onTopic(items, { interest: 'Austin Texas', interests: ['Austin Texas', 'sports'], fromSection: false })).toHaveLength(4);
  });
  it('keeps business news about the SEC and comparisons', () => {
    const items = [h('SEC fines bank over reporting'), h('Renting vs. buying: what the numbers say')];
    expect(onTopic(items, { interest: 'business', interests: ['business'], fromSection: true })).toHaveLength(2);
  });
});

describe('topics to avoid', () => {
  const h = (title: string, desc = '') => ({ title, desc });
  it('"sports" leaves out sports stories even though they never say the word', () => {
    expect(avoided(h('Bears beat Packers in overtime thriller', 'Quarterback throws for 300 yards'), ['Sports'])).toBe(true);
    expect(avoided(h('Lakers trade deadline: roster moves explained'), ['sports'])).toBe(true);
    expect(avoided(h('City council approves new transit plan'), ['Sports'])).toBe(false);
  });

  it('knows celebrity gossip, politics and crime as kinds of story', () => {
    expect(avoided(h('Taylor Swift announces concert tour dates'), ['celebrity gossip'])).toBe(true);
    expect(avoided(h('Senate passes funding bill after long debate'), ['Politics'])).toBe(true);
    expect(avoided(h('Police say suspect arrested after robbery'), ['crime'])).toBe(true);
    expect(avoided(h('New battery doubles phone life'), ['celebrity gossip', 'politics', 'crime'])).toBe(false);
  });

  it('still matches other topics by their words', () => {
    expect(avoided(h('Bitcoin price hits new high as crypto rallies'), ['crypto'])).toBe(true);
    expect(avoided(h('Royal family attends charity event'), ['royal family'])).toBe(true);
    expect(avoided(h('Family recipes for the holidays'), ['royal family'])).toBe(false);
  });
});

describe('avoiding sports', () => {
  const h = (title: string, desc = '') => ({ title, desc });
  it('drops headlines about games that never say "sports"', () => {
    for (const t of ['Chiefs beat Bills 27-20 in overtime', 'Lakers rally past Celtics', 'Yankees vs Red Sox: what to watch', 'City edge Arsenal 2-1', 'Quarterback signs three-year deal']) {
      expect(avoided(h(t), ['sports'])).toBe(true);
    }
  });
  it('understands "sports news" or "all sports" as sports', () => {
    expect(avoided(h('Chiefs beat Bills 27-20'), ['sports news'])).toBe(true);
    expect(avoided(h('Chiefs beat Bills 27-20'), ['All sports'])).toBe(true);
  });
  it('keeps ordinary stories', () => {
    expect(avoided(h('Heat wave grips the Midwest as temperatures hit 100'), ['sports'])).toBe(false);
    expect(avoided(h('Company beats earnings expectations'), ['sports'])).toBe(false);
    expect(avoided(h('Scientists find water on Mars'), ['sports'])).toBe(false);
  });
});

describe('AI screening of headlines', () => {
  it('reads the numbers the AI names, ignoring anything else', () => {
    const { parseScreenReply } = require('../../../src/atlasTools/newsSources');
    expect([...parseScreenReply('1, 3 and 9', 4)]).toEqual([0, 2]);
    expect([...parseScreenReply('NONE', 4)]).toEqual([]);
    expect([...parseScreenReply('Headlines 2 (a game recap), 0, 7', 5)]).toEqual([1]);
  });
  it('asks about the topics to avoid and lists every headline by number', () => {
    const { screenPrompt } = require('../../../src/atlasTools/newsSources');
    const { user } = screenPrompt(['Bears win', 'Mars water found'], ['sports']);
    expect(user).toContain('sports');
    expect(user).toContain('1. Bears win');
    expect(user).toContain('2. Mars water found');
  });
});
