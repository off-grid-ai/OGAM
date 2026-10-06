/**
 * Behavior-faithful fake of remote MCP servers at the network boundary (XMLHttpRequest, which
 * McpClient uses). Each registered URL is an in-memory Streamable-HTTP MCP server: it answers
 * initialize, tools/list and tools/call with JSON-RPC bodies the way a real server does, and it
 * runs a called tool by producing text that names the server that ran it. Everything above the
 * transport (McpClient, mcpService, the store, the screens) runs for real.
 */
import type { McpTool } from '@offgrid/pro/mcp/types';

export interface FakeMcpServer {
  label: string;
  tools: McpTool[];
}

export interface McpHttpFake {
  /** Every tools/call that reached a server, in order. */
  calls: Array<{ url: string; tool: string }>;
  restore: () => void;
}

export function installMcpHttpFake(servers: Record<string, FakeMcpServer>): McpHttpFake {
  const calls: McpHttpFake['calls'] = [];
  const original = (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest;

  class FakeMcpXHR {
    status = 0;
    responseText = '';
    timeout = 0;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    onabort: null | (() => void) = null;
    private url = '';
    private headers: Record<string, string> = {};

    open(_method: string, url: string): void { this.url = url; }
    setRequestHeader(): void { /* headers are not part of this server's behavior */ }
    getResponseHeader(name: string): string | null { return this.headers[name.toLowerCase()] ?? null; }
    abort(): void { this.onabort?.(); }

    send(payload: string): void {
      const server = servers[this.url];
      setTimeout(() => {
        if (!server) { this.onerror?.(); return; }
        const req = JSON.parse(payload) as { id: number; method: string; params: { name?: string } };
        this.status = 200;
        this.headers = { 'content-type': 'application/json' };
        let result: unknown;
        if (req.method === 'initialize') {
          result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: server.label } };
        } else if (req.method === 'tools/list') {
          result = { tools: server.tools };
        } else if (req.method === 'tools/call') {
          calls.push({ url: this.url, tool: req.params.name ?? '' });
          result = { content: [{ type: 'text', text: `${server.label} ran ${req.params.name}` }] };
        }
        this.responseText = result === undefined ? '' : JSON.stringify({ jsonrpc: '2.0', id: req.id, result });
        this.onload?.();
      }, 0);
    }
  }

  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeMcpXHR;
  return {
    calls,
    restore: () => { (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = original; },
  };
}
