/**
 * 文件管理系統共用型別定義
 */

// ── 文件格式 ────────────────────────────────────────────
export type DocumentFormat = 'pdf' | 'text' | 'markdown' | 'word' | 'excel';

export const SUPPORTED_FORMATS: Record<DocumentFormat, string[]> = {
  pdf: ['.pdf'],
  text: ['.txt', '.text'],
  markdown: ['.md', '.mdx'],
  word: ['.doc', '.docx'],
  excel: ['.xls', '.xlsx', '.csv'],
};

export const SUPPORTED_MIME_TYPES: Record<DocumentFormat, string[]> = {
  pdf: ['application/pdf'],
  text: ['text/plain'],
  markdown: ['text/markdown', 'text/x-markdown'],
  word: [
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  excel: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ],
};

// ── 模組定義 ────────────────────────────────────────────
export interface DocsModule {
  id: string;
  name: string;
  description: string;
  icon?: string;
  vectorDbCollection: string;
  documentCount: number;
  lastUpdated: string;
  tags: string[];
}

// ── 文件實體 ────────────────────────────────────────────
export interface Document {
  id: string;
  moduleId: string;
  title: string;
  fileName: string;
  format: DocumentFormat;
  size: number;
  uploadedAt: string;
  updatedAt: string;
  uploadedBy: string;
  tags: string[];
  summary?: string;
  chunkCount: number;
  status: DocumentStatus;
}

export type DocumentStatus =
  | 'uploading'
  | 'parsing'
  | 'embedding'
  | 'ready'
  | 'error';

// ── 向量資料庫相關 ──────────────────────────────────────
export interface VectorSearchResult {
  documentId: string;
  moduleId: string;
  chunkText: string;
  similarity: number;
  metadata: ChunkMetadata;
}

export interface ChunkMetadata {
  page?: number;
  section?: string;
  chunkIndex: number;
  sourceFile: string;
}

/** Hub 層摘要記錄：僅存各模組文件的摘要 embedding，用於跨模組路由 */
export interface HubSummaryRecord {
  documentId: string;
  moduleId: string;
  title: string;
  summary: string;
  tags: string[];
  updatedAt: string;
}

// ── 查詢相關 ────────────────────────────────────────────
export interface SearchQuery {
  query: string;
  moduleIds?: string[];       // 限定搜尋的模組，空 = 全部
  topK?: number;
  includeChunks?: boolean;
}

export interface SearchResponse {
  results: VectorSearchResult[];
  routedModules: string[];    // Hub 路由到的模組
  totalTime: number;          // 毫秒
}

// ── 上傳相關 ────────────────────────────────────────────
export interface UploadRequest {
  moduleId: string;
  files: File[];
  tags?: string[];
}

export interface UploadProgress {
  fileId: string;
  fileName: string;
  status: DocumentStatus;
  progress: number;           // 0-100
  error?: string;
}
