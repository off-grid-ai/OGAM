/**
 * Reads a skill in the open Agent Skills format that Claude and OpenClaw both use: a SKILL.md with a short YAML header
 * (name and description) and the instructions below it. Pure, so it is tested without a device.
 * Only the header keys Atlas can use are read; anything else (metadata, allowed-tools...) is ignored, except what the skill
 * says it needs (programs it expects), which is shown so the person knows before adding it.
 */
export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
  /** Anything but an explicit "false": can be called by name with /name. */
  userInvocable: boolean;
  /** Programs the skill expects (curl, python...): Atlas cannot run them. */
  needs: string[];
}

export class SkillFormatError extends Error {}

/** Unquote a header value. */
const clean = (v: string) => v.trim().replace(/^(['"])(.*)\1$/s, '$2').trim();

/** Header lines to a key -> value map; folded (>) and literal (|) multi-line values are joined. */
function readHeader(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2];
    if (/^[>|][+-]?$/.test(value.trim()) || value.trim() === '') {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(' ');
    }
    out[m[1].toLowerCase()] = clean(value);
  }
  return out;
}

/** A skill's name as a command: lower case, letters, digits and hyphens. */
export const skillSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

/** Programs listed in the skill's metadata (requires.bins) or used in shell code blocks. */
function neededPrograms(header: Record<string, string>, body: string): string[] {
  const found = new Set<string>();
  const meta = header.metadata;
  if (meta) {
    try {
      const bins = JSON.parse(meta)?.openclaw?.requires?.bins ?? JSON.parse(meta)?.requires?.bins;
      if (Array.isArray(bins)) bins.forEach((b) => typeof b === 'string' && found.add(b));
    } catch { /* metadata that is not JSON is ignored */ }
  }
  for (const block of body.matchAll(/```(?:bash|sh|shell|zsh|python|py)\b([\s\S]*?)```/g)) {
    const first = block[1].trim().split(/\s+/)[0];
    if (first && !first.startsWith('#') && /^[a-z0-9._-]+$/i.test(first)) found.add(first);
  }
  if (/\bscripts\/[\w./-]+\.(py|sh)\b/i.test(body)) found.add('its scripts');
  return [...found].slice(0, 6);
}

export function parseSkill(text: string): ParsedSkill {
  const source = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(source);
  if (!m) throw new SkillFormatError('A skill starts with a header between two --- lines, with a name and a description.');
  const header = readHeader(m[1].split('\n'));
  const name = skillSlug(header.name ?? '');
  if (!name) throw new SkillFormatError('The skill has no name in its header.');
  const description = (header.description ?? '').replace(/\s+/g, ' ').trim();
  if (!description) throw new SkillFormatError('The skill has no description in its header: Atlas uses it to tell when the skill applies.');
  const body = m[2].trim();
  if (!body) throw new SkillFormatError('The skill has no instructions below its header.');
  return {
    name, description: description.slice(0, 1024), body,
    userInvocable: !/^false$/i.test(header['user-invocable'] ?? ''),
    needs: neededPrograms(header, body),
  };
}
