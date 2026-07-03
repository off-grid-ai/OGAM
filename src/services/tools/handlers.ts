import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { ToolCall, ToolResult } from './types';
import logger from '../../utils/logger';

function makeResult(call: ToolCall, start: number, opts: { content: string; error?: string }): ToolResult {
  return { toolCallId: call.id, name: call.name, content: opts.content, error: opts.error, durationMs: Date.now() - start };
}
function requireString(call: ToolCall, param: string): string | null {
  const val = call.arguments[param];
  return (val && typeof val === 'string' && val.trim()) ? val.trim() : null;
}

export async function executeToolCall(call: ToolCall): Promise<ToolResult> {
  const start = Date.now();
  try {
    const content = await dispatchTool(call);
    return makeResult(call, start, { content });
  } catch (error: any) {
    logger.error(`[Tools] Error executing ${call.name}:`, error);
    return makeResult(call, start, { content: '', error: error.message || 'Tool execution failed' });
  }
}

async function dispatchTool(call: ToolCall): Promise<string> {
  switch (call.name) {
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
      return handleSearchKnowledgeBase(q, call.context?.projectId);
    }
    case 'search_memory': {
      const q = requireString(call, 'query');
      if (!q) throw new Error('Missing required parameter: query');
      return handleSearchMemory(q, call.context?.projectId);
    }
    case 'save_memory':
      return handleSaveMemory(call, call.context?.projectId);
    case 'forget_memory':
      return handleForgetMemory(call, call.context?.projectId);
    case 'read_url': {
      const url = requireString(call, 'url');
      if (!url) throw new Error('Missing required parameter: url');
      return handleReadUrl(url);
    }
    case 'run_python': {
      const code = requireString(call, 'code');
      if (!code) throw new Error('Missing required parameter: code');
      return handleRunPython(code);
    }
    default:
      throw new Error(`Unknown tool: ${call.name}`);
  }
}

async function handleWebSearch(query: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
      },
    });
    const html = await response.text();
    const results = parseBraveResults(html);

    if (results.length === 0) {
      return `No results found for "${query}".`;
    }

    return results
      .slice(0, 5)
      .map((r, i) => {
        const heading = r.url ? `[${r.title}](${r.url})` : r.title;
        return `${i + 1}. ${heading}\n   ${r.snippet}`;
      })
      .join('\n\n');
  } finally {
    clearTimeout(timeout);
  }
}

type SearchResult = { title: string; snippet: string; url?: string };

function stripHtmlTags(html: string): string {
  let result = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') { inTag = true; continue; }
    if (ch === '>') { inTag = false; continue; }
    if (!inTag) result += ch;
  }
  return result;
}

function parseResultBlock(block: string): SearchResult | null {
  const urlMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
  const url = urlMatch ? decodeHTMLEntities(urlMatch[1]) : '';

  const titleMatch = block.match(/class="[^"]*title[^"]*"[^>]*>([^<]+)</) ||
                     block.match(/<a[^>]*href="https?:\/\/[^"]*"[^>]*>\s*<span[^>]*>([^<]+)/);
  const title = titleMatch ? decodeHTMLEntities(titleMatch[1].trim()) : '';

  const snippetMatch = block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/p>/) ||
                       block.match(/class="snippet[^"]*"[^>]*>([\s\S]*?)<\/span>/);
  const snippet = snippetMatch
    ? decodeHTMLEntities(stripHtmlTags(snippetMatch[1]).trim())
    : '';

  if (!title && !snippet) return null;
  return { title: title || '(no title)', snippet: snippet || '(no snippet)', url };
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
    const linkPattern = /<a[^>]*href="(https?:\/\/(?!search\.brave)[^"]*)"[^>]*>([^<]{10,})<\/a>/g;
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

function decodeHTMLEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&#x2F;', '/')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&apos;', "'")
    .replaceAll(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)));
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
    while (pos < str.length && (str[pos] === '*' || str[pos] === '/' || str[pos] === '%')) {
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
    if (str[pos] === '-') { pos++; return -parseAtom(); }
    if (str[pos] === '+') { pos++; return parseAtom(); }
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
    while (pos < str.length && (str[pos] >= '0' && str[pos] <= '9' || str[pos] === '.')) pos++;
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
    throw new Error('Invalid expression: only numbers and basic operators (+, -, *, /, ^, %, parentheses) are allowed');
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
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
    ...(timezone ? { timeZone: timezone } : {}),
  };
  try {
    const formatted = new Intl.DateTimeFormat('en-US', options).format(now);
    const isoString = now.toISOString();
    return `Current date and time: ${formatted}\nISO 8601: ${isoString}\nUnix timestamp: ${Math.floor(now.getTime() / 1000)}`;
  } catch {
    // Invalid timezone fallback
    const formatted = now.toString();
    return `Current date and time: ${formatted}\nNote: requested timezone "${timezone}" was invalid, showing device local time.`;
  }
}

async function collectDeviceSection(
  label: string, fetcher: () => Promise<string>,
): Promise<string> {
  try { return await fetcher(); } catch { return `${label}: unavailable`; }
}

