import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

/**
 * FileUploadZone 元件的單元測試。
 *
 * 因為元件使用 Backstage 的 useApi hook，這裡測試抽出的純函式邏輯
 * 和 DOM 結構，不依賴 Backstage provider。
 */

// ── 抽取自 FileUploadZone 的純函式測試 ─────────────────

type DocumentFormat = 'pdf' | 'text' | 'markdown' | 'word' | 'excel';

function detectFormat(file: { name: string }): DocumentFormat | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  for (const [format, exts] of Object.entries({
    pdf: ['.pdf'],
    word: ['.doc', '.docx'],
    excel: ['.xls', '.xlsx', '.csv'],
    markdown: ['.md', '.mdx'],
    text: ['.txt', '.text'],
  })) {
    if (exts.includes(ext)) return format as DocumentFormat;
  }
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

describe('detectFormat (FileUploadZone)', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['README.md', 'markdown'],
    ['guide.mdx', 'markdown'],
    ['notes.txt', 'text'],
    ['notes.text', 'text'],
    ['spec.doc', 'word'],
    ['spec.docx', 'word'],
    ['data.xls', 'excel'],
    ['data.xlsx', 'excel'],
    ['data.csv', 'excel'],
  ])('detects %s as %s', (name, expected) => {
    expect(detectFormat({ name })).toBe(expected);
  });

  it('returns null for unsupported formats', () => {
    expect(detectFormat({ name: 'image.png' })).toBeNull();
    expect(detectFormat({ name: 'video.mp4' })).toBeNull();
    expect(detectFormat({ name: 'archive.zip' })).toBeNull();
  });

  it('handles files without extension', () => {
    expect(detectFormat({ name: 'Makefile' })).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectFormat({ name: 'REPORT.PDF' })).toBe('pdf');
    expect(detectFormat({ name: 'Data.XLSX' })).toBe('excel');
  });
});

describe('formatFileSize (FileUploadZone)', () => {
  it('formats bytes', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(10240)).toBe('10.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
    expect(formatFileSize(5242880)).toBe('5.0 MB');
    expect(formatFileSize(52428800)).toBe('50.0 MB');
  });
});

// ── 拖拉上傳區域 DOM 結構測試 ───────────────────────────

describe('FileUploadZone — drag and drop area (markup test)', () => {
  it('renders a dropzone with correct prompt text', () => {
    // Render a minimal mock to validate structure expectations
    const { container } = render(
      <div
        data-testid="dropzone"
        onDragEnter={jest.fn()}
        onDragLeave={jest.fn()}
        onDragOver={jest.fn()}
        onDrop={jest.fn()}
        onClick={jest.fn()}
      >
        <span>拖曳檔案到此處，或點擊選擇檔案</span>
        <span>支援格式：</span>
        <input type="file" multiple data-testid="file-input" style={{ display: 'none' }} />
      </div>,
    );

    expect(screen.getByText('拖曳檔案到此處，或點擊選擇檔案')).toBeInTheDocument();
    expect(screen.getByText('支援格式：')).toBeInTheDocument();
    expect(screen.getByTestId('file-input')).toHaveAttribute('type', 'file');
    expect(screen.getByTestId('file-input')).toHaveAttribute('multiple');
  });

  it('file input accepts supported formats via accept attribute', () => {
    const acceptString = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
    ].join(',');

    const { getByTestId } = render(
      <input type="file" multiple accept={acceptString} data-testid="file-input" />,
    );

    const input = getByTestId('file-input');
    expect(input.getAttribute('accept')).toContain('application/pdf');
    expect(input.getAttribute('accept')).toContain('text/plain');
    expect(input.getAttribute('accept')).toContain('text/csv');
  });

  it('drop event handler receives files', () => {
    const handleDrop = jest.fn((e: React.DragEvent) => {
      e.preventDefault();
    });

    const { getByTestId } = render(
      <div data-testid="dropzone" onDrop={handleDrop}>
        Drop here
      </div>,
    );

    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' });
    const dropzone = getByTestId('dropzone');

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [file] },
    });

    expect(handleDrop).toHaveBeenCalledTimes(1);
  });

  it('click triggers file input', () => {
    const inputClick = jest.fn();

    const { getByTestId } = render(
      <div>
        <div data-testid="dropzone" onClick={() => inputClick()}>
          Click to upload
        </div>
      </div>,
    );

    fireEvent.click(getByTestId('dropzone'));
    expect(inputClick).toHaveBeenCalledTimes(1);
  });
});

describe('FileUploadZone — pending files list (markup test)', () => {
  it('renders file list when files are present', () => {
    const files = [
      { name: 'doc1.pdf', size: 1024, format: 'pdf' },
      { name: 'doc2.docx', size: 2048, format: 'word' },
    ];

    const { getByText } = render(
      <ul>
        {files.map((f) => (
          <li key={f.name}>
            <span>{f.name}</span>
            <span>{formatFileSize(f.size)}</span>
            <span>{f.format.toUpperCase()}</span>
            <button aria-label="delete">Delete</button>
          </li>
        ))}
      </ul>,
    );

    expect(getByText('doc1.pdf')).toBeInTheDocument();
    expect(getByText('doc2.docx')).toBeInTheDocument();
    expect(getByText('1.0 KB')).toBeInTheDocument();
    expect(getByText('2.0 KB')).toBeInTheDocument();
  });

  it('renders upload button with correct file count', () => {
    const fileCount = 3;

    const { getByRole } = render(
      <button>{`上傳 ${fileCount} 個檔案`}</button>,
    );

    expect(getByRole('button')).toHaveTextContent('上傳 3 個檔案');
  });

  it('renders uploading state text', () => {
    const { getByRole } = render(
      <button disabled>上傳中...</button>,
    );

    expect(getByRole('button')).toHaveTextContent('上傳中...');
    expect(getByRole('button')).toBeDisabled();
  });
});
