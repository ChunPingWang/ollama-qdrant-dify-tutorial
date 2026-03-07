/**
 * 向量資料庫服務層
 *
 * 架構說明：
 * ┌──────────────────────────────────────────────────────────────┐
 * │                    Hub (中央摘要庫)                           │
 * │  Collection: "hub_summaries"                                │
 * │  內容: 每份文件的摘要 embedding + module routing metadata    │
 * │  用途: 跨模組搜尋時先路由到相關模組                           │
 * ├──────────────────────────────────────────────────────────────┤
 * │  Module A          │  Module B          │  Module C          │
 * │  Collection:       │  Collection:       │  Collection:       │
 * │  "mod_banking"     │  "mod_microservice"│  "mod_devops"      │
 * │  完整文件切片      │  完整文件切片       │  完整文件切片      │
 * │  + 細粒度 embed    │  + 細粒度 embed    │  + 細粒度 embed    │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 搜尋流程：
 * 1. 查詢 → Hub 摘要庫 → 找到 top-N 相關模組
 * 2. 到目標模組的向量庫執行細粒度搜尋
 * 3. 合併結果返回
 */

import { ChromaClient, Collection } from 'chromadb';
import { Logger } from 'winston';

// ── 設定 ────────────────────────────────────────────────
const CHROMA_HOST = process.env.CHROMA_HOST ?? 'localhost';
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT ?? '8000', 10);
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text';

const HUB_COLLECTION = 'hub_summaries';
const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 300;

// ── Embedding 工具 ──────────────────────────────────────
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!response.ok) {
    throw new Error(`Ollama embed failed: ${response.status}`);
  }
  const data = await response.json();
  return data.embeddings;
}

// ── 文字切片 ────────────────────────────────────────────
export interface TextChunk {
  text: string;
  index: number;
  metadata: Record<string, string | number>;
}

export function chunkText(
  text: string,
  sourceFile: string,
  extraMeta?: Record<string, string | number>,
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push({
        text: chunk,
        index,
        metadata: {
          sourceFile,
          chunkIndex: index,
          ...extraMeta,
        },
      });
      index++;
    }
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

// ── 摘要產生 ────────────────────────────────────────────
async function generateSummary(text: string): Promise<string> {
  // 取前 2000 字元做摘要（由 LLM 或簡單截取）
  const preview = text.slice(0, 2000);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBED_MODEL.replace('embed', 'chat') || 'llama3',
        prompt: `用 100 字以內摘要以下文件內容，僅回傳摘要本身：\n\n${preview}`,
        stream: false,
        options: { num_ctx: 4096 },
      }),
    });
    if (response.ok) {
      const data = await response.json();
      return data.response?.trim() ?? preview.slice(0, 200);
    }
  } catch {
    // fallback: 使用前 200 字元
  }
  return preview.slice(0, 200);
}

// ── 主服務類別 ──────────────────────────────────────────
export class VectorDbService {
  private client: ChromaClient;
  private logger: Logger;

  constructor(logger: Logger) {
    this.client = new ChromaClient({ path: `http://${CHROMA_HOST}:${CHROMA_PORT}` });
    this.logger = logger;
  }

  /** 取得或建立模組的 collection */
  private async getModuleCollection(moduleId: string): Promise<Collection> {
    const name = `mod_${moduleId}`;
    return this.client.getOrCreateCollection({
      name,
      metadata: { 'hnsw:space': 'cosine' },
    });
  }

  /** 取得 Hub 摘要 collection */
  private async getHubCollection(): Promise<Collection> {
    return this.client.getOrCreateCollection({
      name: HUB_COLLECTION,
      metadata: { 'hnsw:space': 'cosine' },
    });
  }

  // ── 文件寫入 ──────────────────────────────────────────

  /** 將文件切片並存入模組向量庫，同時更新 Hub 摘要 */
  async ingestDocument(
    moduleId: string,
    documentId: string,
    fileName: string,
    fullText: string,
    tags: string[] = [],
  ): Promise<{ chunkCount: number; summary: string }> {
    this.logger.info(`Ingesting document ${documentId} into module ${moduleId}`);

    // 1. 切片
    const chunks = chunkText(fullText, fileName);
    if (chunks.length === 0) {
      throw new Error('Document produced no text chunks');
    }

    // 2. 批次 embedding 並寫入模組 collection
    const collection = await this.getModuleCollection(moduleId);
    const batchSize = 50;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);
      const embeddings = await getEmbeddings(texts);

