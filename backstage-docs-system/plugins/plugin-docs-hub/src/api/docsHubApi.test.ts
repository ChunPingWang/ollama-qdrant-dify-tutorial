import { DocsHubClient } from './docsHubApi';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const client = new DocsHubClient({ baseUrl: 'http://localhost:7007' });

beforeEach(() => {
  mockFetch.mockReset();
});

function mockJsonResponse(data: any, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockErrorResponse(status: number, body: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

describe('DocsHubClient', () => {
  describe('listModules', () => {
    it('fetches /api/docs-hub/modules', async () => {
      const modules = [{ id: 'mod1', name: 'Module 1' }];
      mockJsonResponse(modules);

      const result = await client.listModules();

      expect(result).toEqual(modules);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/modules',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });

  describe('getModule', () => {
    it('fetches specific module by ID', async () => {
      const mod = { id: 'banking', name: 'Banking' };
      mockJsonResponse(mod);

      const result = await client.getModule('banking');

      expect(result).toEqual(mod);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/modules/banking',
        expect.anything(),
      );
    });

    it('encodes special characters in moduleId', async () => {
      mockJsonResponse({});
      await client.getModule('mod with spaces');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/modules/mod%20with%20spaces',
        expect.anything(),
      );
    });
  });

  describe('registerModule', () => {
    it('sends POST with module data', async () => {
      const input = {
        id: 'new-mod',
        name: 'New Module',
        description: 'desc',
        vectorDbCollection: 'mod_new-mod',
        tags: ['test'],
      };
      const response = { ...input, documentCount: 0, lastUpdated: '2025-01-01' };
      mockJsonResponse(response);

      const result = await client.registerModule(input);

      expect(result.documentCount).toBe(0);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/modules',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
    });
  });

  describe('removeModule', () => {
    it('sends DELETE request', async () => {
      mockJsonResponse(undefined);

      await client.removeModule('old-mod');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/modules/old-mod',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('search', () => {
    it('sends POST with search query', async () => {
      const searchResult = {
        results: [{ documentId: 'doc1', similarity: 0.9 }],
        routedModules: ['mod1'],
        totalTime: 100,
      };
      mockJsonResponse(searchResult);

      const result = await client.search({
        query: 'saga pattern',
        topK: 5,
        includeChunks: true,
      });

      expect(result.results).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/search',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('saga pattern'),
        }),
      );
    });
  });

  describe('listSummaries', () => {
    it('fetches summaries without filter', async () => {
      mockJsonResponse([]);
      await client.listSummaries();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/summaries',
        expect.anything(),
      );
    });

    it('fetches summaries with moduleId filter', async () => {
      mockJsonResponse([]);
      await client.listSummaries('banking');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/summaries?moduleId=banking',
        expect.anything(),
      );
    });
  });

  describe('rebuildSummary', () => {
    it('sends POST to rebuild endpoint', async () => {
      mockJsonResponse({ message: 'ok' });
      await client.rebuildSummary('banking');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-hub/summaries/banking/rebuild',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      mockErrorResponse(404, 'Not found');

      await expect(client.listModules()).rejects.toThrow(
        'DocsHub API error 404: Not found',
      );
    });

    it('throws on 500 response', async () => {
      mockErrorResponse(500, 'Internal Server Error');

      await expect(client.search({ query: 'test' })).rejects.toThrow(
        'DocsHub API error 500',
      );
    });
  });
});
