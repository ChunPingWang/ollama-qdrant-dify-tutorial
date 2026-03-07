/**
 * 文件解析器：將各種格式轉為純文字，供後續切片和向量化使用。
 *
 * 支援格式：PDF, Word (.doc/.docx), Excel (.xls/.xlsx/.csv), Markdown, 純文字
 */

import * as fs from 'fs';
import * as path from 'path';

// ── 解析結果 ────────────────────────────────────────────
export interface ParsedDocument {
  text: string;
  metadata: {
    pageCount?: number;
    sheetNames?: string[];
    wordCount: number;
  };
  sections: ParsedSection[];
}

export interface ParsedSection {
  title?: string;
  text: string;
  page?: number;
  sheet?: string;
}

type DocumentFormat = 'pdf' | 'text' | 'markdown' | 'word' | 'excel';

// ── 格式偵測 ────────────────────────────────────────────
export function detectFormat(fileName: string): DocumentFormat | null {
  const ext = path.extname(fileName).toLowerCase();
  const formatMap: Record<string, DocumentFormat> = {
    '.pdf': 'pdf',
    '.txt': 'text',
    '.text': 'text',
    '.md': 'markdown',
    '.mdx': 'markdown',
    '.doc': 'word',
    '.docx': 'word',
    '.xls': 'excel',
    '.xlsx': 'excel',
    '.csv': 'excel',
  };
  return formatMap[ext] ?? null;
}

// ── PDF 解析 ────────────────────────────────────────────
async function parsePdf(buffer: Buffer): Promise<ParsedDocument> {
  const pdfParse = await import('pdf-parse');
  const data = await pdfParse.default(buffer);

  const sections: ParsedSection[] = [];
  // pdf-parse 回傳整篇文字；依雙換行分段
  const paragraphs = data.text.split(/\n{2,}/);
  let currentPage = 1;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    sections.push({ text: trimmed, page: currentPage });
    // 粗略估算頁碼（每 3000 字元約一頁）
    if (trimmed.length > 3000) currentPage++;
  }

  return {
    text: data.text,
    metadata: {
      pageCount: data.numpages,
      wordCount: data.text.split(/\s+/).length,
    },
    sections,
  };
}

// ── Word 解析 ───────────────────────────────────────────
async function parseWord(buffer: Buffer): Promise<ParsedDocument> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  const sections: ParsedSection[] = text
    .split(/\n{2,}/)
    .filter((s: string) => s.trim())
    .map((s: string) => ({ text: s.trim() }));

  return {
    text,
    metadata: { wordCount: text.split(/\s+/).length },
    sections,
  };
}

// ── Excel 解析 ──────────────────────────────────────────
async function parseExcel(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
  const isCsv = fileName.toLowerCase().endsWith('.csv');

  if (isCsv) {
    const text = buffer.toString('utf-8');
    return {
      text,
      metadata: {
        sheetNames: ['CSV'],
        wordCount: text.split(/\s+/).length,
      },
      sections: [{ text, sheet: 'CSV' }],
    };
  }

  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sections: ParsedSection[] = [];
  const allText: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // 轉為 CSV 格式的文字
    const csv = XLSX.utils.sheet_to_csv(sheet);
    // 轉為可讀的表格文字
    const json = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as string[][];
    const readable = json
      .map((row: string[]) => row.filter(Boolean).join(' | '))
      .filter(Boolean)
      .join('\n');

    const sectionText = `[工作表: ${sheetName}]\n${readable}`;
    sections.push({ text: sectionText, sheet: sheetName });
    allText.push(sectionText);
  }

  const text = allText.join('\n\n');
  return {
    text,
    metadata: {
      sheetNames: workbook.SheetNames,
      wordCount: text.split(/\s+/).length,
    },
    sections,
  };
}

// ── Markdown 解析 ───────────────────────────────────────
async function parseMarkdown(buffer: Buffer): Promise<ParsedDocument> {
  const text = buffer.toString('utf-8');

  // 依標題分段
  const sections: ParsedSection[] = [];
  const headerPattern = /^(#{1,6})\s+(.+)$/gm;
  let lastIndex = 0;
  let lastTitle: string | undefined;
  let match: RegExpExecArray | null;

  while ((match = headerPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const sectionText = text.slice(lastIndex, match.index).trim();
      if (sectionText) {
        sections.push({ title: lastTitle, text: sectionText });
      }
    }
    lastTitle = match[2];
    lastIndex = match.index + match[0].length;
  }

  // 最後一段
  const remaining = text.slice(lastIndex).trim();
  if (remaining) {
    sections.push({ title: lastTitle, text: remaining });
  }

  if (sections.length === 0) {
    sections.push({ text });
  }

  return {
    text,
    metadata: { wordCount: text.split(/\s+/).length },
    sections,
  };
}

// ── 純文字解析 ──────────────────────────────────────────
async function parseText(buffer: Buffer): Promise<ParsedDocument> {
  const text = buffer.toString('utf-8');
  const sections = text
    .split(/\n{2,}/)
    .filter((s) => s.trim())
    .map((s) => ({ text: s.trim() }));

  return {
    text,
    metadata: { wordCount: text.split(/\s+/).length },
    sections: sections.length > 0 ? sections : [{ text }],
  };
}

// ── 統一入口 ────────────────────────────────────────────
export async function parseFile(
  buffer: Buffer,
  fileName: string,
): Promise<ParsedDocument> {
  const format = detectFormat(fileName);
  if (!format) {
    throw new Error(`Unsupported file format: ${path.extname(fileName)}`);
  }

  switch (format) {
    case 'pdf':
      return parsePdf(buffer);
    case 'word':
      return parseWord(buffer);
    case 'excel':
      return parseExcel(buffer, fileName);
    case 'markdown':
      return parseMarkdown(buffer);
    case 'text':
      return parseText(buffer);
    default:
      throw new Error(`Unhandled format: ${format}`);
  }
}
