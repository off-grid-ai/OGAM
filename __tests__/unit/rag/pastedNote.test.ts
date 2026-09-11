import { modelTransferFsBoundary } from '../../utils/modelTransferFsBoundary';
import {
  noteTitle,
  writePastedNote,
} from '../../../src/services/adapters/rag/pastedNoteFileAdapter';

jest.mock('react-native-fs', () => {
  const {
    modelTransferFsBoundary: boundary,
  } = require('../../utils/modelTransferFsBoundary');
  return { __esModule: true, default: boundary.module };
});

const fs = modelTransferFsBoundary.module;
const NOTES_DIRECTORY = `${modelTransferFsBoundary.DocumentDirectoryPath}/knowledge_base`;

/**
 * Pasting text into the knowledge base.
 *
 * A pasted note is written as a real .txt file rather than a special kind of row, so it travels the path
 * everything else does: the same extract-chunk-embed pipeline indexes it, the knowledge screen opens it, and
 * document sync ships it to the user's other devices unchanged.
 *
 * That means the FILE has to be right, which is why this runs over a real in-memory filesystem: the text
 * must be readable back byte for byte, the name has to work as a filename on both platforms, and the size
 * shown against it has to be the size on disk - a pasted note is full of characters that are not one byte
 * each, and a character count would understate every note that contains an emoji or an accent.
 */
describe('pasting text into the knowledge base', () => {
  const at = (iso: string) => () => new Date(iso).getTime();

  beforeEach(() => {
    modelTransferFsBoundary.reset();
  });

  it('writes a real text file the rest of the pipeline can pick up', async () => {
    const note = await writePastedNote(
      'Standup notes',
      'ship the mesh\nfix the grid',
    );

    expect(note.filePath).toBe(`${NOTES_DIRECTORY}/Standup notes.txt`);
    expect(note.fileName).toBe('Standup notes.txt');
    // Read back from disk: this is the file the indexer will open, not a record of an intention to write it.
    expect(await fs.readFile(note.filePath)).toBe(
      'ship the mesh\nfix the grid',
    );
  });

  it('creates the notes directory the first time one is pasted', async () => {
    expect(await fs.exists(NOTES_DIRECTORY)).toBe(false);

    await writePastedNote('First note', 'hello');

    // On a fresh install nothing has been imported yet, so the directory the picker would have made does
    // not exist. Writing into a missing directory fails, and the note would be lost with the sheet closed.
    expect(await fs.exists(NOTES_DIRECTORY)).toBe(true);
  });

  it('reports the size on disk, not the number of characters', async () => {
    const note = await writePastedNote('Sizes', 'a£€𝄞');

    // One, two, three and four bytes: the row under the note shows this number, and a character count would
    // read 4 bytes for a note that occupies ten.
    expect(note.fileSize).toBe(1 + 2 + 3 + 4);
    expect(note.fileSize).toBe((await fs.stat(note.filePath)).size);
  });

  it('reports zero for an empty note', async () => {
    const note = await writePastedNote('Empty', '');

    expect(note.fileSize).toBe(0);
    expect(await fs.exists(note.filePath)).toBe(true);
  });

  describe('naming what the user typed', () => {
    it('uses the title as it was written', () => {
      expect(noteTitle('Q3 planning')).toBe('Q3 planning');
    });

    it('takes path separators out rather than escaping them', () => {
      // A note is not allowed to address another directory. Escaping would keep the intent alive; removing
      // it ends the question.
      expect(noteTitle('notes/2026/q3')).toBe('notes 2026 q3');
      expect(noteTitle('notes\\q3')).toBe('notes q3');
      // The leading dots go with them, so a traversal attempt lands as an ordinary name in the notes folder
      // and nowhere else.
      expect(noteTitle('../../etc/passwd')).toBe('.. etc passwd');
    });

    it('does not let a note hide itself', () => {
      // A leading dot is a hidden file on both platforms - the note would be indexed and synced but invisible
      // in the knowledge base the user is looking at.
      expect(noteTitle('.gitignore')).toBe('gitignore');
      expect(noteTitle('...secret')).toBe('secret');
    });

    it('collapses the whitespace a paste brings with it', () => {
      expect(noteTitle('  Meeting    notes \n\t here  ')).toBe(
        'Meeting notes here',
      );
    });

    it('cuts a title long enough to break a filename', () => {
      const title = 'x'.repeat(200);

      // Filesystems cap a path component, so an uncut title fails the write outright - and it fails after
      // the sheet has closed, which reads as the note silently vanishing.
      expect(noteTitle(title)).toHaveLength(60);
    });

    it.each([
      ['nothing typed', ''],
      ['only spaces', '   '],
      ['only dots', '...'],
      ['only separators', '///'],
    ])(
      'falls back to the moment it was saved when there is %s',
      (_label, title) => {
        const named = noteTitle(title, at('2026-08-04T09:15:30.000Z'));

        // Saveable without a title, and still findable afterwards: the time is what the user has to go on.
        expect(named).toBe('Note 2026-08-04T09:15:30');
      },
    );

    it('names the file from the same fallback when the note is saved untitled', async () => {
      const note = await writePastedNote(
        '',
        'pasted in a hurry',
        at('2026-08-04T09:15:30.000Z'),
      );

      // One rule, one owner: the filename comes from the same function the title does, so a note cannot end
      // up displayed under one name and stored under another.
      expect(note.fileName).toBe('Note 2026-08-04T09:15:30.txt');
      expect(await fs.readFile(note.filePath)).toBe('pasted in a hurry');
    });
  });
});
