/** Turning a rendered markdown table (the parser's node tree) into text that pastes well elsewhere. */
export type TableNode = { type?: string; content?: string; children?: TableNode[] };

const cellText = (node: TableNode): string => {
  if (node.content) return node.content;
  return (node.children ?? []).map(cellText).join('');
};

/** Rows of cell text, header row first. */
export function tableRows(table: TableNode): string[][] {
  const rows: string[][] = [];
  const visit = (node: TableNode) => {
    if (node.type === 'tr') {
      rows.push((node.children ?? []).map((c) => cellText(c).replace(/\s+/g, ' ').trim()));
      return;
    }
    (node.children ?? []).forEach(visit);
  };
  visit(table);
  return rows;
}

/** Tab-separated: pastes into a spreadsheet as cells. */
export const tableToTsv = (rows: string[][]): string => rows.map((r) => r.join('\t')).join('\n');

/** Markdown table text, header row first. */
export function tableToMarkdown(rows: string[][]): string {
  if (!rows.length) return '';
  const line = (r: string[]) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n');
}
