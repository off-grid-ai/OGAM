/** Source chips: built from a web search result, tap to see the quote and link, and clear about what was and was not checked. */
import { requireRTL } from '../harness/nativeBoundary';

it('shows a chip per search result, opens its quote and link, and says it was not checked against the source', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { CitationChips } = require('../../src/components/CitationChips');
  const { sourcesFromSearch } = require('../../src/study/citations');
  const content = 'Results from duckduckgo:\n\n1. [IRS Publication 17](https://www.irs.gov/pub17)\n   Your guide to federal income tax.\n\n2. [Tax basics](https://example.org/basics/page)\n   Basis is what you paid.';
  const cites = sourcesFromSearch(content);
  expect(cites.map((c: any) => c.title)).toEqual(['IRS Publication 17', 'Tax basics']);
  const r = rtl.render(React.createElement(CitationChips, { cites }));
  expect(r.getByText('1 irs.gov')).toBeTruthy();
  expect(r.getByText('2 example.org')).toBeTruthy();
  expect(r.queryByTestId('chip-detail')).toBeNull();
  rtl.fireEvent.press(r.getByTestId('chip-0'));
  expect(r.getByText('"Your guide to federal income tax."')).toBeTruthy();
  expect(r.getByText('https://www.irs.gov/pub17')).toBeTruthy();
  expect(r.getByTestId('chip-status').props.children).toMatch(/Not checked against the source/);
  rtl.fireEvent.press(r.getByTestId('chip-0'));
  expect(r.queryByTestId('chip-detail')).toBeNull();
});

it('marks a quote found in the source as verified', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { CitationChips } = require('../../src/components/CitationChips');
  const { verifyCitations } = require('../../src/study/citations');
  const cites = verifyCitations([{ title: 'Book', page: 3, quote: 'Assets equal liabilities plus equity' }], () => 'In short: assets equal liabilities plus equity.');
  const r = rtl.render(React.createElement(CitationChips, { cites }));
  rtl.fireEvent.press(r.getByTestId('chip-0'));
  expect(r.getByTestId('chip-status').props.children).toBe('Quote found in the source.');
});

it('offers to open the project document a source came from', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { CitationChips } = require('../../src/components/CitationChips');
  const { navigationRef } = require('../../src/navigation/navigationRef');
  const navigate = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => undefined);
  const cites = [{ title: 'tax-guide.pdf (part 3)', quote: 'Returns are due April 15.', verified: true, file: { path: '/docs/tax-guide.pdf', name: 'tax-guide.pdf', size: 900 } }, { title: 'No file', quote: 'q', verified: true }];
  const r = rtl.render(React.createElement(CitationChips, { cites }));
  rtl.fireEvent.press(r.getByTestId('chip-1'));
  expect(r.queryByTestId('chip-open-document')).toBeNull();
  rtl.fireEvent.press(r.getByTestId('chip-0'));
  rtl.fireEvent.press(r.getByTestId('chip-open-document'));
  expect(navigate).toHaveBeenCalledWith('DocumentPreview', { filePath: '/docs/tax-guide.pdf', fileName: 'tax-guide.pdf', fileSize: 900 });
  navigate.mockRestore();
});
