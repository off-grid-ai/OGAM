import { Alert, NativeModules, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';

/**
 * Atlas assistant tools: files, web pages, calendar, memory.
 * Anything that changes something (writing a file, adding an event) asks you first.
 */
const Native: any = NativeModules.AtlasDevice;
const TEXT_EXT = /\.(txt|md|markdown|html?|css|js|ts|json|csv|xml|ya?ml|ini|log|py|java|kt|c|cpp|h|sh)$/i;
const MAX_READ = 120_000;

export async function hasAllFiles(): Promise<boolean> {
  try { return !!(await Native?.hasAllFilesAccess()); } catch { return false; }
}
export async function requestAllFiles(): Promise<void> { await Native?.requestAllFilesAccess(); }

/** Workspace: Documents/Atlas when "All files access" is on, otherwise the app's own folder. */
export async function workspaceDir(): Promise<string> {
  const dir = (await hasAllFiles()) ? `${await Native.storageRoot()}/Documents/Atlas` : `${RNFS.ExternalDirectoryPath}/Workspace`;
  await RNFS.mkdir(dir);
  return dir;
}

async function resolvePath(p?: string): Promise<string> {
  const ws = await workspaceDir();
  if (!p || p === '.' || p === '/') return ws;
  let path = p.trim().replace(/^file:\/\//, '');
  if (!path.startsWith('/')) path = `${ws}/${path}`;
  path = path.replace(/\/+/g, '/');
  if (path.includes('/../') || path.endsWith('/..')) throw new Error('Paths with .. are not allowed.');
  const root = (await hasAllFiles()) ? await Native.storageRoot() : RNFS.ExternalDirectoryPath;
  const inside = (r: string) => path === r || path.startsWith(`${r}/`);
  if (!inside(root) && !inside(RNFS.ExternalDirectoryPath) && !inside(RNFS.DocumentDirectoryPath)) {
    throw new Error(`Outside allowed storage. ${(await hasAllFiles()) ? '' : 'Turn on "All files access" in Settings > Assistant access to reach your other folders.'}`);
  }
  return path;
}

/** How long a question to the user waits. An unseen prompt (app in the background, another sheet on top) held the whole reply forever. */
export const CONFIRM_TIMEOUT_MS = 2 * 60 * 1000;

export function confirm(title: string, message: string, ok = 'Allow'): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), CONFIRM_TIMEOUT_MS); // no answer counts as Deny
    const answer = (v: boolean) => { clearTimeout(timer); resolve(v); };
    Alert.alert(title, message, [
      { text: 'Deny', style: 'cancel', onPress: () => answer(false) },
      { text: ok, onPress: () => answer(true) },
    ], { cancelable: true, onDismiss: () => answer(false) });
  });
}

