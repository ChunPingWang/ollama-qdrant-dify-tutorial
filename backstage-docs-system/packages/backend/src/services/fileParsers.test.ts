import { detectFormat, parseFile } from './fileParsers';

// ── detectFormat ────────────────────────────────────────
describe('detectFormat', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['notes.txt', 'text'],
    ['notes.text', 'text'],
    ['README.md', 'markdown'],
    ['guide.mdx', 'markdown'],
    ['spec.doc', 'word'],
    ['spec.docx', 'word'],
    ['data.xls', 'excel'],
    ['data.xlsx', 'excel'],
    ['data.csv', 'excel'],
  ])('detects %s as %s', (fileName, expected) => {
    expect(detectFormat(fileName)).toBe(expected);
  });

  it('is case-insensitive for extensions', () => {
    expect(detectFormat('FILE.PDF')).toBe('pdf');
    expect(detectFormat('DATA.XLSX')).toBe('excel');
    expect(detectFormat('DOC.MD')).toBe('markdown');
  });

  it('returns null for unsupported formats', () => {
    expect(detectFormat('image.png')).toBeNull();
    expect(detectFormat('video.mp4')).toBeNull();
    expect(detectFormat('archive.zip')).toBeNull();
    expect(detectFormat('noext')).toBeNull();
  });
});

// ── parseFile: plain text ───────────────────────────────
describe('parseFile — plain text', () => {
  it('parses single-paragraph text', async () => {
    const buffer = Buffer.from('Hello world, this is a test document.');
    const result = await parseFile(buffer, 'test.txt');

    expect(result.text).toBe('Hello world, this is a test document.');
    expect(result.metadata.wordCount).toBeGreaterThan(0);
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    expect(result.sections[0].text).toBe('Hello world, this is a test document.');
  });

  it('splits text by double newlines into sections', async () => {
    const buffer = Buffer.from('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
    const result = await parseFile(buffer, 'multi.txt');

    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].text).toBe('First paragraph.');
    expect(result.sections[1].text).toBe('Second paragraph.');
    expect(result.sections[2].text).toBe('Third paragraph.');
  });

  it('handles empty text gracefully', async () => {
    const buffer = Buffer.from('');
    const result = await parseFile(buffer, 'empty.txt');

    expect(result.text).toBe('');
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
  });

  it('counts words correctly', async () => {
    const buffer = Buffer.from('one two three four five');
    const result = await parseFile(buffer, 'words.txt');

    expect(result.metadata.wordCount).toBe(5);
  });
});

// ── parseFile: markdown ─────────────────────────────────
describe('parseFile — markdown', () => {
  it('splits sections by headers', async () => {
    const md = `# Title

Introduction text here.

## Section A

Content A.

## Section B

Content B.`;
    const buffer = Buffer.from(md);
    const result = await parseFile(buffer, 'doc.md');

    expect(result.sections.length).toBeGreaterThanOrEqual(3);
    // First section has no title (content before first header)
    // or title is undefined for the intro block
    const sectionTexts = result.sections.map((s) => s.text);
    expect(sectionTexts.some((t) => t.includes('Introduction'))).toBe(true);
    expect(sectionTexts.some((t) => t.includes('Content A'))).toBe(true);
    expect(sectionTexts.some((t) => t.includes('Content B'))).toBe(true);
  });

  it('captures header titles', async () => {
    const md = `# Main Title

Some text.

## Sub Section

More text.`;
    const buffer = Buffer.from(md);
    const result = await parseFile(buffer, 'headers.md');

    const titles = result.sections.map((s) => s.title).filter(Boolean);
    expect(titles).toContain('Main Title');
    expect(titles).toContain('Sub Section');
  });

  it('handles markdown without headers', async () => {
    const md = 'Just some plain text in a markdown file.';
    const buffer = Buffer.from(md);
    const result = await parseFile(buffer, 'plain.md');

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].text).toBe(md);
  });
});

// ── parseFile: CSV (excel format) ───────────────────────
describe('parseFile — CSV', () => {
  it('parses CSV content as text', async () => {
    const csv = 'name,age,city\nAlice,30,Taipei\nBob,25,Tokyo';
    const buffer = Buffer.from(csv);
    const result = await parseFile(buffer, 'data.csv');

    expect(result.text).toContain('Alice');
    expect(result.text).toContain('Bob');
    expect(result.metadata.sheetNames).toEqual(['CSV']);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].sheet).toBe('CSV');
  });
});

// ── parseFile: unsupported format ───────────────────────
describe('parseFile — unsupported', () => {
  it('throws for unsupported file formats', async () => {
    const buffer = Buffer.from('binary data');
    await expect(parseFile(buffer, 'image.png')).rejects.toThrow(
      'Unsupported file format',
    );
  });
});
