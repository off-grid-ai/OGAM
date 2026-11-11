import { claimsFileWork, fileWasWritten, fileClaimNote, NO_FILE_NOTE } from '../../src/services/fileClaim';

describe('a model claiming it saved a file', () => {
  it.each([
    "I've created the file notes.md with your plan.",
    'I have saved the report to Documents/report.txt.',
    'The document has been saved. You can open it now.',
    'Done! Saved it to plan.md',
    'I wrote the page for you as index.html.',
  ])('is noticed: %s', (t) => expect(claimsFileWork(t)).toBe(true));

  it.each([
    'Here is the plan you asked for: first, second, third.',
    'You can save this as a file if you like.',
    'I created a list of ideas below.',
  ])('is not mistaken for a claim: %s', (t) => expect(claimsFileWork(t)).toBe(false));

  it('is true when the file tool really saved something this turn', () => {
    expect(fileWasWritten([{ role: 'tool', toolName: 'write_file', content: 'Saved /x/notes.md (120 characters).' }])).toBe(true);
    expect(fileWasWritten([{ role: 'tool', toolName: 'update_project_document', content: 'Added to the project document "Progress".' }])).toBe(true);
  });
  it('is false when the tool was declined, empty, failed or never called', () => {
    expect(fileWasWritten([{ role: 'tool', toolName: 'write_file', content: 'The user declined, or did not answer in time. Nothing was written.' }])).toBe(false);
    expect(fileWasWritten([{ role: 'tool', toolName: 'write_file', content: 'Nothing was written: the content was empty.' }])).toBe(false);
    expect(fileWasWritten([{ role: 'tool', toolName: 'calculator', content: 'Saved 4' }])).toBe(false);
    expect(fileWasWritten([])).toBe(false);
  });
  it('adds the note only for a false claim', () => {
    expect(fileClaimNote("I've saved the file.", [])).toBe(NO_FILE_NOTE);
    expect(fileClaimNote("I've saved the file.", [{ role: 'tool', toolName: 'write_file', content: 'Saved /a.md (3 characters).' }])).toBe('');
    expect(fileClaimNote('Here is the text.', [])).toBe('');
  });
});
