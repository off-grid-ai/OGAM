export const TEST_MCP_URL = 'https://mcp.test/tools';
export const TEST_MCP_TOOL = 'find_off_grid_notes';
export const TEST_MCP_RESULT = 'Found one Off Grid note about the launch plan.';

type BoundaryResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export function mcpBoundaryResponse(
  method: string,
  url: string,
  requestBody: string,
): BoundaryResponse | null {
  if (method !== 'POST' || url !== TEST_MCP_URL) return null;

  const request = JSON.parse(requestBody) as {
    id?: number;
    method?: string;
  };
  let result: Record<string, unknown> = {};
  if (request.method === 'initialize') {
    result = {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'Test MCP', version: '1.0.0' },
    };
  } else if (request.method === 'tools/list') {
    result = {
      tools: [
        {
          name: TEST_MCP_TOOL,
          description: 'Find notes stored by the external MCP server.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    };
  } else if (request.method === 'tools/call') {
    result = {
      content: [{ type: 'text', text: TEST_MCP_RESULT }],
      isError: false,
    };
  }

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }),
  };
}

/** External JSON-RPC server fake. All MCP client, registry, store, and UI code stays real. */
export function installMcpBoundary(): void {
  class FakeMcpXHR {
    responseText = '';
    readyState = 0;
    status = 0;
    timeout = 0;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    ontimeout: null | (() => void) = null;
    onabort: null | (() => void) = null;
    private method = '';
    private url = '';

    open(method: string, url: string): void {
      this.method = method;
      this.url = url;
      this.readyState = 1;
    }
    setRequestHeader(): void {}
    getResponseHeader(name: string): string | null {
      return name.toLowerCase() === 'content-type'
        ? 'application/json'
        : null;
    }
    abort(): void {
      this.onabort?.();
    }
    send(body?: string): void {
      const response = mcpBoundaryResponse(
        this.method,
        this.url,
        body ?? '',
      );
      if (!response) {
        this.onerror?.();
        return;
      }
      this.status = response.status;
      this.responseText = response.body;
      this.readyState = 4;
      queueMicrotask(() => this.onload?.());
    }
  }

  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest =
    FakeMcpXHR;
}