const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export async function listFiles(path?: string): Promise<string> {
  const dir = await resolvePath(path);
  if (!(await RNFS.exists(dir))) return `Folder not found: ${dir}`;
  const items = (await RNFS.readDir(dir)).sort((a: any, b: any) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  if (!items.length) return `${dir} is empty.`;
  return `${dir}\n` + items.slice(0, 200).map((it: any) => (it.isDirectory() ? `[folder] ${it.name}/` : `${it.name} (${kb(Number(it.size))})`)).join('\n');
}

/** Last time the assistant read one of your files (used to double-check web requests after it). */
export let lastFileRead = 0;

/** How much file text fits in one tool result for the loaded model (about a third of its memory). */
function readBudget(): number {
  try {
    const { llmService } = require('../services/llm');
    const ctx = Number(llmService.getPerformanceSettings?.()?.contextLength) || 4096;
    return Math.max(3000, Math.min(40000, Math.floor(ctx * 4 * 0.35)));
  } catch { return 6000; }
}

async function fullText(p: string, ext: string): Promise<string> {
  const { OFFICE_EXTENSIONS, extractOffice } = require('../services/officeExtract');
  if (OFFICE_EXTENSIONS.includes(ext)) return extractOffice(p, ext, MAX_READ);
  if (ext === '.pdf') {
    const { pdfExtractor } = require('../services/pdfExtractor');
    const t: string = await pdfExtractor.extractText(p, MAX_READ);
    if (!t) throw new Error('No text found in this PDF (it may be scanned pictures).');
    return t;
  }
  if (!TEXT_EXT.test(p)) throw new Error('This tool reads text, CSV, JSON, code, PDF, Word, PowerPoint, Excel, OpenDocument, EPUB and RTF files.');
  return (await RNFS.readFile(p, 'utf8')).slice(0, MAX_READ);
}

export async function readFile(path: string, offset = 0): Promise<string> {
  const p = await resolvePath(path);
  if (!(await RNFS.exists(p))) return `File not found: ${p}`;
  const ext = `.${p.split('.').pop()?.toLowerCase()}`;
  let t: string;
  try { t = await fullText(p, ext); } catch (e: any) { return `Could not read this file: ${e?.message || e}`; }
  lastFileRead = Date.now();
  const start = Math.max(0, Math.floor(offset) || 0);
  const end = Math.min(t.length, start + readBudget());
  const part = t.slice(start, end);
  return end < t.length || start > 0
    ? `${part}\n\n(Showing characters ${start}-${end} of ${t.length}. To read more, call read_file again with offset=${end}.)`
    : part;
}

export async function writeFile(path: string, content: string, append = false): Promise<string> {
  const p = await resolvePath(path);
  const exists = await RNFS.exists(p);
  const ok = await confirm(
    append ? 'Add to file?' : exists ? 'Replace file?' : 'Create file?',
    `${p}\n\n${content.slice(0, 400)}${content.length > 400 ? '\n...' : ''}`,
    append ? 'Add' : exists ? 'Replace' : 'Create',
  );
  if (!ok) return 'The user declined, or did not answer in time. Nothing was written.';
  await RNFS.mkdir(p.substring(0, p.lastIndexOf('/')));
  if (append && exists) await RNFS.appendFile(p, content, 'utf8');
  else await RNFS.writeFile(p, content, 'utf8');
  return `Saved ${p} (${content.length} characters).`;
}

export async function createWebPage(name: string, html: string): Promise<string> {
  const slug = (name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
  const ws = await workspaceDir();
  const page = /<html[\s>]/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head><body>${html}</body></html>`;
  const res = await writeFile(`${ws}/Sites/${slug}/index.html`, page);
  if (res.startsWith('The user declined')) return res;
  const path = `${ws}/Sites/${slug}/index.html`;
  try { await Native?.openFile(path); } catch { /* opening is optional */ }
  return `${res}\nOpened it for preview. Path: ${path}`;
}

export async function openFile(path: string): Promise<string> {
  const p = await resolvePath(path);
  if (!(await RNFS.exists(p))) return `File not found: ${p}`;
  await Native.openFile(p);
  return `Opened ${p}.`;
}

async function calendarPermission(): Promise<boolean> {
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_CALENDAR);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export async function calendarEvents(daysAhead = 7, daysBack = 0): Promise<string> {
  if (!(await calendarPermission())) return 'Calendar permission was not granted.';
  const start = Date.now() - daysBack * 86400000;
  const end = Date.now() + Math.max(1, daysAhead) * 86400000;
  const ev: any[] = await Native.calendarEvents(start, end);
  if (!ev.length) return 'No events in that period.';
  const f = (ms: number, allDay: boolean) => new Date(ms).toLocaleString(undefined, allDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return ev.map((e) => `- ${f(e.begin, e.allDay)}${e.allDay ? ' (all day)' : ` to ${new Date(e.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`).join('\n');
}

export async function addCalendarEvent(title: string, start: string, end?: string, location = '', description = ''): Promise<string> {
  const s = Date.parse(start);
  if (isNaN(s)) return 'Could not understand the start time. Use a format like 2026-10-05T14:00.';
  const e = end && !isNaN(Date.parse(end)) ? Date.parse(end) : s + 3600000;
  await Native.addCalendarEvent(title, s, e, location, description);
  return 'Opened the calendar with the event filled in. The user confirms and saves it there.';
}

/** The link that opens the phone's Messages or Email app with a draft filled in (nothing is sent from here). */
export function messageUrl(kind: 'text' | 'email' | 'call', body: string, to = '', subject = ''): string {
  if (kind === 'call') return `tel:${to.replace(/[^\d+*#]/g, '')}`;
  if (kind === 'text') return `sms:${to.replace(/[^\d+,;]/g, '')}?body=${encodeURIComponent(body)}`;
  const recipient = to.replace(/[^\w@+.,;-]/g, '');
  return `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Opens Messages or Email with the draft ready; the user reads it and presses send themselves. */
export async function draftMessage(kind: string, body: string, to = '', subject = ''): Promise<string> {
  const which = kind === 'email' ? 'email' : kind === 'call' ? 'call' : 'text';
  if (which === 'call' && !to.replace(/\D/g, '')) return 'There is no phone number to call. Ask the user for it.';
  if (which !== 'call' && !body.trim()) return 'The draft has no text. Write the message first.';
  const { Linking } = require('react-native');
  try {
    await Linking.openURL(messageUrl(which, body, to, subject));
  } catch {
    return `This phone could not open ${which === 'email' ? 'an email app' : which === 'call' ? 'the phone app' : 'a messaging app'}.`;
  }
  if (which === 'call') return 'Opened the phone app with the number filled in. The call starts only when the user presses call.';
  return `Opened ${which === 'email' ? 'the email app' : 'Messages'} with the draft filled in. Nothing is sent until the user presses send there.`;
}

/** Agent memory: facts the user wants the active agent to remember (stored on the phone). */
export async function rememberFact(fact: string): Promise<string> {
  const { useAgentStore } = require('../stores/agentStore');
  const st = useAgentStore.getState();
  const agent = st.agents.find((a: any) => a.id === st.activeAgentId);
  try {
    const { useChatStore } = require('../stores/chatStore');
    const cs = useChatStore.getState();
    if (cs.conversations.find((c: any) => c.id === cs.activeConversationId)?.isPrivate) {
      return 'Not saved: this is a private chat, so nothing from it is remembered. (Tell the user they can say it again in a normal chat if they want it remembered.)';
    }
  } catch { /* ignore */ }
  // No agent is the default for new chats: keep the fact with the user's "About you" notes so every chat has it.
  if (!agent) {
    const { useAboutMe } = require('../stores/aboutMeStore');
    return useAboutMe.getState().addMemory(fact) === 'exists' ? 'Already remembered.' : `Remembered: ${fact.trim()}`;
  }
  const memories: string[] = agent.memories || [];
  if (memories.some((m) => m.toLowerCase() === fact.toLowerCase())) return 'Already remembered.';
  st.updateAgent(agent.id, { memories: [...memories, fact.trim()].slice(-100) });
  return `Remembered: ${fact.trim()}`;
}
