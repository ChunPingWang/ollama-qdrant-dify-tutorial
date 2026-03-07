import { DocsModuleClient } from './docsModuleApi';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

const client = new DocsModuleClient({ baseUrl: 'http://localhost:7007' });

beforeEach(() => {
  mockFetch.mockReset();
});

function mockOkResponse(data: any, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(typeof data === 'string' ? data : JSON.stringify(data)),
  });
}

function mockErrorResponse(status: number) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve('error'),
  });
}

describe('DocsModuleClient', () => {
  describe('listDocuments', () => {
    it('fetches documents for a module', async () => {
      const docs = [
        { id: 'doc1', fileName: 'test.pdf', status: 'ready' },
      ];
      mockOkResponse(docs);

      const result = await client.listDocuments('banking');

      expect(result).toEqual(docs);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/banking/documents',
      );
    });

    it('throws on error response', async () => {
      mockErrorResponse(500);

      await expect(client.listDocuments('banking')).rejects.toThrow(
        'Failed to list documents: 500',
      );
    });
  });

  describe('getDocument', () => {
    it('fetches a specific document', async () => {
      const doc = { id: 'doc1', fileName: 'report.pdf' };
      mockOkResponse(doc);

      const result = await client.getDocument('banking', 'doc1');

      expect(result).toEqual(doc);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/banking/documents/doc1',
      );
    });

    it('encodes special characters', async () => {
      mockOkResponse({});
      await client.getDocument('mod/special', 'doc/id');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/mod%2Fspecial/documents/doc%2Fid',
      );
    });
  });

  describe('deleteDocument', () => {
    it('sends DELETE request', async () => {
      mockOkResponse(undefined);

      await client.deleteDocument('banking', 'doc1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/banking/documents/doc1',
        { method: 'DELETE' },
      );
    });

    it('throws on error', async () => {
      mockErrorResponse(404);

      await expect(client.deleteDocument('banking', 'ghost')).rejects.toThrow(
        'Failed to delete document: 404',
      );
    });
  });

  describe('searchInModule', () => {
    it('sends POST with query and topK', async () => {
      const results = [{ documentId: 'doc1', similarity: 0.95 }];
      mockOkResponse(results);

      const result = await client.searchInModule('banking', 'saga', 5);

      expect(result).toEqual(results);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/banking/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'saga', topK: 5 }),
        },
      );
    });

    it('uses default topK of 10', async () => {
      mockOkResponse([]);

      await client.searchInModule('mod', 'query');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          body: JSON.stringify({ query: 'query', topK: 10 }),
        }),
      );
    });
  });

  describe('getDocumentContent', () => {
    it('fetches document content as text', async () => {
      mockOkResponse('This is the parsed content');

      const result = await client.getDocumentContent('banking', 'doc1');

      expect(result).toBe('This is the parsed content');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/banking/documents/doc1/content',
      );
    });
  });

  describe('reprocessDocument', () => {
    it('sends POST to reprocess endpoint', async () => {
      mockOkResponse({ message: 'Reprocessing started' });

      await client.reprocessDocument('banking', 'doc1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:7007/api/docs-module/banking/documents/doc1/reprocess',
        { method: 'POST' },
      );
    });

    it('throws on error', async () => {
      mockErrorResponse(404);

      await expect(
        client.reprocessDocument('banking', 'ghost'),
      ).rejects.toThrow('Reprocess failed: 404');
    });
  });

  describe('getSupportedFormats', () => {
    it('returns all supported formats', () => {
      const formats = client.getSupportedFormats();

      expect(formats).toContain('pdf');
      expect(formats).toContain('text');
      expect(formats).toContain('markdown');
      expect(formats).toContain('word');
      expect(formats).toContain('excel');
      expect(formats).toHaveLength(5);
    });
  });
});
