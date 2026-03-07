import express from 'express';
import request from 'supertest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger, transports } from 'winston';
import { createDocsModuleRouter } from './docsModuleRouter';

// Mock VectorDbService
const mockVectorDb = {
  ingestDocument: jest.fn().mockResolvedValue({ chunkCount: 5, summary: 'test summary' }),
  removeDocument: jest.fn().mockResolvedValue(undefined),
  searchInModule: jest.fn().mockResolvedValue([]),
  searchAcrossModules: jest.fn(),
  rebuildModuleSummaries: jest.fn(),
} as any;

// Mock fileParsers to avoid needing real PDF/Word libraries
jest.mock('../services/fileParsers', () => ({
  detectFormat: jest.fn((fileName: string) => {
    const ext = path.extname(fileName).toLowerCase();
    const map: Record<string, string> = {
      '.pdf': 'pdf', '.txt': 'text', '.md': 'markdown',
      '.doc': 'word', '.docx': 'word', '.csv': 'excel',
    };
    return map[ext] ?? null;
  }),
  parseFile: jest.fn().mockResolvedValue({
    text: 'parsed document text content',
    metadata: { wordCount: 4 },
    sections: [{ text: 'parsed document text content' }],
  }),
}));

const logger = createLogger({ silent: true, transports: [new transports.Console()] });

// Override upload/parsed dirs to temp
const tmpDir = path.join(os.tmpdir(), 'backstage-docs-test-' + Date.now());
process.env.DOCS_UPLOAD_DIR = path.join(tmpDir, 'uploads');
process.env.DOCS_PARSED_DIR = path.join(tmpDir, 'parsed');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', createDocsModuleRouter({ logger, vectorDb: mockVectorDb }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  // Cleanup temp dirs
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('DocsModule Router — Document List', () => {
  it('GET /:moduleId/documents returns empty array initially', async () => {
    const app = createApp();
    const res = await request(app).get('/test-module/documents');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('DocsModule Router — Upload', () => {
  it('POST /:moduleId/documents/upload accepts a text file', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/upload-test/documents/upload')
      .attach('files', Buffer.from('hello world'), 'test.txt');

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].moduleId).toBe('upload-test');
    expect(res.body[0].fileName).toBe('test.txt');
    expect(res.body[0].format).toBe('text');
    expect(res.body[0].status).toBe('parsing');
    expect(res.body[0].id).toBeDefined();
  });

  it('POST upload accepts multiple files', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/multi/documents/upload')
      .attach('files', Buffer.from('file 1'), 'a.txt')
      .attach('files', Buffer.from('file 2'), 'b.md');

    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].fileName).toBe('a.txt');
    expect(res.body[1].fileName).toBe('b.md');
  });

  it('POST upload returns 400 with no files', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/nofiles/documents/upload')
      .send();

    expect(res.status).toBe(400);
  });

  it('POST upload parses tags from body', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/tags-test/documents/upload')
      .attach('files', Buffer.from('content'), 'doc.txt')
      .field('tags', JSON.stringify(['architecture', 'banking']));

    expect(res.status).toBe(201);
    expect(res.body[0].tags).toEqual(['architecture', 'banking']);
  });

  it('POST upload extracts title from filename', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/title-test/documents/upload')
      .attach('files', Buffer.from('data'), 'Microservices_Patterns.txt');

    expect(res.status).toBe(201);
    expect(res.body[0].title).toBe('Microservices_Patterns');
  });

  it('POST upload uses x-backstage-user header', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/auth-test/documents/upload')
      .set('x-backstage-user', 'alice@example.com')
      .attach('files', Buffer.from('data'), 'doc.txt');

    expect(res.status).toBe(201);
    expect(res.body[0].uploadedBy).toBe('alice@example.com');
  });

  it('POST upload defaults uploadedBy to anonymous', async () => {
    const app = createApp();

    const res = await request(app)
      .post('/anon-test/documents/upload')
      .attach('files', Buffer.from('data'), 'doc.txt');

    expect(res.status).toBe(201);
    expect(res.body[0].uploadedBy).toBe('anonymous');
  });
});

