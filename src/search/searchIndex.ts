/**
 * Search across the app: chats (titles and what was said), projects, downloaded models, and the screens and settings
 * pages (found by their name or by what people call them: "dark mode", "delete files", "PIN"). Pure, so ranking is tested
 * without a device. Locked chats and the hidden course project are never searched.
 */
export type SearchKind = 'screen' | 'chat' | 'project' | 'model';
export interface SearchHit { kind: SearchKind; id: string; title: string; detail?: string; route: string; params?: object; icon: string; score: number }

export interface Destination { title: string; route: string; params?: object; icon: string; keywords: string }

/** Screens and settings pages, with the words people use for them. */
export const DESTINATIONS: Destination[] = [
  { title: 'Learn a language', route: 'Language', icon: 'book', keywords: 'lessons spanish french german course board words vocabulary' },
  { title: 'Practice call (language)', route: 'Call', icon: 'phone', keywords: 'speak talk conversation language practice call' },
  { title: 'Word book', route: 'WordBook', icon: 'bookmark', keywords: 'saved words vocabulary language' },
  { title: 'Skills', route: 'Skills', icon: 'zap', keywords: 'skill skill.md claude openclaw agent instructions slash command import' },
  { title: 'Daily briefing', route: 'DailyBrief', icon: 'sun', keywords: 'news podcast headlines topics avoid sports' },
  { title: 'Recorder', route: 'Recorder', icon: 'mic', keywords: 'record meeting transcript speakers audio' },
  { title: 'Appearance & AI style', route: 'Appearance', icon: 'sliders', keywords: 'theme dark mode light font text size color accent chat layout bubbles bottom bar tabs answer length tone' },
  { title: 'Storage', route: 'StorageSettings', icon: 'hard-drive', keywords: 'space delete files cache free models disk' },
  { title: 'Security & PIN', route: 'SecuritySettings', icon: 'lock', keywords: 'pin lock password protect biometric fingerprint private' },
  { title: 'Text generation settings', route: 'ModelSettings', icon: 'cpu', keywords: 'threads gpu cpu context temperature speed backend vulkan opencl npu flash attention warm up' },
  { title: 'Remote servers', route: 'RemoteServers', icon: 'server', keywords: 'ollama lm studio openai api key server network' },
  { title: 'Device info', route: 'DeviceInfo', icon: 'smartphone', keywords: 'ram memory phone specs hardware battery' },
  { title: 'Downloads', route: 'DownloadManager', icon: 'download', keywords: 'download progress models queue' },
  { title: 'My models', route: 'MyModels', icon: 'layers', keywords: 'downloaded models speed test delete' },
  { title: 'Image gallery', route: 'Gallery', icon: 'image', keywords: 'pictures generated images photos' },
  { title: 'Presentations', route: 'Presentations', icon: 'monitor', keywords: 'slides powerpoint pptx pdf deck' },
  { title: 'Maps', route: 'Maps', icon: 'map', keywords: 'offline map places navigation' },
  { title: 'Compass', route: 'Compass', icon: 'compass', keywords: 'direction north sensor' },
  { title: 'Emergency mode', route: 'Emergency', icon: 'alert-triangle', keywords: 'sos survival first aid help flashlight' },
  { title: 'Offline library', route: 'OfflineLibrary', icon: 'book-open', keywords: 'wikipedia books packs offline reference' },
  { title: 'Survival manual', route: 'SurvivalManual', icon: 'life-buoy', keywords: 'first aid water shelter fire guide' },
  { title: 'Phrase trainer', route: 'Phrases', icon: 'globe', keywords: 'travel phrases translate' },
  { title: 'Tools', route: 'Tools', icon: 'tool', keywords: 'web search calculator tools enable' },
  { title: 'About Atlas', route: 'About', icon: 'info', keywords: 'version build licence' },
];

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/** 3 = starts with the query, 2 = contains it, 1 = a word of the query is found; 0 = not a match. */
function rank(text: string, q: string, words: string[]): number {
  const t = norm(text);
  if (t.startsWith(q)) return 3;
  if (t.includes(q)) return 2;
  return words.length > 1 && words.every((w) => t.includes(w)) ? 1 : 0;
}

export interface SearchData {
  conversations: { id: string; title: string; messages: { role: string; content: string; isSystemInfo?: boolean }[]; pinVerifier?: string; updatedAt?: string }[];
  projects: { id: string; name: string; description: string; course?: string }[];
  models: { id: string; name: string }[];
}

const snippet = (text: string, q: string) => {
  const at = norm(text).indexOf(q);
  const from = Math.max(0, at - 30);
  return `${from > 0 ? '...' : ''}${text.slice(from, from + 90).replace(/\s+/g, ' ').trim()}`;
};

export function searchEverything(query: string, data: SearchData, limit = 6): SearchHit[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];

  for (const d of DESTINATIONS) {
    const score = Math.max(rank(d.title, q, words) * 3, rank(d.keywords, q, words) * 2, words.length > 1 ? 0 : (norm(d.keywords).split(/\s+/).some((k) => k.startsWith(q)) ? 4 : 0));
    if (score) hits.push({ kind: 'screen', id: d.route, title: d.title, route: d.route, params: d.params, icon: d.icon, score });
  }
  for (const c of data.conversations) {
    if (c.pinVerifier) continue;
    const byTitle = rank(c.title, q, words);
    const said = c.messages.find((m) => (m.role === 'user' || m.role === 'assistant') && !m.isSystemInfo && norm(m.content).includes(q));
    if (byTitle || said) {
      hits.push({ kind: 'chat', id: c.id, title: c.title || 'Chat', detail: byTitle ? undefined : snippet(said!.content, q), route: 'Chat', params: { conversationId: c.id }, icon: 'message-circle', score: byTitle ? byTitle * 3 : 1 });
    }
  }
  for (const p of data.projects) {
    if (p.course === 'language') continue;
    const score = Math.max(rank(p.name, q, words) * 3, rank(p.description, q, words));
    if (score) hits.push({ kind: 'project', id: p.id, title: p.name, detail: p.description || undefined, route: 'ProjectDetail', params: { projectId: p.id }, icon: 'folder', score });
  }
  for (const m of data.models) {
    const score = rank(m.name, q, words) * 3;
    if (score) hits.push({ kind: 'model', id: m.id, title: m.name, route: 'ModelTest', params: { modelId: m.id }, icon: 'cpu', score });
  }
  const order: SearchKind[] = ['screen', 'chat', 'project', 'model'];
  return order.flatMap((k) => hits.filter((h) => h.kind === k).sort((a, b) => b.score - a.score).slice(0, limit));
}