      await collection.add({
        ids: batch.map((c) => `${documentId}_chunk_${c.index}`),
        documents: texts,
        embeddings,
        metadatas: batch.map((c) => ({
          ...c.metadata,
          documentId,
          moduleId,
        })),
      });
    }

    // 3. 產生摘要並寫入 Hub
    const summary = await generateSummary(fullText);
    const hubCollection = await this.getHubCollection();
    const [summaryEmbedding] = await getEmbeddings([summary]);

    await hubCollection.upsert({
      ids: [`summary_${moduleId}_${documentId}`],
      documents: [summary],
      embeddings: [summaryEmbedding],
      metadatas: [
        {
          documentId,
          moduleId,
          fileName,
          tags: tags.join(','),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    this.logger.info(
      `Ingested ${chunks.length} chunks for ${documentId}, summary synced to Hub`,
    );

    return { chunkCount: chunks.length, summary };
  }

  /** 從模組向量庫和 Hub 刪除文件 */
  async removeDocument(moduleId: string, documentId: string): Promise<void> {
    // 從模組 collection 刪除所有相關 chunk
    const collection = await this.getModuleCollection(moduleId);
    const existing = await collection.get({
      where: { documentId: { $eq: documentId } },
    });
    if (existing.ids.length > 0) {
      await collection.delete({ ids: existing.ids });
    }

    // 從 Hub 刪除摘要
    const hubCollection = await this.getHubCollection();
    await hubCollection.delete({
      ids: [`summary_${moduleId}_${documentId}`],
    });

    this.logger.info(`Removed document ${documentId} from module ${moduleId}`);
  }

  // ── 搜尋 ─────────────────────────────────────────────

  /** 模組內搜尋 */
  async searchInModule(
    moduleId: string,
    query: string,
    topK: number = 10,
  ): Promise<Array<{
    documentId: string;
    chunkText: string;
    similarity: number;
    metadata: Record<string, any>;
  }>> {
    const collection = await this.getModuleCollection(moduleId);
    const [queryEmbedding] = await getEmbeddings([query]);

    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
    });

    return (results.ids[0] ?? []).map((id, i) => ({
      documentId: (results.metadatas?.[0]?.[i] as any)?.documentId ?? '',
      chunkText: results.documents?.[0]?.[i] ?? '',
      similarity: 1 - (results.distances?.[0]?.[i] ?? 1),
      metadata: (results.metadatas?.[0]?.[i] as Record<string, any>) ?? {},
    }));
  }

  /**
   * 跨模組搜尋（兩階段）：
   * 1. 查 Hub 摘要庫 → 找到 top 相關模組
   * 2. 到目標模組做細粒度搜尋
   */
  async searchAcrossModules(
    query: string,
    moduleIds?: string[],
    topK: number = 10,
  ): Promise<{
    results: Array<{
      documentId: string;
      moduleId: string;
      chunkText: string;
      similarity: number;
      metadata: Record<string, any>;
    }>;
    routedModules: string[];
    totalTime: number;
  }> {
    const startTime = Date.now();

    // Stage 1: 查 Hub 摘要庫找出相關模組
    const hubCollection = await this.getHubCollection();
    const [queryEmbedding] = await getEmbeddings([query]);

    const hubResults = await hubCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: 20, // 多取一些，之後 deduplicate 模組
    });

    // 從 Hub 結果提取相關模組（去重）
    const moduleScores = new Map<string, number>();
    (hubResults.metadatas?.[0] ?? []).forEach((meta, i) => {
      const mid = (meta as any)?.moduleId;
      if (!mid) return;
      if (moduleIds && !moduleIds.includes(mid)) return;
      const score = 1 - (hubResults.distances?.[0]?.[i] ?? 1);
      const existing = moduleScores.get(mid) ?? 0;
      if (score > existing) moduleScores.set(mid, score);
    });

    // 取 top-3 相關模組
    const targetModules = [...moduleScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id);

    if (targetModules.length === 0) {
      return { results: [], routedModules: [], totalTime: Date.now() - startTime };
    }

    // Stage 2: 到各模組並行搜尋
    const moduleSearches = targetModules.map((mid) =>
      this.searchInModule(mid, query, topK).then((results) =>
        results.map((r) => ({ ...r, moduleId: mid })),
      ),
    );
    const allResults = (await Promise.all(moduleSearches)).flat();

    // 合併後依相似度排序
    allResults.sort((a, b) => b.similarity - a.similarity);

    return {
      results: allResults.slice(0, topK),
      routedModules: targetModules,
      totalTime: Date.now() - startTime,
    };
  }

  /** 重建某模組在 Hub 的摘要 */
  async rebuildModuleSummaries(
    moduleId: string,
    documents: Array<{ id: string; fileName: string; text: string; tags: string[] }>,
  ): Promise<void> {
    const hubCollection = await this.getHubCollection();

    // 先刪除該模組的舊摘要
    const existing = await hubCollection.get({
      where: { moduleId: { $eq: moduleId } },
    });
    if (existing.ids.length > 0) {
      await hubCollection.delete({ ids: existing.ids });
    }

    // 重新產生並寫入
    for (const doc of documents) {
      const summary = await generateSummary(doc.text);
      const [embedding] = await getEmbeddings([summary]);

      await hubCollection.add({
        ids: [`summary_${moduleId}_${doc.id}`],
        documents: [summary],
        embeddings: [embedding],
        metadatas: [
          {
            documentId: doc.id,
            moduleId,
            fileName: doc.fileName,
            tags: doc.tags.join(','),
            updatedAt: new Date().toISOString(),
          },
        ],
      });
    }

    this.logger.info(
      `Rebuilt ${documents.length} summaries for module ${moduleId}`,
    );
  }
}
