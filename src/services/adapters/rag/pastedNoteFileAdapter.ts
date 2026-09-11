import RNFS from 'react-native-fs';

/** Where pasted notes are kept, beside the files a picker imports. */
const NOTES_DIRECTORY = `${RNFS.DocumentDirectoryPath}/knowledge_base`;

/** The longest a note title may be before it is cut, so a filename stays a filename. */
const MAX_TITLE_LENGTH = 60;

export interface PastedNote {
  filePath: string;
  fileName: string;
  fileSize: number;
}

/**
 * Write pasted text as a real .txt document.
 *
 * Pasted text becomes a FILE rather than a special kind of row, so it travels the same path as
 * everything else: the same extract-chunk-embed pipeline indexes it, the knowledge-base screen can
 * open it, and knowledge-document sync ships it to your other devices unchanged. A second, file-less
 * document type would have needed all of that written again.
 */
export async function writePastedNote(
  title: string,
  text: string,
  now: () => number = Date.now,
): Promise<PastedNote> {
  const fileName = `${noteTitle(title, now)}.txt`;
  await RNFS.mkdir(NOTES_DIRECTORY);
  const filePath = `${NOTES_DIRECTORY}/${fileName}`;
  await RNFS.writeFile(filePath, text, 'utf8');
  return {
    filePath,
    fileName,
    // The byte length, not the character count: a pasted note is full of characters that are not one
    // byte each, and the size shown against it should be the size on disk.
    fileSize: byteLength(text),
  };
}

/**
 * A filename from what the user typed, falling back to the moment they saved.
 *
 * Path separators and leading dots are stripped rather than escaped: a knowledge-base note has no
 * business addressing another directory or hiding itself.
 */
export function noteTitle(title: string, now: () => number = Date.now): string {
  const cleaned = title
    .replace(/[/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return cleaned || `Note ${new Date(now()).toISOString().slice(0, 19)}`;
}

function byteLength(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
