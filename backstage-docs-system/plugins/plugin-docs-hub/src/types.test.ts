import { SUPPORTED_FORMATS, SUPPORTED_MIME_TYPES } from './types';
import type { DocumentFormat, DocumentStatus } from './types';

describe('SUPPORTED_FORMATS', () => {
  it('defines extensions for all formats', () => {
    const formats: DocumentFormat[] = ['pdf', 'text', 'markdown', 'word', 'excel'];

    for (const fmt of formats) {
      expect(SUPPORTED_FORMATS[fmt]).toBeDefined();
      expect(SUPPORTED_FORMATS[fmt].length).toBeGreaterThan(0);
      // Each extension should start with a dot
      for (const ext of SUPPORTED_FORMATS[fmt]) {
        expect(ext.startsWith('.')).toBe(true);
      }
    }
  });

  it('includes expected PDF extension', () => {
    expect(SUPPORTED_FORMATS.pdf).toContain('.pdf');
  });

  it('includes expected Word extensions', () => {
    expect(SUPPORTED_FORMATS.word).toContain('.doc');
    expect(SUPPORTED_FORMATS.word).toContain('.docx');
  });

  it('includes expected Excel extensions', () => {
    expect(SUPPORTED_FORMATS.excel).toContain('.xls');
    expect(SUPPORTED_FORMATS.excel).toContain('.xlsx');
    expect(SUPPORTED_FORMATS.excel).toContain('.csv');
  });

  it('includes expected Markdown extensions', () => {
    expect(SUPPORTED_FORMATS.markdown).toContain('.md');
    expect(SUPPORTED_FORMATS.markdown).toContain('.mdx');
  });

  it('includes expected Text extensions', () => {
    expect(SUPPORTED_FORMATS.text).toContain('.txt');
  });
});

describe('SUPPORTED_MIME_TYPES', () => {
  it('defines MIME types for all formats', () => {
    const formats: DocumentFormat[] = ['pdf', 'text', 'markdown', 'word', 'excel'];

    for (const fmt of formats) {
      expect(SUPPORTED_MIME_TYPES[fmt]).toBeDefined();
      expect(SUPPORTED_MIME_TYPES[fmt].length).toBeGreaterThan(0);
    }
  });

  it('PDF includes application/pdf', () => {
    expect(SUPPORTED_MIME_TYPES.pdf).toContain('application/pdf');
  });

  it('Word includes both legacy and modern MIME types', () => {
    expect(SUPPORTED_MIME_TYPES.word).toContain('application/msword');
    expect(
      SUPPORTED_MIME_TYPES.word.some((m) =>
        m.includes('wordprocessingml'),
      ),
    ).toBe(true);
  });

  it('Excel includes spreadsheet MIME types', () => {
    expect(SUPPORTED_MIME_TYPES.excel).toContain('application/vnd.ms-excel');
    expect(SUPPORTED_MIME_TYPES.excel).toContain('text/csv');
  });

  it('Text includes text/plain', () => {
    expect(SUPPORTED_MIME_TYPES.text).toContain('text/plain');
  });
});

describe('DocumentStatus type coverage', () => {
  it('all status values are valid strings', () => {
    const statuses: DocumentStatus[] = [
      'uploading',
      'parsing',
      'embedding',
      'ready',
      'error',
    ];
    expect(statuses).toHaveLength(5);
    statuses.forEach((s) => expect(typeof s).toBe('string'));
  });
});
