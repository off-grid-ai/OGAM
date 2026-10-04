import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { ToolCall, ToolResult } from './types';
import type { SearchResult } from '@offgrid/application';
import logger from '../../utils/logger';
import { requireRagSuccess } from '../ragOutcome';
import {
  braveSearchUrl,
  executePortableTool,
  formatWebSearchResults,
  isPrivateNetworkUrl,
  normalizeToolUrl,
  parseBraveResults,
  htmlToMarkdown,
  readUrlResultText,
  WEB_TOOL_TIMEOUTS_MS,
  formatFileSize,
} from '@offgrid/models';

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
    case 'get_current_datetime':
    case 'get_datetime':
      return executePortableTool(call.name, call.arguments) as string;
    case 'get_device_info':
      return handleGetDeviceInfo(call.arguments.info_type);
    case 'search_knowledge_base': {
      const q = requireString(call, 'query');
      if (!q) throw new Error('Missing required parameter: query');
      return handleSearchKnowledgeBase(q, call.context?.projectId);
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

async function handleWebSearch(query: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_TOOL_TIMEOUTS_MS.search);
  try {
    const response = await fetch(braveSearchUrl(query), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
      },
    });
    return formatWebSearchResults(parseBraveResults(await response.text()), query);
  } finally {
    clearTimeout(timeout);
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
      return `Memory:\n  Total: ${formatFileSize(total)}\n  Used: ${formatFileSize(used)}\n  Available: ${formatFileSize(total - used)}`;
    }));
  }

  if (type === 'all' || type === 'storage') {
    parts.push(await collectDeviceSection('Storage', async () => {
      const free = await DeviceInfo.getFreeDiskStorage();
      const total = await DeviceInfo.getTotalDiskCapacity();
      return `Storage:\n  Total: ${formatFileSize(total)}\n  Free: ${formatFileSize(free)}`;
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

async function handleReadUrl(rawUrl: string): Promise<string> {
  const url = normalizeToolUrl(rawUrl);
  if (isPrivateNetworkUrl(url)) throw new Error('Blocked: cannot fetch private/local network URLs');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_TOOL_TIMEOUTS_MS.read);
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
    return readUrlResultText(htmlToMarkdown(await response.text()), { url });
  } catch (e: any) {
    logger.error(`[Tools] read_url FAILED for "${url}": ${e?.message || e}`);
    throw e;
  } finally { clearTimeout(timeout); }
}

async function handleSearchKnowledgeBase(query: string, projectId?: string): Promise<string> {
  if (!projectId) return 'No project context. Knowledge base requires an active project.';
  const { applicationFacade } = require('../applicationFacade') as typeof import('../applicationFacade'); // NOSONAR
  const result = requireRagSuccess(
    await applicationFacade().rag.search(projectId, query),
  );
  if (result.chunks.length === 0) return `No results found for "${query}" in the knowledge base.`;
  return result.chunks
    .map((chunk: SearchResult['chunks'][number], index: number) =>
      `[${index + 1}] ${chunk.name} (part ${chunk.position + 1}):\n${chunk.content}`)
    .join('\n\n---\n\n');
}
