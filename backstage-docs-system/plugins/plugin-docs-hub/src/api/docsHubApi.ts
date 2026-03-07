import { createApiRef } from '@backstage/core-plugin-api';
import type {
  DocsModule,
  SearchQuery,
  SearchResponse,
  HubSummaryRecord,
} from '../types';

// ── API Reference ───────────────────────────────────────
export const docsHubApiRef = createApiRef<DocsHubApi>({
  id: 'plugin.docs-hub.api',
});

export interface DocsHubApi {
  /** 取得所有已註冊的文件模組 */
  listModules(): Promise<DocsModule[]>;

  /** 取得單一模組資訊 */
  getModule(moduleId: string): Promise<DocsModule>;

  /** 註冊新模組 */
  registerModule(module: Omit<DocsModule, 'documentCount' | 'lastUpdated'>): Promise<DocsModule>;

  /** 移除模組 */
  removeModule(moduleId: string): Promise<void>;

  /**
   * 跨模組搜尋：
   * 1. 先查 Hub 摘要向量庫，找出最相關的模組
   * 2. 再到目標模組的向量庫做細粒度搜尋
   */
  search(query: SearchQuery): Promise<SearchResponse>;

  /** 取得 Hub 層的摘要記錄（管理用） */
  listSummaries(moduleId?: string): Promise<HubSummaryRecord[]>;

  /** 手動觸發重建某模組的摘要 */
  rebuildSummary(moduleId: string): Promise<void>;
}

// ── API Client 實作 ─────────────────────────────────────
export class DocsHubClient implements DocsHubApi {
  private readonly baseUrl: string;

  constructor(options: { baseUrl: string }) {
    this.baseUrl = options.baseUrl;
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DocsHub API error ${response.status}: ${body}`);
    }
    return response.json();
  }

  async listModules(): Promise<DocsModule[]> {
    return this.fetch('/api/docs-hub/modules');
  }

  async getModule(moduleId: string): Promise<DocsModule> {
    return this.fetch(`/api/docs-hub/modules/${encodeURIComponent(moduleId)}`);
  }

  async registerModule(
    module: Omit<DocsModule, 'documentCount' | 'lastUpdated'>,
  ): Promise<DocsModule> {
    return this.fetch('/api/docs-hub/modules', {
      method: 'POST',
      body: JSON.stringify(module),
    });
  }

  async removeModule(moduleId: string): Promise<void> {
    await this.fetch(`/api/docs-hub/modules/${encodeURIComponent(moduleId)}`, {
      method: 'DELETE',
    });
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    return this.fetch('/api/docs-hub/search', {
      method: 'POST',
      body: JSON.stringify(query),
    });
  }

  async listSummaries(moduleId?: string): Promise<HubSummaryRecord[]> {
    const qs = moduleId ? `?moduleId=${encodeURIComponent(moduleId)}` : '';
    return this.fetch(`/api/docs-hub/summaries${qs}`);
  }

  async rebuildSummary(moduleId: string): Promise<void> {
    await this.fetch(`/api/docs-hub/summaries/${encodeURIComponent(moduleId)}/rebuild`, {
      method: 'POST',
    });
  }
}
