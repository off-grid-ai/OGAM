/**
 * The lessons the learning loop keeps are also saved as a Markdown file in the Atlas workspace folder
 * (Learning/<name>-lessons.md), so they can be read, shared and backed up outside the app. The app's own copy
 * stays the one the assistant uses; the file is rewritten whenever the lessons change.
 */
export const lessonsFileName = (name: string): string =>
  `${(name || 'atlas').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'atlas'}-lessons.md`;

export function lessonsMarkdown(name: string, lessons: string, when: Date = new Date()): string {
  const lines = lessons.split('\n').map((l) => l.trim().replace(/^[-*]\s*/, '')).filter(Boolean);
  return [
    `# What ${name || 'Atlas'} has learned`,
    '',
    `Updated ${when.toISOString().slice(0, 16).replace('T', ' ')}. Written by the learning loop; the assistant follows these lessons.`,
    '',
    ...(lines.length ? lines.map((l) => `- ${l}`) : ['(No lessons yet.)']),
    '',
  ].join('\n');
}

/** Saves the file. Never throws: a full disk or missing permission must not stop learning. */
export async function writeLessonsFile(name: string, lessons: string): Promise<string | null> {
  try {
    const RNFS = require('react-native-fs');
    const { workspaceDir } = require('../atlasTools/deviceTools');
    const dir = `${await workspaceDir()}/Learning`;
    await RNFS.mkdir(dir);
    const path = `${dir}/${lessonsFileName(name)}`;
    await RNFS.writeFile(path, lessonsMarkdown(name, lessons), 'utf8');
    return path;
  } catch {
    return null;
  }
}
