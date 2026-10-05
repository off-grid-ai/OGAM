/**
 * HTTP Client Utilities - image conversion, network validation, endpoint testing
 */

import { isTailscaleIPv4 } from '../utils/network';
import {
  HTTP_API_KEY_ERROR,
  keyedHttpEndpoint,
  REMOTE_FETCH_REDIRECT_POLICY,
  remoteAuthorizationHeaders,
} from './remoteTransportPolicy';

function mimeTypeFromExtension(ext: string | undefined): string {
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function fetchBlobAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image as base64'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Convert image URI to base64 data URL
 */
export async function imageToBase64DataUrl(uri: string): Promise<string> {
  // Handle already-encoded data URLs
  if (uri.startsWith('data:')) {
    return uri;
  }

  // Handle file:// URIs (React Native)
  const RNFS = require('react-native-fs');
  if (uri.startsWith('file://') || uri.startsWith(RNFS.DocumentDirectoryPath)) {
    const filePath = uri.replace('file://', '');
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      throw new Error(`Image file not found: ${filePath}`);
    }
    const base64 = await RNFS.readFile(filePath, 'base64');
    const ext = filePath.split('.').pop()?.toLowerCase();
    return `data:${mimeTypeFromExtension(ext)};base64,${base64}`;
  }

  // Handle http:// or https:// URIs — download and convert
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return fetchBlobAsBase64(uri);
  }

  // For other URIs (content://, ph://, etc.), try fetch
  try {
    return await fetchBlobAsBase64(uri);
  } catch {
    throw new Error(`Unsupported image URI: ${uri}`);
  }
}

/**
 * Validate that an endpoint is on a private network or a private Tailscale tailnet.
 * Returns true for private endpoints, false for public internet addresses.
 */
export function isPrivateNetworkEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname;

    // localhost (including IPv6 localhost with brackets)
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) {
      return true;
    }

    // Private IP ranges
    // 10.0.0.0 - 10.255.255.255
    if (
      hostname.startsWith('10.') ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    ) {
      return true;
    }

    // 172.16.0.0 - 172.31.255.255
    const match = /^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
    if (match) {
      const second = Number.parseInt(match[1], 10);
      if (second >= 16 && second <= 31) {
        return true;
      }
    }

    // 192.168.0.0 - 192.168.255.255
    if (hostname.startsWith('192.168.')) {
      return true;
    }

    // 169.254.0.0 - 169.254.255.255 (link-local)
    if (hostname.startsWith('169.254.')) {
      return true;
    }

    // 100.64.0.0 - 100.127.255.255 (Tailscale CGNAT tailnet addresses)
    if (isTailscaleIPv4(hostname)) {
      return true;
    }

    // .local (mDNS/Bonjour)
    return hostname.endsWith('.local');
  } catch {
    // Invalid URL - be conservative
    return false;
  }
}

/**
 * Check if endpoint URL is valid and reachable
 */
export async function testEndpoint(
  endpoint: string,
  timeout: number = 5000,
  apiKey?: string,
): Promise<{ success: boolean; error?: string; latency?: number }> {
  const startTime = Date.now();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    // Normalize endpoint (remove trailing slashes)
    let url = endpoint;
    while (url.endsWith('/')) url = url.slice(0, -1);

    // The saved key is never sent over HTTP, so a check that passed would not have used it.
    if (keyedHttpEndpoint(url, apiKey)) return { success: false, error: HTTP_API_KEY_ERROR };

    const authHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...remoteAuthorizationHeaders(url, apiKey),
    };

    // Try to reach the base URL first
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${url}${url.endsWith('/v1') ? '' : '/v1'}/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: authHeaders,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    const latency = Date.now() - startTime;

    // A refused key is the answer. A health page that answers 200 must not hide it.
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        // On private HTTP the key is never sent, so the refusal is explained by the HTTPS rule.
        error: keyedHttpEndpoint(url, apiKey)
          ? HTTP_API_KEY_ERROR
          : `The server rejected the API key (HTTP ${response.status}). Check the key for this server.`,
        latency,
      };
    }

    if (!response.ok) {
      // Try alternate health endpoints
      const altUrls = ['/api/tags', '/health', '/'];
      for (const alt of altUrls) {
        try {
          const altResponse = await fetch(`${url}${alt}`, {
            method: 'GET',
            signal: controller.signal,
            headers: authHeaders,
            redirect: REMOTE_FETCH_REDIRECT_POLICY,
          });
          if (altResponse.ok) {
            return { success: true, latency };
          }
        } catch {
          // Continue to next
        }
      }

      return {
        success: false,
        error: `Server returned ${response.status}`,
        latency,
      };
    }

    return { success: true, latency };
  } catch (error) {
    const latency = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      latency,
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkOllamaEndpoint(
  url: string,
  timeout: number,
  apiKey?: string,
): Promise<{ type: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
    // Use origin only to avoid double-path when endpoint already has a prefix (e.g. /api)
    const origin = new URL(url).origin;
    const headers = remoteAuthorizationHeaders(origin, apiKey);
    const response = await fetch(`${origin}/api/tags`, {
      signal: controller.signal,
      headers,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    clearTimeout(timeoutId);
    if (response.ok) return { type: 'ollama' };
  } catch {
    // Not Ollama
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  return null;
}

async function checkLmStudioEndpoint(
  url: string,
  timeout: number,
  apiKey?: string,
): Promise<{ type: string } | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
    const headers = remoteAuthorizationHeaders(url, apiKey);
    const response = await fetch(`${url}/v1/models`, {
      signal: controller.signal,
      headers,
      redirect: REMOTE_FETCH_REDIRECT_POLICY,
    });
    clearTimeout(timeoutId);
    if (response.ok) {
      const data = await response.json();
      if (data?.data?.some?.((m: { id: string }) => m.id?.includes('gguf'))) {
        return { type: 'lmstudio' };
      }
    }
  } catch {
    // Not LM Studio
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  return null;
}

/**
 * Detect server type from endpoint
 */
export async function detectServerType(
  endpoint: string,
  timeout: number = 5000,
  apiKey?: string,
): Promise<{ type: string; version?: string } | null> {
  try {
    let url = endpoint;
    while (url.endsWith('/')) url = url.slice(0, -1);

    // Try OpenAI-style version endpoint
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const headers = remoteAuthorizationHeaders(url, apiKey);
      const response = await fetch(`${url}/v1/models`, {
        signal: controller.signal,
        headers,
        redirect: REMOTE_FETCH_REDIRECT_POLICY,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const server = response.headers.get('server') || '';
        if (server.toLowerCase().includes('ollama')) {
          return { type: 'ollama' };
        }
        try {
          const data = await response.json();
          if (data?.object === 'list' || Array.isArray(data?.data)) {
            return { type: 'openai-compatible' };
          }
        } catch {
          // Can't parse, assume generic
        }
      }
    } catch {
      clearTimeout(timeoutId);
    }

    const ollamaResult = await checkOllamaEndpoint(url, timeout, apiKey);
    if (ollamaResult) return ollamaResult;

    return await checkLmStudioEndpoint(url, timeout, apiKey);
  } catch {
    return null;
  }
}
