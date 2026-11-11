import { htmlToMarkdown, csvToMarkdown, jsonToMarkdown, pdfTextToMarkdown, docxToMarkdown, tableMarkdown, toMarkdown, slideMarkdown, sheetMarkdown, parseDelimited } from '../../src/services/markdownConvert';

describe('documents as Markdown', () => {
  it('makes a table from rows, padded, with the first row as the header', () => {
    expect(tableMarkdown([['Item', 'Q1'], ['Revenue', '100', 'x'], ['Pipe | here', '5']])).toBe('| Item | Q1 |  |\n| --- | --- | --- |\n| Revenue | 100 | x |\n| Pipe \\| here | 5 |  |');
    expect(tableMarkdown([])).toBe('');
  });

  describe('HTML', () => {
    it('keeps headings, links, emphasis, lists and code, and drops scripts and styles', () => {
      const md = htmlToMarkdown('<html><head><title>x</title></head><body><nav>menu</nav><h1>Guide</h1><p>Read <a href="https://a.test/x">the docs</a> and <strong>stay</strong> <em>calm</em>.</p><h2>Steps</h2><ul><li>One</li><li>Two</li></ul><pre>a &lt; b</pre><script>bad()</script></body></html>');
      expect(md).toContain('# Guide');
      expect(md).toContain('Read [the docs](https://a.test/x) and **stay** *calm*.');
      expect(md).toContain('## Steps');
      expect(md).toContain('- One\n- Two');
      expect(md).toContain('```\na < b\n```');
      expect(md).not.toContain('bad()');
      expect(md).not.toContain('menu');
    });
    it('turns a table into a Markdown table', () => {
      const md = htmlToMarkdown('<table><tr><th>Name</th><th>Dose</th></tr><tr><td>Aspirin</td><td>300 mg</td></tr></table>');
      expect(md).toContain('| Name | Dose |\n| --- | --- |\n| Aspirin | 300 mg |');
    });
    it('keeps only the words of a link that is not a web address', () => {
      expect(htmlToMarkdown('<a href="javascript:x()">click</a>')).toBe('click');
    });
  });

  describe('CSV, TSV and JSON', () => {
    it('reads quoted fields and commas inside them', () => {
      expect(parseDelimited('a,"b,c","say ""hi"""\n1,2,3', ',')).toEqual([['a', 'b,c', 'say "hi"'], ['1', '2', '3']]);
    });
    it('makes a table', () => {
      expect(csvToMarkdown('Item,Qty\nBandage,4\n')).toBe('| Item | Qty |\n| --- | --- |\n| Bandage | 4 |');
      expect(csvToMarkdown('a\tb\n1\t2', '\t')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    });
    it('formats JSON as a code block and leaves invalid JSON alone', () => {
      expect(jsonToMarkdown('{"a":1}')).toBe('```json\n{\n  "a": 1\n}\n```');
      expect(jsonToMarkdown('not json')).toBe('not json');
    });
  });

  describe('PDF text', () => {
    it('makes headings only where a line clearly is one', () => {
      const text = ['Chapter 2 Cash flow', '', 'Cash moves in and out of a business.', '', '2.1 Operating cash', '', 'Money from sales is counted here.', '', 'KEY TERMS', '', 'This sentence is long and ends with a period.', 'Total revenue was 5 million.'].join('\n');
      const md = pdfTextToMarkdown(text);
      expect(md).toContain('# Chapter 2 Cash flow');
      expect(md).toContain('### 2.1 Operating cash');
      expect(md).toContain('## KEY TERMS');
      expect(md).toContain('Cash moves in and out of a business.');
      expect(md).not.toMatch(/^#+ This sentence/m);
      expect(md).not.toMatch(/^#+ Total revenue/m);
    });
    it('does not turn a sentence or a list line into a heading', () => {
      const md = pdfTextToMarkdown('1. First step is to wash your hands.\n\nThe END of the day');
      expect(md).not.toContain('#');
    });
  });

  describe('Word', () => {
    const p = (text: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
    it('keeps headings, bold, lists and tables', () => {
      const xml = `<w:document><w:body>${p('Report', '<w:pStyle w:val="Heading1"/>')}${p('Intro text.')}${p('Details', '<w:pStyle w:val="Heading2"/>')}`
        + `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Important</w:t></w:r><w:r><w:t> note</w:t></w:r></w:p>`
        + `${p('First', '<w:numPr><w:ilvl w:val="0"/></w:numPr>')}${p('Second', '<w:numPr><w:ilvl w:val="0"/></w:numPr>')}`
        + `<w:tbl><w:tr><w:tc>${p('Name')}</w:tc><w:tc>${p('Dose')}</w:tc></w:tr><w:tr><w:tc>${p('Aspirin')}</w:tc><w:tc>${p('300 mg')}</w:tc></w:tr></w:tbl></w:body></w:document>`;
      const md = docxToMarkdown(xml);
      expect(md).toContain('# Report');
      expect(md).toContain('## Details');
      expect(md).toContain('**Important** note');
      expect(md).toContain('- First\n- Second');
      expect(md).toContain('| Name | Dose |\n| --- | --- |\n| Aspirin | 300 mg |');
    });
  });

  it('formats a slide and a sheet', () => {
    expect(slideMarkdown(2, { title: 'Budget', paragraphs: ['Q1 up', '', 'Q2 flat'], notes: 'say thanks' })).toBe('## Slide 2: Budget\n- Q1 up\n- Q2 flat\n\nNotes: say thanks');
    expect(sheetMarkdown('Totals', [['a', 'b'], ['1', '2']])).toBe('## Sheet: Totals\n\n| a | b |\n| --- | --- |\n| 1 | 2 |');
  });

  it('converts by file extension and leaves other kinds as they are', () => {
    expect(toMarkdown('<h1>Hi</h1>', '.HTML')).toBe('# Hi');
    expect(toMarkdown('a,b\n1,2', '.csv')).toContain('| a | b |');
    expect(toMarkdown('# Already markdown', '.md')).toBe('# Already markdown');
    expect(toMarkdown('plain text', '.txt')).toBe('plain text');
  });
});

import { chunkDocument, withSectionContext } from '../../src/services/rag/chunking';

describe('search chunks of a Markdown document know their section', () => {
  const para = (k: string) => `${k} ${'sentence about the topic. '.repeat(12)}`;
  it('prefix each chunk with the headings above it', () => {
    const text = `# Accounting\n\n${para('intro')}\n\n## Cash flow\n\n${para('cash')}\n\n## Taxes\n\n${para('tax')}\n\n### Deadlines\n\n${para('deadline')}`;
    const chunks = chunkDocument(text, { chunkSize: 420, overlap: 40 });
    const cash = chunks.find((c) => c.content.includes('cash sentence'))!;
    expect(cash.content.startsWith('[Accounting > Cash flow]\n')).toBe(true);
    const deadline = chunks.find((c) => c.content.includes('deadline sentence'))!;
    expect(deadline.content).toMatch(/^\[Accounting > Taxes > Deadlines\]\n|^### Deadlines/);
  });
  it('leave text without headings exactly as it was', () => {
    const text = `${para('one')}\n\n${para('two')}`;
    expect(chunkDocument(text, { chunkSize: 420, overlap: 40 })).toEqual(withSectionContext(text, chunkDocument(text, { chunkSize: 420, overlap: 40 })));
    expect(chunkDocument(text, { chunkSize: 420, overlap: 40 }).every((c) => !c.content.startsWith('['))).toBe(true);
  });
  it('do not repeat a heading a chunk already starts with', () => {
    const text = `# Title\n\n${para('body')}`;
    const [first] = chunkDocument(text, { chunkSize: 900, overlap: 40 });
    expect(first.content.startsWith('# Title')).toBe(true);
    expect(first.content.startsWith('[')).toBe(false);
  });
});

import { markdownFileName } from '../../src/services/markdownConvert';
it('names the Markdown copy of a file', () => {
  expect(markdownFileName('Report.docx')).toBe('Report.md');
  expect(markdownFileName('notes.md')).toBe('notes.md');
  expect(markdownFileName('a/b:c.pdf')).toBe('a_b_c.md');
  expect(markdownFileName('')).toBe('document.md');
});
