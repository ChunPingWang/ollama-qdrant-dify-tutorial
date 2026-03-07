import express from 'express';
import request from 'supertest';
import { createLogger, transports } from 'winston';
import { createDocsHubRouter } from './docsHubRouter';

// Mock VectorDbService
const mockVectorDb = {
  searchAcrossModules: jest.fn(),
  rebuildModuleSummaries: jest.fn(),
  ingestDocument: jest.fn(),
  removeDocument: jest.fn(),
  searchInModule: jest.fn(),
} as any;

const logger = createLogger({ silent: true, transports: [new transports.Console()] });

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', createDocsHubRouter({ logger, vectorDb: mockVectorDb }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('DocsHub Router — Module CRUD', () => {
  it('GET /modules returns empty array initially', async () => {
    const app = createApp();
    const res = await request(app).get('/modules');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('POST /modules registers a new module', async () => {
    const app = createApp();
    const payload = {
      id: 'test-mod',
      name: 'Test Module',
      description: 'A test module',
      tags: ['test'],
    };

    const res = await request(app).post('/modules').send(payload);

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('test-mod');
    expect(res.body.name).toBe('Test Module');
    expect(res.body.vectorDbCollection).toBe('mod_test-mod');
    expect(res.body.documentCount).toBe(0);
    expect(res.body.tags).toEqual(['test']);
  });

  it('POST /modules returns 400 without id or name', async () => {
    const app = createApp();

    const res1 = await request(app).post('/modules').send({ name: 'No ID' });
    expect(res1.status).toBe(400);

    const res2 = await request(app).post('/modules').send({ id: 'no-name' });
    expect(res2.status).toBe(400);
  });

  it('POST /modules returns 409 for duplicate id', async () => {
    const app = createApp();
    const payload = { id: 'dup', name: 'First' };

    await request(app).post('/modules').send(payload);
    const res = await request(app).post('/modules').send(payload);

    expect(res.status).toBe(409);
  });

  it('GET /modules/:id returns registered module', async () => {
    const app = createApp();
    await request(app)
      .post('/modules')
      .send({ id: 'get-test', name: 'Get Test' });

    const res = await request(app).get('/modules/get-test');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('get-test');
  });

  it('GET /modules/:id returns 404 for unknown module', async () => {
    const app = createApp();
    const res = await request(app).get('/modules/nonexistent');

    expect(res.status).toBe(404);
  });

  it('DELETE /modules/:id removes a module', async () => {
    const app = createApp();
    await request(app)
      .post('/modules')
      .send({ id: 'del-test', name: 'Delete Me' });

    const delRes = await request(app).delete('/modules/del-test');
    expect(delRes.status).toBe(204);

    const getRes = await request(app).get('/modules/del-test');
    expect(getRes.status).toBe(404);
  });

  it('DELETE /modules/:id returns 404 for unknown module', async () => {
    const app = createApp();
    const res = await request(app).delete('/modules/ghost');

    expect(res.status).toBe(404);
  });
});

describe('DocsHub Router — Search', () => {
  it('POST /search calls vectorDb.searchAcrossModules', async () => {
    const app = createApp();
    const mockResult = {
      results: [
        { documentId: 'doc1', moduleId: 'mod1', chunkText: 'result', similarity: 0.9, metadata: {} },
      ],
      routedModules: ['mod1'],
      totalTime: 42,
    };
    mockVectorDb.searchAcrossModules.mockResolvedValue(mockResult);

    const res = await request(app)
      .post('/search')
      .send({ query: 'microservices saga', topK: 5 });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.routedModules).toEqual(['mod1']);
    expect(mockVectorDb.searchAcrossModules).toHaveBeenCalledWith(
      'microservices saga',
      undefined,
      5,
    );
  });

  it('POST /search returns 400 without query', async () => {
    const app = createApp();
    const res = await request(app).post('/search').send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('query is required');
  });

  it('POST /search returns 500 on vectorDb error', async () => {
    const app = createApp();
    mockVectorDb.searchAcrossModules.mockRejectedValue(new Error('ChromaDB down'));

    const res = await request(app)
      .post('/search')
      .send({ query: 'test' });

    expect(res.status).toBe(500);
  });

  it('POST /search passes moduleIds filter', async () => {
    const app = createApp();
    mockVectorDb.searchAcrossModules.mockResolvedValue({
      results: [],
      routedModules: [],
      totalTime: 1,
    });

    await request(app)
      .post('/search')
      .send({ query: 'test', moduleIds: ['mod-a', 'mod-b'], topK: 3 });

    expect(mockVectorDb.searchAcrossModules).toHaveBeenCalledWith(
      'test',
      ['mod-a', 'mod-b'],
      3,
    );
  });
});

describe('DocsHub Router — Summaries', () => {
  it('GET /summaries returns empty for no modules', async () => {
    const app = createApp();
    const res = await request(app).get('/summaries');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('GET /summaries returns module summary info', async () => {
    const app = createApp();
    await request(app)
      .post('/modules')
      .send({ id: 'sum-mod', name: 'Summary Module' });

    const res = await request(app).get('/summaries');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const found = res.body.find((s: any) => s.moduleId === 'sum-mod');
    expect(found).toBeDefined();
    expect(found.moduleName).toBe('Summary Module');
  });

  it('GET /summaries?moduleId= filters by module', async () => {
    const app = createApp();
    await request(app).post('/modules').send({ id: 'a', name: 'A' });
    await request(app).post('/modules').send({ id: 'b', name: 'B' });

    const res = await request(app).get('/summaries?moduleId=a');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].moduleId).toBe('a');
  });

  it('POST /summaries/:moduleId/rebuild returns 404 for unknown module', async () => {
    const app = createApp();
    const res = await request(app).post('/summaries/unknown/rebuild');

    expect(res.status).toBe(404);
  });
});
