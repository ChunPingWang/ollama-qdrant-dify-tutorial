import { chunkText } from './vectorDbService';

describe('chunkText', () => {
  it('produces a single chunk for short text', () => {
    const text = 'Hello world';
    const chunks = chunkText(text, 'test.txt');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('Hello world');
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].metadata.sourceFile).toBe('test.txt');
    expect(chunks[0].metadata.chunkIndex).toBe(0);
  });

  it('chunks long text with overlap', () => {
    // CHUNK_SIZE=1500, CHUNK_OVERLAP=300 → stride=1200
    const text = 'A'.repeat(3000);
    const chunks = chunkText(text, 'long.txt');

    // 3000 chars → ceil(3000/1200) = 3 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(3);

    // Each chunk should be at most 1500 chars
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1500);
    }

    // Indices should be sequential
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('includes extra metadata when provided', () => {
    const chunks = chunkText('Some text', 'file.md', { page: 5 });

    expect(chunks[0].metadata.sourceFile).toBe('file.md');
    expect(chunks[0].metadata.page).toBe(5);
    expect(chunks[0].metadata.chunkIndex).toBe(0);
  });

  it('skips empty chunks from whitespace-only segments', () => {
    // text that is just whitespace at certain slice boundaries
    const text = 'content' + ' '.repeat(2000);
    const chunks = chunkText(text, 'sparse.txt');

    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('returns empty array for empty text', () => {
    const chunks = chunkText('', 'empty.txt');
    expect(chunks).toHaveLength(0);
  });

  it('handles text exactly at chunk size boundary', () => {
    const text = 'B'.repeat(1500);
    const chunks = chunkText(text, 'exact.txt');

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(text);
  });

  it('preserves source file name across all chunks', () => {
    const text = 'C'.repeat(5000);
    const chunks = chunkText(text, 'report.pdf');

    for (const chunk of chunks) {
      expect(chunk.metadata.sourceFile).toBe('report.pdf');
    }
  });
});
