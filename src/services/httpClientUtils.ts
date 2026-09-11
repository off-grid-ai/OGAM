import { IMAGE_MIME, imageMimeForExtension } from '@offgrid/models';
/** HTTP client utilities for image conversion and network validation. */

import { isTailscaleIPv4 } from '../utils/network';

function mimeTypeFromExtension(ext: string | undefined): string {
  return imageMimeForExtension(ext) ?? IMAGE_MIME.jpeg;
}

async function fetchBlobAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read image as base64'));
    reader.readAsDataURL(blob);
  });
}

export async function imageToBase64DataUrl(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;

  const RNFS = require('react-native-fs');
  if (uri.startsWith('file://') || uri.startsWith(RNFS.DocumentDirectoryPath)) {
    const filePath = uri.replace('file://', '');
    if (!(await RNFS.exists(filePath))) {
      throw new Error(`Image file not found: ${filePath}`);
    }
    const base64 = await RNFS.readFile(filePath, 'base64');
    const ext = filePath.split('.').pop()?.toLowerCase();
    return `data:${mimeTypeFromExtension(ext)};base64,${base64}`;
  }

  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return fetchBlobAsBase64(uri);
  }
  try {
    return await fetchBlobAsBase64(uri);
  } catch {
    throw new Error(`Unsupported image URI: ${uri}`);
  }
}

/** Return whether an endpoint is on a private network or private Tailscale tailnet. */
export function isPrivateNetworkEndpoint(endpoint: string): boolean {
  try {
    const hostname = new URL(endpoint).hostname;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    ) return true;
    if (hostname.startsWith('10.') || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return true;
    }
    const match = /^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/.exec(hostname);
    if (match) {
      const second = Number.parseInt(match[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      isTailscaleIPv4(hostname) ||
      hostname.endsWith('.local');
  } catch {
    return false;
  }
}
