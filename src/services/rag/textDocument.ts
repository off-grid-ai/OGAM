/** Plain-text documents (notes written in Atlas, .md and .txt files) can be read and edited in Atlas. */
export const isTextDocument = (doc: { name: string; path: string }): boolean =>
  doc.path.startsWith('atlas-note:') || /\.(md|txt|markdown)$/i.test(doc.name);
