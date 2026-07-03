/**
 * run_python Tool Handler
 *
 * Bridges the run_python tool call to pythonRuntimeService: installs any
 * requested PyPI packages, runs the code, formats stdout/stderr/result text for
 * the model, and turns captured matplotlib figures into image attachments the
 * chat shows to the user. Split out of handlers.ts to keep that file under the
 * line limit.
 */

import type { ToolCall } from './types';
import type { MediaAttachment } from '../../types';
import logger from '../../utils/logger';

/** run_python returns text for the model, optionally with plot images for the user. */
export type PythonDispatchResult = string | { content: string; attachments?: MediaAttachment[] };

const MAX_OUTPUT_CHARS = 6000;

/**
 * Packages install from PyPI via micropip with NO integrity check (unlike the
 * bundled runtime assets, which are SHA-256 pinned). This is an intentional
 * capability: the user opts into it by enabling the tool, and a malicious or
 * typosquatted wheel is confined to the WASM sandbox — it can reach only the
 * CSP-allowed hosts (pypi.org, files.pythonhosted.org, jsdelivr) and the
 * in-memory interpreter FS, never the device filesystem or other origins.
 */
function parsePackages(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string' && p.trim().length > 0).map(p => p.trim());
  if (typeof raw === 'string') return raw.split(',').map(p => p.trim()).filter(Boolean);
  return [];
}

export async function handleRunPython(call: ToolCall, code: string): Promise<PythonDispatchResult> {
  const { pythonRuntimeService } = require('../python/pythonRuntimeService'); // NOSONAR
  const { usePythonRuntimeStore } = require('../../stores/pythonRuntimeStore'); // NOSONAR

  if (usePythonRuntimeStore.getState().status === 'unknown') {
    await pythonRuntimeService.refreshStatus();
  }
  if (!pythonRuntimeService.isInstalled()) {
    return 'The Python runtime is not installed on this device. Tell the user to open Settings > Tools and enable Python (a one-time 24 MB download). After that, Python runs fully offline.';
  }

  const packages = parsePackages(call.arguments.packages);
  const res = await pythonRuntimeService.execute(code, packages.length ? { packages } : {});

  const attachments = await savePlotImages(res.images);

  const sections: string[] = [];
  if (res.stdout) sections.push(res.stdout);
  if (res.ok && res.result !== undefined && res.result !== '') sections.push(`[result] ${res.result}`);
  if (res.stderr) sections.push(`[stderr]\n${res.stderr}`);
  if (!res.ok) sections.push(`[error]\n${res.error || 'Execution failed'}`);
  // Tell the model a plot was produced (it can't see the image) so it can refer to it.
  if (attachments.length) sections.push(`[${attachments.length} plot${attachments.length > 1 ? 's' : ''} shown to the user]`);
  if (sections.length === 0) sections.push('(no output — use print() to see values)');

  const output = sections.join('\n');
  const content = output.length > MAX_OUTPUT_CHARS ? `${sliceCodePointSafe(output, MAX_OUTPUT_CHARS)}\n\n[Output truncated]` : output;
  return attachments.length ? { content, attachments } : content;
}

/** Write base64 PNG figures to disk and return them as image attachments. */
async function savePlotImages(images: string[] | undefined): Promise<MediaAttachment[]> {
  if (!images?.length) return [];
  const RNFS = require('react-native-fs'); // NOSONAR
  const { generateId } = require('../../utils/generateId'); // NOSONAR
  const dir = `${RNFS.DocumentDirectoryPath}/python-plots`;
  try {
    await RNFS.mkdir(dir);
  } catch { /* already exists */ }

  const attachments: MediaAttachment[] = [];
  for (const b64 of images) {
    try {
      const id = generateId();
      const path = `${dir}/plot-${id}.png`;
      await RNFS.writeFile(path, b64, 'base64');
      attachments.push({ id, type: 'image', uri: `file://${path}`, mimeType: 'image/png', fileName: `plot-${id}.png` });
    } catch (error) {
      logger.warn('[Tools] Failed to save plot image:', error);
    }
  }
  return attachments;
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