describe('DocsModule Router — Get Single Document', () => {
  it('GET /:moduleId/documents/:docId returns uploaded document', async () => {
    const app = createApp();

    const uploadRes = await request(app)
      .post('/get-mod/documents/upload')
      .attach('files', Buffer.from('content'), 'single.txt');

    const docId = uploadRes.body[0].id;

    const res = await request(app).get(`/get-mod/documents/${docId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(docId);
    expect(res.body.fileName).toBe('single.txt');
  });

  it('GET /:moduleId/documents/:docId returns 404 for wrong module', async () => {
    const app = createApp();

    const uploadRes = await request(app)
      .post('/mod-a/documents/upload')
      .attach('files', Buffer.from('content'), 'doc.txt');

    const docId = uploadRes.body[0].id;

    const res = await request(app).get(`/mod-b/documents/${docId}`);
    expect(res.status).toBe(404);
  });

  it('GET /:moduleId/documents/:docId returns 404 for unknown doc', async () => {
    const app = createApp();
    const res = await request(app).get('/any/documents/nonexistent-id');
    expect(res.status).toBe(404);
  });
});

describe('DocsModule Router — Delete', () => {
  it('DELETE /:moduleId/documents/:docId removes document', async () => {
    const app = createApp();

    const uploadRes = await request(app)
      .post('/del-mod/documents/upload')
      .attach('files', Buffer.from('to delete'), 'delete-me.txt');

    const docId = uploadRes.body[0].id;

    const delRes = await request(app).delete(`/del-mod/documents/${docId}`);
    expect(delRes.status).toBe(204);

    expect(mockVectorDb.removeDocument).toHaveBeenCalledWith('del-mod', docId);

    const getRes = await request(app).get(`/del-mod/documents/${docId}`);
    expect(getRes.status).toBe(404);
  });

  it('DELETE returns 404 for unknown document', async () => {
    const app = createApp();
    const res = await request(app).delete('/any/documents/ghost');
    expect(res.status).toBe(404);
  });
});

describe('DocsModule Router — Search', () => {
  it('POST /:moduleId/search calls vectorDb.searchInModule', async () => {
    const app = createApp();
    const mockResults = [
      { documentId: 'doc1', chunkText: 'chunk', similarity: 0.95, metadata: {} },
    ];
    mockVectorDb.searchInModule.mockResolvedValue(mockResults);

    const res = await request(app)
      .post('/search-mod/search')
      .send({ query: 'saga pattern', topK: 5 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockResults);
    expect(mockVectorDb.searchInModule).toHaveBeenCalledWith('search-mod', 'saga pattern', 5);
  });

  it('POST /:moduleId/search returns 400 without query', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/search-mod/search')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query is required');
  });

  it('POST /:moduleId/search returns 500 on vectorDb error', async () => {
    const app = createApp();
    mockVectorDb.searchInModule.mockRejectedValue(new Error('DB error'));

    const res = await request(app)
      .post('/search-mod/search')
      .send({ query: 'test' });

    expect(res.status).toBe(500);
  });

  it('POST /:moduleId/search uses default topK of 10', async () => {
    const app = createApp();
    mockVectorDb.searchInModule.mockResolvedValue([]);

    await request(app)
      .post('/default-k/search')
      .send({ query: 'test' });

    expect(mockVectorDb.searchInModule).toHaveBeenCalledWith('default-k', 'test', 10);
  });
});

describe('DocsModule Router — Reprocess', () => {
  it('POST /:moduleId/documents/:docId/reprocess triggers reprocessing', async () => {
    const app = createApp();

    const uploadRes = await request(app)
      .post('/rep-mod/documents/upload')
      .attach('files', Buffer.from('reprocess me'), 'reprocess.txt');

    const docId = uploadRes.body[0].id;

    const res = await request(app).post(`/rep-mod/documents/${docId}/reprocess`);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reprocessing started');
  });

  it('POST reprocess returns 404 for unknown document', async () => {
    const app = createApp();
    const res = await request(app).post('/any/documents/ghost/reprocess');
    expect(res.status).toBe(404);
  });
});
