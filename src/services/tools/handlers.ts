import { videoSeam } from '../../bootstrap/videoSeam';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { describeTurnStatus } from '@offgrid/rag/documents';
import { ToolCall, ToolResult } from './types';
import { useDocumentTurnStatusStore } from '../documents/progressStore';
import type * as DocumentChatTurn from '../documents/chatTurn';
import logger from '../../utils/logger';
import { featureUsed } from '../analytics/analytics';
import { toolFeature } from '../analytics/values';

function makeResult(
  call: ToolCall,
  start: number,
  opts: { content: string; error?: string },
): ToolResult {
  return {
    toolCallId: call.id,
    name: call.name,
    content: opts.content,
    error: opts.error,
    durationMs: Date.now() - start,
  };
}
function requireString(call: ToolCall, param: string): string | null {
  const val = call.arguments[param];
  return val && typeof val === 'string' && val.trim() ? val.trim() : null;
}

export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  const start = Date.now();
  featureUsed(toolFeature(call.name));
  try {
    const content = await dispatchTool(call);
    return makeResult(call, start, { content });
  } catch (error: any) {
    logger.error(`[Tools] Error executing ${call.name}:`, error);
    return makeResult(call, start, {
      content: '',
      error: error.message || 'Tool execution failed',
    });
  }
}

async function dispatchTool(call: ToolCall): Promise<string> {
  switch (call.name) {
    case 'generate_video': {
      const prompt = requireString(call, 'prompt');
      if (!prompt || !call.context?.conversationId)
        throw new Error('A video prompt and chat are required.');
      videoSeam.defer(call.context.conversationId, {
        prompt,
        ...(call.arguments.start_image === 'last_image'
          ? { startImage: 'last_image' as const }
          : {}),
      });
      return 'Video generation is queued after this reply. The video will appear in this chat when complete.';
    }
    case 'make_film': {
      const sentence = requireString(call, 'sentence');
      if (!sentence || !call.context?.conversationId)
        throw new Error('A film sentence and chat are required.');
      videoSeam.defer(call.context.conversationId, {
        prompt: sentence,
        film: true,
      });
      return 'A draft film is created after this reply. The person reviews its shots before it renders.';
    }
    case 'web_search': {
      const q = requireString(call, 'query');
      if (!q) throw new Error('Missing required parameter: query');
      return handleWebSearch(q);
    }
    case 'calculator':
      return handleCalculator(call.arguments.expression);
    case 'get_current_datetime':
      return handleGetDatetime(call.arguments.timezone);
    case 'get_device_info':
      return handleGetDeviceInfo(call.arguments.info_type);
    case 'search_knowledge_base': {
      const q = requireString(call, 'query');
      if (!q) throw new Error('Missing required parameter: query');
      return handleSearchKnowledgeBase(
        q,
        call.context?.conversationId,
        call.context?.projectId,
      );
    }
    case 'read_url': {
      const url = requireString(call, 'url');
      if (!url) throw new Error('Missing required parameter: url');
      return handleReadUrl(url);
    }
    default:
      throw new Error(`Unknown tool: ${call.name}`);
  }
}

/**
 * Search providers in the order they are asked. Brave's results page started answering scripted
 * requests with HTTP 429 and a captcha, so every search failed ("tell Gemma to perform a web search
 * it fails"). Bing's RSS feed and DuckDuckGo Lite answer plain requests; Brave stays last.
 */
const SEARCH_TIMEOUT_MS = 8000;
const PLAIN_AGENT = 'Mozilla/5.0';
const BROWSER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

interface SearchProvider {
  name: string;
  request(query: string): { url: string; init: RequestInit };
  parse(body: string): SearchResult[];
}

