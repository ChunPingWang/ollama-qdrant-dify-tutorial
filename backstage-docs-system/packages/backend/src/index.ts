/**
 * Backstage 文件管理系統 — Backend 入口
 *
 * 整合 Hub Router + Module Router + VectorDbService
 */

import express from 'express';
import { createLogger, format, transports } from 'winston';
import { VectorDbService } from './services/vectorDbService';
import { createDocsHubRouter } from './plugins/docsHubRouter';
import { createDocsModuleRouter } from './plugins/docsModuleRouter';

const PORT = parseInt(process.env.BACKEND_PORT ?? '7007', 10);

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}] ${message}`;
    }),
  ),
  transports: [new transports.Console()],
});

async function main() {
  const app = express();
  app.use(express.json());

  // 初始化向量資料庫服務
  const vectorDb = new VectorDbService(logger);

  // 掛載 Hub API
  app.use('/api/docs-hub', createDocsHubRouter({ logger, vectorDb }));

  // 掛載 Module API
  app.use('/api/docs-module', createDocsModuleRouter({ logger, vectorDb }));

  // 健康檢查
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'backstage-docs-backend' });
  });

  app.listen(PORT, () => {
    logger.info(`Backstage Docs Backend listening on port ${PORT}`);
  });
}

main().catch((err) => {
  logger.error('Backend startup failed:', err);
  process.exit(1);
});
