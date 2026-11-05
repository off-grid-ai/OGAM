/** A ```chart block in a reply is drawn as a chart with its source; bad data says why; and the prompt only mentions charts when asked. */
import { requireRTL } from '../harness/nativeBoundary';

it('draws a pie with percentages that add to 100 and its source, and refuses malformed data', () => {
  const rtl = requireRTL();
  const React = require('react');
  const { MarkdownText } = require('../../src/components/MarkdownText');
  const { chartNote, shares } = require('../../src/study/chart');
  const good = '```chart\n{"type":"pie","title":"Filing method","labels":["E-file","Paper","Other"],"values":[81,15,4],"unit":"%","source":"IRS data book p. 4"}\n```';
  const r = rtl.render(React.createElement(MarkdownText, null, good));
  expect(r.getByTestId('chart-card')).toBeTruthy();
  expect(r.getByText('Filing method')).toBeTruthy();
  expect(r.getByText(/81% \(81 %\)/)).toBeTruthy();
  expect(r.getByText('Source: IRS data book p. 4')).toBeTruthy();
  expect(shares([1, 1, 1]).reduce((a: number, b: number) => a + b, 0)).toBe(100);

  const bad = rtl.render(React.createElement(MarkdownText, null, '```chart\n{"type":"pie","labels":["a"],"values":[1]}\n```'));
  expect(bad.queryByTestId('chart-card')).toBeNull();
  expect(bad.getByText(/matching labels and values/)).toBeTruthy();

  const noSrc = rtl.render(React.createElement(MarkdownText, null, '```chart\n{"type":"bar","labels":["a","b"],"values":[2,3]}\n```'));
  expect(noSrc.getByText(/No source given/)).toBeTruthy();
  expect(chartNote('what is 81% of 200?')).toMatch(/chart/);
  expect(chartNote('hello there')).toBe('');
});
