/**
 * 文件模組 Backend Router
 *
 * 提供單一模組的文件 CRUD、上傳、搜尋 API
 */

import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { Logger } from 'winston';
import { parseFile, detectFormat } from '../services/fileParsers';
import { VectorDbService } from '../services/vectorDbService';

// ── 文件儲存設定 ────────────────────────────────────────
const UPLOAD_DIR = process.env.DOCS_UPLOAD_DIR ?? '/tmp/backstage-docs/uploads';
const PARSED_DIR = process.env.DOCS_PARSED_DIR ?? '/tmp/backstage-docs/parsed';

// 確保目錄存在
[UPLOAD_DIR, PARSED_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const format = detectFormat(file.originalname);
    if (format) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format: ${path.extname(file.originalname)}`));
    }
  },
});

// ── 簡易文件 metadata 儲存（正式環境應用 DB） ──────────
interface DocRecord {
  id: string;
  moduleId: string;
  title: string;
  fileName: string;
  format: string;
  size: number;
  uploadedAt: string;
  updatedAt: string;
  uploadedBy: string;
  tags: string[];
  summary: string;
  chunkCount: number;
  status: string;
  storagePath: string;
  parsedPath: string;
}

// 用 Map 暫存（正式環境換 PostgreSQL / SQLite）
const documentStore = new Map<string, DocRecord>();

/** 供 Hub rebuild 使用：取得模組下所有文件的 id、fileName、已解析文字、tags */
export function getModuleDocuments(moduleId: string): Array<{
  id: string;
  fileName: string;
  parsedText: string;
  tags: string[];
}> {
  return [...documentStore.values()]
    .filter((d) => d.moduleId === moduleId && d.status === 'ready')
    .map((d) => ({
      id: d.id,
      fileName: d.fileName,
      parsedText:
        d.parsedPath && fs.existsSync(d.parsedPath)
          ? fs.readFileSync(d.parsedPath, 'utf-8')
          : '',
      tags: d.tags,
    }))
    .filter((d) => d.parsedText.length > 0);
}

// ── Router ──────────────────────────────────────────────
export function createDocsModuleRouter(options: {
  logger: Logger;
  vectorDb: VectorDbService;
}): Router {
  const { logger, vectorDb } = options;
  const router = Router();

  // GET /api/docs-module/:moduleId/documents — 列出模組下所有文件
  router.get('/:moduleId/documents', (req, res) => {
    const { moduleId } = req.params;
    const docs = [...documentStore.values()].filter(
      (d) => d.moduleId === moduleId,
    );
    res.json(docs);
  });

  // GET /api/docs-module/:moduleId/documents/:docId — 取得單一文件
  router.get('/:moduleId/documents/:docId', (req, res) => {
    const doc = documentStore.get(req.params.docId);
    if (!doc || doc.moduleId !== req.params.moduleId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json(doc);
  });

  // POST /api/docs-module/:moduleId/documents/upload — 上傳文件
  router.post(
    '/:moduleId/documents/upload',
    upload.array('files', 20),
    async (req, res) => {
      const { moduleId } = req.params;
      const files = req.files as Express.Multer.File[];
      const tags: string[] = req.body.tags
        ? JSON.parse(req.body.tags)
        : [];

      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }

      const results: DocRecord[] = [];

      for (const file of files) {
        const docId = crypto.randomUUID();
        const format = detectFormat(file.originalname)!;

        const record: DocRecord = {
          id: docId,
          moduleId,
          title: path.basename(file.originalname, path.extname(file.originalname)),
          fileName: file.originalname,
          format,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          uploadedBy: (req.headers['x-backstage-user'] as string) ?? 'anonymous',
          tags,
          summary: '',
          chunkCount: 0,
          status: 'parsing',
          storagePath: file.path,
          parsedPath: '',
        };

        documentStore.set(docId, record);

        // 非同步處理：解析 → 向量化
        processDocument(record, logger, vectorDb).catch((err) => {
          logger.error(`Failed to process document ${docId}:`, err);
          record.status = 'error';
        });

        results.push(record);
      }

      res.status(201).json(results);
    },
  );

  // DELETE /api/docs-module/:moduleId/documents/:docId — 刪除文件
  router.delete('/:moduleId/documents/:docId', async (req, res) => {
    const { moduleId, docId } = req.params;
    const doc = documentStore.get(docId);
    if (!doc || doc.moduleId !== moduleId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    try {
      await vectorDb.removeDocument(moduleId, docId);
      // 清理檔案
      if (doc.storagePath && fs.existsSync(doc.storagePath)) {
        fs.unlinkSync(doc.storagePath);
      }
      if (doc.parsedPath && fs.existsSync(doc.parsedPath)) {
        fs.unlinkSync(doc.parsedPath);
      }
      documentStore.delete(docId);
      res.status(204).send();
    } catch (err) {
      logger.error(`Failed to delete document ${docId}:`, err);
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // GET /api/docs-module/:moduleId/documents/:docId/content — 取得解析後文字
  router.get('/:moduleId/documents/:docId/content', (req, res) => {
    const doc = documentStore.get(req.params.docId);
    if (!doc || doc.moduleId !== req.params.moduleId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    if (!doc.parsedPath || !fs.existsSync(doc.parsedPath)) {
      res.status(404).json({ error: 'Parsed content not available' });
      return;
    }
    const content = fs.readFileSync(doc.parsedPath, 'utf-8');
    res.type('text/plain').send(content);
  });

  // POST /api/docs-module/:moduleId/documents/:docId/reprocess — 重新處理
  router.post('/:moduleId/documents/:docId/reprocess', async (req, res) => {
    const doc = documentStore.get(req.params.docId);
    if (!doc || doc.moduleId !== req.params.moduleId) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    doc.status = 'parsing';
    processDocument(doc, logger, vectorDb).catch((err) => {
      logger.error(`Reprocess failed for ${doc.id}:`, err);
      doc.status = 'error';
    });
    res.json({ message: 'Reprocessing started' });
  });

  // POST /api/docs-module/:moduleId/search — 模組內語意搜尋
  router.post('/:moduleId/search', async (req, res) => {
    const { moduleId } = req.params;
    const { query, topK = 10 } = req.body;

    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const results = await vectorDb.searchInModule(moduleId, query, topK);
      res.json(results);
    } catch (err) {
      logger.error(`Search failed in module ${moduleId}:`, err);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  return router;
}

// ── 非同步文件處理流程 ──────────────────────────────────
async function processDocument(
  record: DocRecord,
  logger: Logger,
  vectorDb: VectorDbService,
): Promise<void> {
  try {
    // 1. 解析
    record.status = 'parsing';
    const buffer = fs.readFileSync(record.storagePath);
    const parsed = await parseFile(buffer, record.fileName);

    // 儲存解析後文字
    const parsedPath = path.join(PARSED_DIR, `${record.id}.txt`);
    fs.writeFileSync(parsedPath, parsed.text, 'utf-8');
    record.parsedPath = parsedPath;

    // 2. 向量化
    record.status = 'embedding';
    const result = await vectorDb.ingestDocument(
      record.moduleId,
      record.id,
      record.fileName,
      parsed.text,
      record.tags,
    );

    // 3. 更新記錄
    record.chunkCount = result.chunkCount;
    record.summary = result.summary;
    record.status = 'ready';
    record.updatedAt = new Date().toISOString();

    logger.info(
      `Document ${record.id} processed: ${result.chunkCount} chunks, summary synced`,
    );
  } catch (err) {
    record.status = 'error';
    throw err;
  }
}