const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  {
    name: 'bing',
    request: q => ({
      url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(q)}`,
      init: {
        headers: { 'User-Agent': PLAIN_AGENT, Accept: 'application/rss+xml' },
      },
    }),
    parse: parseBingRss,
  },
  {
    name: 'duckduckgo',
    request: q => ({
      url: 'https://lite.duckduckgo.com/lite/',
      init: {
        method: 'POST',
        headers: {
          'User-Agent': PLAIN_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `q=${encodeURIComponent(q)}`,
      },
    }),
    parse: parseDuckDuckGoLite,
  },
  {
    name: 'brave',
    request: q => ({
      url: `https://search.brave.com/search?q=${encodeURIComponent(
        q,
      )}&source=web`,
      init: { headers: { 'User-Agent': BROWSER_AGENT, Accept: 'text/html' } },
    }),
    parse: parseBraveResults,
  },
];

/** A bot check served instead of results: the provider refused, whatever the status says. */
function isChallengePage(body: string): boolean {
  return /anomaly-modal|captcha/i.test(body);
}

type ProviderOutcome = { results: SearchResult[] } | { refused: string };

async function askProvider(
  provider: SearchProvider,
  query: string,
): Promise<ProviderOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const { url, init } = provider.request(query);
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status >= 400) return { refused: `HTTP ${response.status}` };
    const body = await response.text();
    if (isChallengePage(body)) return { refused: 'a bot check' };
    return { results: provider.parse(body) };
  } catch (error) {
    return { refused: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleWebSearch(query: string): Promise<string> {
  const refusals: string[] = [];
  let anyAnswered = false;
  for (const provider of SEARCH_PROVIDERS) {
    const outcome = await askProvider(provider, query);
    if ('refused' in outcome) {
      logger.warn(`[web_search] ${provider.name} refused: ${outcome.refused}`);
      refusals.push(outcome.refused);
      continue;
    }
    anyAnswered = true;
    if (outcome.results.length > 0) {
      return outcome.results
        .slice(0, 5)
        .map((r, i) => {
          const heading = r.url ? `[${r.title}](${r.url})` : r.title;
          return `${i + 1}. ${heading}\n   ${r.snippet}`;
        })
        .join('\n\n');
    }
  }
  // A refused or rate-limited search has no results to read. Say the search failed, instead of telling
  // the model that the web has nothing on this query.
  if (!anyAnswered) {
    throw new Error(
      `Web search is unavailable right now (${
        refusals[refusals.length - 1] ?? 'no answer'
      }).`,
    );
  }
  return `No results found for "${query}".`;
}

type SearchResult = { title: string; snippet: string; url?: string };

function stripHtmlTags(html: string): string {
  let result = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') {
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) result += ch;
  }
  return result;
}

function parseResultBlock(block: string): SearchResult | null {
  const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
  const url = urlMatch ? decodeHTMLEntities(urlMatch[1]) : '';

  const titleMatch =
    block.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</) ||
    block.match(/<a[^>]*href="https?:\/\/[^"]*"[^>]*>\s*<span[^>]*>([^<]+)/);
  const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : '';

  const snippetMatch =
    block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
    block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const snippet = snippetMatch
    ? decodeHTMLEntities(stripHtmlTags(snippetMatch[1]).trim())
    : '';

  if (!title && !snippet) return null;
  return {
    title: title || '(no title)',
    snippet: snippet || '(no snippet)',
    url,
  };
}

function textOf(fragment: string): string {
  // RSS escapes the markup inside it (&lt;b&gt;), so decode before taking the tags out.
  return decodeHTMLEntities(stripHtmlTags(decodeHTMLEntities(fragment)))
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function parseBingRss(xml: string): SearchResult[] {
  const results: SearchResult[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    if (results.length >= 5) break;
    const title = /<title>([\s\S]*?)<\/title>/i.exec(item)?.[1];
    const url = /<link>([\s\S]*?)<\/link>/i.exec(item)?.[1];
    if (!title || !url) continue;
    const description =
      /<description>([\s\S]*?)<\/description>/i.exec(item)?.[1] ?? '';
    results.push({
      title: textOf(title),
      url: textOf(url),
      snippet: textOf(description) || '(no snippet)',
    });
  }
  return results;
}

function parseDuckDuckGoLite(html: string): SearchResult[] {
  const links = [
    ...html.matchAll(
      /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class='result-link'[^>]*>([\s\S]*?)<\/a>/g,
    ),
  ];
  const snippets = [
    ...html.matchAll(/class='result-snippet'[^>]*>([\s\S]*?)<\/td>/g),
  ];
  return links.slice(0, 5).map((m, i) => ({
    title: textOf(m[2]),
    url: decodeHTMLEntities(m[1]),
    snippet: snippets[i] ? textOf(snippets[i][1]) : '(no snippet)',
  }));
}

function parseBraveResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result-wrapper/).slice(1);

  for (const block of blocks) {
    if (results.length >= 5) break;
    const parsed = parseResultBlock(block);
    if (parsed) results.push(parsed);
  }

  if (results.length === 0) {
    const linkPattern =
      /<a[^>]*href="(https?:\/\/(?!search\.brave)[^"]*)"[^>]*>([^<]{10,})<\/a>/g;
    let match;
    while ((match = linkPattern.exec(html)) !== null && results.length < 5) {
      const title = decodeHTMLEntities(match[2].trim());
      if (!title.includes('Brave')) {
        results.push({ title, snippet: '', url: match[1] });
      }
    }
  }

  return results;
}

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHTMLEntities(text: string): string {
  return text.replaceAll(
    /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g,
    (entity, body: string) => {
      if (body.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      if (body.startsWith('#'))
        return String.fromCodePoint(Number(body.slice(1)));
      return NAMED_HTML_ENTITIES[body] ?? entity;
    },
  );
}

/**
 * Safe math expression evaluator using recursive descent parsing.
 * Supports: +, -, *, /, %, ^ (exponentiation), parentheses, decimals.
 * No dynamic code execution (no eval/new Function).
 */
function evaluateExpression(expr: string): number {
  let pos = 0;
  const str = expr.replaceAll(/\s/g, '');

  function parseExpr(): number {
    let left = parseTerm();
    while (pos < str.length && (str[pos] === '+' || str[pos] === '-')) {
      const op = str[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (
      pos < str.length &&
      (str[pos] === '*' || str[pos] === '/' || str[pos] === '%')
    ) {
      const op = str[pos++];
      const right = parsePower();
      if (op === '*') left *= right;
      else if (op === '/') left /= right;
      else left %= right;
    }
    return left;
  }

  function parsePower(): number {
    let base = parseUnary();
    if (pos < str.length && str[pos] === '^') {
      pos++;
      const exp = parsePower(); // right-associative
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (str[pos] === '-') {
      pos++;
      return -parseAtom();
    }
    if (str[pos] === '+') {
      pos++;
      return parseAtom();
    }
    return parseAtom();
  }

  function parseAtom(): number {
    if (str[pos] === '(') {
      pos++; // skip '('
      const val = parseExpr();
      if (str[pos] !== ')') throw new Error('Mismatched parentheses');
      pos++; // skip ')'
      return val;
    }
    const start = pos;
    while (
      pos < str.length &&
      ((str[pos] >= '0' && str[pos] <= '9') || str[pos] === '.')
    )
      pos++;
    if (pos === start) throw new Error('Unexpected character');
    return Number(str.substring(start, pos));
  }

  const result = parseExpr();
  if (pos < str.length) throw new Error('Unexpected character');
  return result;
}

function handleCalculator(expression: string): string {
  const sanitized = expression.replaceAll(/\s/g, '');
  if (!/^[0-9+\-*/().,%^]+$/.test(sanitized)) {
    throw new Error(
      'Invalid expression: only numbers and basic operators (+, -, *, /, ^, %, parentheses) are allowed',
    );
  }

  const result = evaluateExpression(sanitized);

  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new TypeError('Expression did not evaluate to a finite number');
  }

  return `${expression} = ${result}`;
}

function handleGetDatetime(timezone?: string): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long',
    ...(timezone ? { timeZone: timezone } : {}),
  };
  try {
    const formatted = new Intl.DateTimeFormat('en-US', options).format(now);
    const isoString = now.toISOString();
    return `Current date and time: ${formatted}\nISO 8601: ${isoString}\nUnix timestamp: ${Math.floor(
      now.getTime() / 1000,
    )}`;
  } catch {
    // Invalid timezone fallback
    const formatted = now.toString();
    return `Current date and time: ${formatted}\nNote: requested timezone "${timezone}" was invalid, showing device local time.`;
  }
}

async function collectDeviceSection(
  label: string,
  fetcher: () => Promise<string>,
): Promise<string> {
  try {
    return await fetcher();
  } catch {
    return `${label}: unavailable`;
  }
}

async function handleGetDeviceInfo(infoType = 'all'): Promise<string> {
  const type = infoType;
  const parts: string[] = [];

  if (type === 'all' || type === 'memory') {
    parts.push(
      await collectDeviceSection('Memory', async () => {
        const total = await DeviceInfo.getTotalMemory();
        const used = await DeviceInfo.getUsedMemory();
        return `Memory:\n  Total: ${formatBytes(total)}\n  Used: ${formatBytes(
          used,
        )}\n  Available: ${formatBytes(total - used)}`;
      }),
    );
  }

  if (type === 'all' || type === 'storage') {
    parts.push(
      await collectDeviceSection('Storage', async () => {
        const free = await DeviceInfo.getFreeDiskStorage();
        const total = await DeviceInfo.getTotalDiskCapacity();
        return `Storage:\n  Total: ${formatBytes(total)}\n  Free: ${formatBytes(
          free,
        )}`;
      }),
    );
  }

  if (type === 'all' || type === 'battery') {
    parts.push(
      await collectDeviceSection('Battery', async () => {
        const level = await DeviceInfo.getBatteryLevel();
        const charging = await DeviceInfo.isBatteryCharging();
        return `Battery: ${Math.round(level * 100)}%${
          charging ? ' (charging)' : ''
        }`;
      }),
    );
  }

  if (type === 'all') {
    parts.push(
      `Device: ${DeviceInfo.getBrand()} ${DeviceInfo.getModel()}`,
      `OS: ${Platform.OS} ${DeviceInfo.getSystemVersion()}`,
    );
  }

  return parts.join('\n\n');
}

/** Block SSRF: reject private/loopback/link-local/cloud-metadata URLs. */
function isPrivateUrl(url: string): boolean {
  const m = url.match(/^https?:\/\/([^/:]+)/i);
  if (!m) return false;
  const h = m[1].toLowerCase();
  return (
    h === 'localhost' ||
    h === '[::1]' ||
    h === 'metadata.google.internal' ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(h)
  );
}

function nodeToText(node: any): string {
  if (node.nodeType === 3) return node.text ?? '';
  const tag = (node.tagName ?? '').toLowerCase();
  const skip = [
    'script',
    'style',
    'nav',
    'header',
    'footer',
    'aside',
    'noscript',
    'iframe',
    'form',
    'button',
    'figure',
    'picture',
    'img',
    'video',
    'audio',
    'svg',
    'canvas',
  ];
  if (skip.includes(tag)) return '';
  const children = (node.childNodes ?? []).map(nodeToText).join('');
  if (['h1', 'h2', 'h3'].includes(tag)) return `\n\n## ${children.trim()}\n`;
  if (tag === 'h4' || tag === 'h5' || tag === 'h6')
    return `\n\n### ${children.trim()}\n`;
  if (tag === 'p') return `\n\n${children.trim()}`;
  if (tag === 'li') return `\n- ${children.trim()}`;
  if (tag === 'br') return '\n';
  if (tag === 'blockquote') return `\n> ${children.trim()}\n`;
  if (tag === 'code' || tag === 'pre') return `\`${children.trim()}\``;
  return children;
}

