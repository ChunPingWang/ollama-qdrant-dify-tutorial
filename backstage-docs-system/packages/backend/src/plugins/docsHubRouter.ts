/**
 * Hub 中央管理 Backend Router
 *
 * 提供模組註冊、跨模組搜尋、摘要管理 API
 */

import { Router } from 'express';
import { Logger } from 'winston';
import { VectorDbService } from '../services/vectorDbService';

// ── 模組 metadata 儲存（正式環境應用 DB） ───────────────
interface ModuleRecord {
  id: string;
  name: string;
  description: string;
  icon?: string;
  vectorDbCollection: string;
  documentCount: number;
  lastUpdated: string;
  tags: string[];
}

const moduleStore = new Map<string, ModuleRecord>();

// ── Router ──────────────────────────────────────────────
export function createDocsHubRouter(options: {
  logger: Logger;
  vectorDb: VectorDbService;
}): Router {
  const { logger, vectorDb } = options;
  const router = Router();

  // GET /api/docs-hub/modules — 列出所有模組
  router.get('/modules', (_req, res) => {
    res.json([...moduleStore.values()]);
  });

  // GET /api/docs-hub/modules/:id — 取得單一模組
  router.get('/modules/:id', (req, res) => {
    const mod = moduleStore.get(req.params.id);
    if (!mod) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }
    res.json(mod);
  });

  // POST /api/docs-hub/modules — 註冊新模組
  router.post('/modules', (req, res) => {
    const { id, name, description, icon, tags = [] } = req.body;

    if (!id || !name) {
      res.status(400).json({ error: 'id and name are required' });
      return;
    }

    if (moduleStore.has(id)) {
      res.status(409).json({ error: 'Module already exists' });
      return;
    }

    const record: ModuleRecord = {
      id,
      name,
      description: description ?? '',
      icon,
      vectorDbCollection: `mod_${id}`,
      documentCount: 0,
      lastUpdated: new Date().toISOString(),
      tags,
    };

    moduleStore.set(id, record);
    logger.info(`Registered module: ${id} (${name})`);
    res.status(201).json(record);
  });

  // DELETE /api/docs-hub/modules/:id — 移除模組
  router.delete('/modules/:id', (req, res) => {
    const { id } = req.params;
    if (!moduleStore.has(id)) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }
    moduleStore.delete(id);
    logger.info(`Removed module: ${id}`);
    res.status(204).send();
  });

  // POST /api/docs-hub/search — 跨模組語意搜尋
  router.post('/search', async (req, res) => {
    const { query, moduleIds, topK = 10, includeChunks = true } = req.body;

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const results = await vectorDb.searchAcrossModules(query, moduleIds, topK);
      res.json(results);
    } catch (err) {
      logger.error('Cross-module search failed:', err);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // GET /api/docs-hub/summaries — 列出 Hub 摘要
  router.get('/summaries', async (req, res) => {
    const moduleId = req.query.moduleId as string | undefined;
    // 回傳模組的摘要記錄（從向量庫的 metadata 取得）
    // 簡化實作：回傳已知的模組資訊
    const modules = moduleId
      ? [moduleStore.get(moduleId)].filter(Boolean)
      : [...moduleStore.values()];

    res.json(
      modules.map((mod) => ({
        moduleId: mod!.id,
        moduleName: mod!.name,
        documentCount: mod!.documentCount,
        lastUpdated: mod!.lastUpdated,
      })),
    );
  });

  // POST /api/docs-hub/summaries/:moduleId/rebuild — 重建模組摘要
  router.post('/summaries/:moduleId/rebuild', async (req, res) => {
    const { moduleId } = req.params;
    logger.info(`Rebuilding summaries for module: ${moduleId}`);

    if (!moduleStore.has(moduleId)) {
      res.status(404).json({ error: 'Module not found' });
      return;
    }

    try {
      // 從 documentStore 取得該模組所有文件的解析文字
      const { getModuleDocuments } = await import('./docsModuleRouter');
      const moduleDocs = getModuleDocuments(moduleId);

      if (moduleDocs.length === 0) {
        res.json({ message: 'No documents to rebuild', count: 0 });
        return;
      }

      await vectorDb.rebuildModuleSummaries(
        moduleId,
        moduleDocs.map((doc) => ({
          id: doc.id,
          fileName: doc.fileName,
          text: doc.parsedText,
          tags: doc.tags,
        })),
      );

      const mod = moduleStore.get(moduleId)!;
      mod.lastUpdated = new Date().toISOString();

      logger.info(`Rebuilt ${moduleDocs.length} summaries for module ${moduleId}`);
      res.json({
        message: `Summary rebuild completed for module ${moduleId}`,
        count: moduleDocs.length,
      });
    } catch (err) {
      logger.error(`Summary rebuild failed for ${moduleId}:`, err);
      res.status(500).json({ error: 'Rebuild failed' });
    }
  });

  return router;
}
