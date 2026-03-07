import { createApiRef } from '@backstage/core-plugin-api';
import type {
  Document,
  DocumentFormat,
  UploadProgress,
  VectorSearchResult,
} from '@backstage-docs/plugin-docs-hub';

// Re-export types for convenience
export type { Document, UploadProgress, VectorSearchResult };

// ── API Reference ───────────────────────────────────────
export const docsModuleApiRef = createApiRef<DocsModuleApi>({
  id: 'plugin.docs-module.api',
});

export interface DocsModuleApi {
  /** 取得模組下的所有文件列表 */
  listDocuments(moduleId: string): Promise<Document[]>;

  /** 取得單一文件資訊 */
  getDocument(moduleId: string, documentId: string): Promise<Document>;

  /** 上傳文件（支援多檔） */
  uploadDocuments(
    moduleId: string,
    files: File[],
    tags?: string[],
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<Document[]>;

  /** 刪除文件 */
  deleteDocument(moduleId: string, documentId: string): Promise<void>;

  /** 在模組內搜尋 */
  searchInModule(
    moduleId: string,
    query: string,
    topK?: number,
  ): Promise<VectorSearchResult[]>;

  /** 取得文件的原始內容（解析後文字） */
  getDocumentContent(moduleId: string, documentId: string): Promise<string>;

  /** 重新處理文件（重新解析 + 嵌入） */
  reprocessDocument(moduleId: string, documentId: string): Promise<void>;

  /** 取得支援的文件格式 */
  getSupportedFormats(): DocumentFormat[];
}

// ── API Client 實作 ─────────────────────────────────────
export class DocsModuleClient implements DocsModuleApi {
  private readonly baseUrl: string;

  constructor(options: { baseUrl: string }) {
    this.baseUrl = options.baseUrl;
  }

  async listDocuments(moduleId: string): Promise<Document[]> {
    const res = await fetch(
      `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/documents`,
    );
    if (!res.ok) throw new Error(`Failed to list documents: ${res.status}`);
    return res.json();
  }

  async getDocument(moduleId: string, documentId: string): Promise<Document> {
    const res = await fetch(
      `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/documents/${encodeURIComponent(documentId)}`,
    );
    if (!res.ok) throw new Error(`Failed to get document: ${res.status}`);
    return res.json();
  }

  async uploadDocuments(
    moduleId: string,
    files: File[],
    tags?: string[],
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<Document[]> {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    if (tags?.length) {
      formData.append('tags', JSON.stringify(tags));
    }

    const xhr = new XMLHttpRequest();
    const url = `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/documents/upload`;

    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', event => {
        if (event.lengthComputable && onProgress) {
          const pct = Math.round((event.loaded / event.total) * 100);
          files.forEach(file => {
            onProgress({
              fileId: file.name,
              fileName: file.name,
              status: 'uploading',
              progress: pct,
            });
          });
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload network error')));
      xhr.open('POST', url);
      xhr.send(formData);
    });
  }

  async deleteDocument(moduleId: string, documentId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/documents/${encodeURIComponent(documentId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(`Failed to delete document: ${res.status}`);
  }

  async searchInModule(
    moduleId: string,
    query: string,
    topK = 10,
  ): Promise<VectorSearchResult[]> {
    const res = await fetch(
      `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK }),
      },
    );
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  }

  async getDocumentContent(moduleId: string, documentId: string): Promise<string> {
    const res = await fetch(
      `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/documents/${encodeURIComponent(documentId)}/content`,
    );
    if (!res.ok) throw new Error(`Failed to get content: ${res.status}`);
    return res.text();
  }

  async reprocessDocument(moduleId: string, documentId: string): Promise<void> {
    const res = await fetch(
      `${this.baseUrl}/api/docs-module/${encodeURIComponent(moduleId)}/documents/${encodeURIComponent(documentId)}/reprocess`,
      { method: 'POST' },
    );
    if (!res.ok) throw new Error(`Reprocess failed: ${res.status}`);
  }

  getSupportedFormats() {
    return ['pdf', 'text', 'markdown', 'word', 'excel'] as const;
  }
}
