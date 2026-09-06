const DETAIL_FIELDS = new Set([
  "sourcePath",
  "relativeSourcePath",
  "sourceHash",
  "headings",
  "sections",
  "summary",
  "summarySource",
  "keySections"
]);

export function createCatalogBook(book) {
  return {
    ...Object.fromEntries(Object.entries(book).filter(([key]) => !DETAIL_FIELDS.has(key))),
    contentVersion: book.sourceHash?.slice(0, 16)
  };
}

export function createCatalogSummary(manifest) {
  return {
    ...manifest,
    books: manifest.books.map(createCatalogBook)
  };
}

export function createBookDetail(book) {
  return {
    bookId: book.id,
    relativeSourcePath: book.relativeSourcePath,
    sourceHash: book.sourceHash,
    headings: book.headings || [],
    sections: book.sections || [],
    summary: book.summary || book.excerpt || "",
    summarySource: book.summarySource,
    keySections: book.keySections || []
  };
}

export function createBookDetailMap(manifest) {
  return new Map(manifest.books.map((book) => [book.id, createBookDetail(book)]));
}