function htmlToMarkdown(html: string): string {
  const { parse } = require('node-html-parser'); // NOSONAR
  const root = parse(html);

  // strip boilerplate
  [
    'script',
    'style',
    'nav',
    'header',
    'footer',
    'aside',
    'noscript',
    'iframe',
    'form',
    'button',
  ].forEach(tag =>
    root.querySelectorAll(tag).forEach((el: any) => el.remove()),
  );

  // prefer semantic content containers
  const content =
    root.querySelector('article') ??
    root.querySelector('[role="main"]') ??
    root.querySelector('main') ??
    root.querySelector(
      '.post-content, .article-body, .entry-content, .content',
    ) ??
    root.querySelector('body') ??
    root;

  return nodeToText(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function handleReadUrl(rawUrl: string): Promise<string> {
  const MAX_CHARS = 4000;
  // Strip surrounding quotes/angle brackets that models sometimes emit
  let url = rawUrl.trim();
  while (url.length > 0 && '"\'<> '.includes(url[0])) url = url.slice(1);
  while (url.length > 0 && '"\'<> '.includes(url[url.length - 1]))
    url = url.slice(0, -1);
  if (!/^https?:\/\//i.test(url))
    throw new Error('Invalid URL: must start with http:// or https://');
  if (isPrivateUrl(url))
    throw new Error('Blocked: cannot fetch private/local network URLs');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // On-device fetch + parse (privacy-preserving — no third-party proxy)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html, text/plain, */*',
      },
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const html = await response.text();
    const text = htmlToMarkdown(html);

    if (!text) return `The page at ${url} returned no readable content.`;

    return text.length > MAX_CHARS
      ? `${text.slice(0, MAX_CHARS)}\n\n[Content truncated]`
      : text;
  } catch (e: any) {
    logger.error(`[Tools] read_url FAILED: ${e?.message || e}`);
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The project's knowledge base and the chat's documents, searched by the shared document engine.
 * Passages come back as `<source>` blocks numbered after the turn's own [S#], so the answer cites
 * them like any other passage and the reply links them to their pages.
 */
async function handleSearchKnowledgeBase(
  query: string,
  conversationId?: string,
  projectId?: string,
): Promise<string> {
  if (!conversationId && !projectId)
    return 'No chat or project to search. The knowledge base belongs to a project.';
  // Loaded lazily: the document services read the chat store, which the tool loop is part of.
  const { searchDocumentsForTool } =
    require('../documents/chatTurn') as typeof DocumentChatTurn; // NOSONAR
  const statusKey = conversationId ?? `project:${projectId}`;
  const status = useDocumentTurnStatusStore.getState();
  try {
    return await searchDocumentsForTool(
      {
        ...(conversationId ? { conversationId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      query,
      turnStatus => status.set(statusKey, describeTurnStatus(turnStatus)),
    );
  } finally {
    status.set(statusKey, null);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return bytes < 1024 ** 3
    ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
    : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