async function handleGetDeviceInfo(infoType = 'all'): Promise<string> {
  const type = infoType;
  const parts: string[] = [];

  if (type === 'all' || type === 'memory') {
    parts.push(await collectDeviceSection('Memory', async () => {
      const total = await DeviceInfo.getTotalMemory();
      const used = await DeviceInfo.getUsedMemory();
      return `Memory:\n  Total: ${formatBytes(total)}\n  Used: ${formatBytes(used)}\n  Available: ${formatBytes(total - used)}`;
    }));
  }

  if (type === 'all' || type === 'storage') {
    parts.push(await collectDeviceSection('Storage', async () => {
      const free = await DeviceInfo.getFreeDiskStorage();
      const total = await DeviceInfo.getTotalDiskCapacity();
      return `Storage:\n  Total: ${formatBytes(total)}\n  Free: ${formatBytes(free)}`;
    }));
  }

  if (type === 'all' || type === 'battery') {
    parts.push(await collectDeviceSection('Battery', async () => {
      const level = await DeviceInfo.getBatteryLevel();
      const charging = await DeviceInfo.isBatteryCharging();
      return `Battery: ${Math.round(level * 100)}%${charging ? ' (charging)' : ''}`;
    }));
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
  return h === 'localhost' || h === '[::1]' || h === 'metadata.google.internal'
    || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(h);
}

function nodeToText(node: any): string {
  if (node.nodeType === 3) return node.text ?? '';
  const tag = (node.tagName ?? '').toLowerCase();
  const skip = ['script','style','nav','header','footer','aside','noscript','iframe','form','button','figure','picture','img','video','audio','svg','canvas'];
  if (skip.includes(tag)) return '';
  const children = (node.childNodes ?? []).map(nodeToText).join('');
  if (['h1','h2','h3'].includes(tag)) return `\n\n## ${children.trim()}\n`;
  if (tag === 'h4' || tag === 'h5' || tag === 'h6') return `\n\n### ${children.trim()}\n`;
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
  ['script','style','nav','header','footer','aside','noscript','iframe','form','button'].forEach(
    tag => root.querySelectorAll(tag).forEach((el: any) => el.remove()),
  );

  // prefer semantic content containers
  const content = root.querySelector('article')
    ?? root.querySelector('[role="main"]')
    ?? root.querySelector('main')
    ?? root.querySelector('.post-content, .article-body, .entry-content, .content')
    ?? root.querySelector('body')
    ?? root;

  return nodeToText(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function handleReadUrl(rawUrl: string): Promise<string> {
  const MAX_CHARS = 4000;
  // Strip surrounding quotes/angle brackets that models sometimes emit
  let url = rawUrl.trim();
  while (url.length > 0 && '"\'<> '.includes(url[0])) url = url.slice(1);
  while (url.length > 0 && '"\'<> '.includes(url[url.length - 1])) url = url.slice(0, -1);
  if (!/^https?:\/\//i.test(url)) throw new Error('Invalid URL: must start with http:// or https://');
  if (isPrivateUrl(url)) throw new Error('Blocked: cannot fetch private/local network URLs');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // On-device fetch + parse (privacy-preserving — no third-party proxy)
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html, text/plain, */*',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const html = await response.text();
    const text = htmlToMarkdown(html);

    if (!text) return `The page at ${url} returned no readable content.`;

    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[Content truncated]` : text;
  } catch (e: any) {
    logger.error(`[Tools] read_url FAILED for "${url}": ${e?.message || e}`);
    throw e;
  } finally { clearTimeout(timeout); }
}

async function handleRunPython(code: string): Promise<string> {
  const MAX_CHARS = 6000;
  const { pythonRuntimeService } = require('../python/pythonRuntimeService'); // NOSONAR
  const { usePythonRuntimeStore } = require('../../stores/pythonRuntimeStore'); // NOSONAR

  if (usePythonRuntimeStore.getState().status === 'unknown') {
    await pythonRuntimeService.refreshStatus();
  }
  if (!pythonRuntimeService.isInstalled()) {
    return 'The Python runtime is not installed on this device. Tell the user to open Settings > Tools and enable Python (a one-time 24 MB download). After that, Python runs fully offline.';
  }

  const res = await pythonRuntimeService.execute(code);

  const sections: string[] = [];
  if (res.stdout) sections.push(res.stdout);
  if (res.ok && res.result !== undefined && res.result !== '') sections.push(`[result] ${res.result}`);
  if (res.stderr) sections.push(`[stderr]\n${res.stderr}`);
  if (!res.ok) sections.push(`[error]\n${res.error || 'Execution failed'}`);
  if (sections.length === 0) sections.push('(no output — use print() to see values)');

  const output = sections.join('\n');
  return output.length > MAX_CHARS ? `${sliceCodePointSafe(output, MAX_CHARS)}\n\n[Output truncated]` : output;
}

/**
 * Slice to at most `max` UTF-16 code units without splitting a surrogate pair.
 * Python output (emoji, some numpy/pandas symbols) uses astral-plane chars; a
 * naive slice can leave a lone surrogate that corrupts JSON transport downstream.
 */
function sliceCodePointSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  const code = text.charCodeAt(max - 1);
  // If the cut lands right after a high surrogate, drop it too.
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return text.slice(0, end);
}

async function handleSearchKnowledgeBase(query: string, projectId?: string): Promise<string> {
  if (!projectId) return 'No project context. Knowledge base requires an active project.';
  const { ragService } = require('../rag'); // NOSONAR
  const result = await ragService.searchProject(projectId, query);
  if (result.chunks.length === 0) return `No results found for "${query}" in the knowledge base.`;
  return result.chunks
    .map((c: import('../rag').RagSearchResult, i: number) => `[${i + 1}] ${c.name} (part ${c.position + 1}):\n${c.content}`)
    .join('\n\n---\n\n');
}

async function handleSearchMemory(query: string, projectId?: string): Promise<string> {
  const { memoryService } = require('../memory'); // NOSONAR
  const result = await memoryService.searchMemory({ projectId, query });
  return memoryService.formatForTool(result);
}

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((tag): tag is string => typeof tag === 'string');
  if (typeof raw !== 'string') return [];
  return raw.split(',').map(tag => tag.trim()).filter(Boolean);
}

function parseMemoryId(raw: unknown): number {
  const id = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Missing required parameter: memory_id');
  return id;
}

async function handleSaveMemory(call: ToolCall, projectId?: string): Promise<string> {
  const title = requireString(call, 'title');
  const body = requireString(call, 'body');
  if (!title) throw new Error('Missing required parameter: title');
  if (!body) throw new Error('Missing required parameter: body');
  const requestedScope = call.arguments.scope === 'global' ? 'global' : 'project';
  const scope = requestedScope === 'project' && projectId ? 'project' : 'global';
  const { memoryService } = require('../memory'); // NOSONAR
  const memory = await memoryService.saveMemory({
    title,
    body,
    scope,
    projectId: scope === 'project' ? projectId : undefined,
    kind: call.arguments.kind,
    tags: parseTags(call.arguments.tags),
    jurisdiction: typeof call.arguments.jurisdiction === 'string' ? call.arguments.jurisdiction : undefined,
    asOfDate: typeof call.arguments.as_of_date === 'string' ? call.arguments.as_of_date : undefined,
    sourceType: 'assistant_tool',
  });
  return `Saved memory #${memory.id}: ${memory.title}`;
}

async function handleForgetMemory(call: ToolCall, projectId?: string): Promise<string> {
  const memoryId = parseMemoryId(call.arguments.memory_id);
  const { memoryService } = require('../memory'); // NOSONAR
  const deleted = await memoryService.forgetMemory(memoryId, projectId);
  return deleted ? `Forgot memory #${memoryId}.` : `Memory #${memoryId} was not found or could not be removed.`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
