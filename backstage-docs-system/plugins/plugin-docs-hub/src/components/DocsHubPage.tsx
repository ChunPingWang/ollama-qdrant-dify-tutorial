import React, { useState } from 'react';
import {
  Header,
  Page,
  Content,
  ContentHeader,
  SupportButton,
  InfoCard,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import {
  Grid,
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Typography,
  LinearProgress,
  Box,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import StorageIcon from '@material-ui/icons/Storage';
import DescriptionIcon from '@material-ui/icons/Description';
import { docsHubApiRef } from '../api/docsHubApi';
import type { DocsModule, SearchResponse, VectorSearchResult } from '../types';
import { useAsync } from 'react-use';

export const DocsHubPage = () => {
  const hubApi = useApi(docsHubApiRef);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  const {
    value: modules,
    loading,
    error,
  } = useAsync(() => hubApi.listModules(), []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const results = await hubApi.search({
        query: searchQuery,
        topK: 10,
        includeChunks: true,
      });
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const moduleColumns: TableColumn<DocsModule>[] = [
    {
      title: '模組名稱',
      field: 'name',
      render: (row) => (
        <Box display="flex" alignItems="center" style={{ gap: 8 }}>
          <StorageIcon fontSize="small" color="primary" />
          <a href={`/docs-module/${row.id}`}>{row.name}</a>
        </Box>
      ),
    },
    { title: '說明', field: 'description' },
    { title: '文件數', field: 'documentCount', type: 'numeric' },
    {
      title: '標籤',
      field: 'tags',
      render: (row) =>
        row.tags.map((tag) => (
          <Chip key={tag} label={tag} size="small" style={{ margin: 2 }} />
        )),
    },
    {
      title: '向量資料庫',
      field: 'vectorDbCollection',
      render: (row) => (
        <Chip
          icon={<StorageIcon />}
          label={row.vectorDbCollection}
          size="small"
          variant="outlined"
        />
      ),
    },
    { title: '最後更新', field: 'lastUpdated' },
  ];

  const resultColumns: TableColumn<VectorSearchResult>[] = [
    {
      title: '來源模組',
      field: 'moduleId',
      render: (row) => (
        <Chip label={row.moduleId} size="small" color="primary" />
      ),
    },
    {
      title: '相似度',
      field: 'similarity',
      render: (row) => `${(row.similarity * 100).toFixed(1)}%`,
    },
    {
      title: '來源檔案',
      field: 'metadata.sourceFile',
      render: (row) => (
        <Box display="flex" alignItems="center" style={{ gap: 4 }}>
          <DescriptionIcon fontSize="small" />
          {row.metadata.sourceFile}
        </Box>
      ),
    },
    {
      title: '內容摘要',
      field: 'chunkText',
      render: (row) =>
        row.chunkText.length > 150
          ? `${row.chunkText.slice(0, 150)}...`
          : row.chunkText,
    },
  ];

  return (
    <Page themeId="tool">
      <Header
        title="文件管理中心"
        subtitle="跨模組文件搜尋與管理 — Federated Vector DB Hub"
      />
      <Content>
        <ContentHeader title="全域搜尋">
          <SupportButton>
            在所有模組中搜尋文件。Hub 會先透過摘要向量庫路由到相關模組，再執行細粒度搜尋。
          </SupportButton>
        </ContentHeader>

        {/* 全域搜尋列 */}
        <Grid container spacing={3}>
          <Grid item xs={12}>
            <InfoCard title="跨模組語意搜尋">
              <Box display="flex" style={{ gap: 8 }} mb={2}>
                <TextField
                  fullWidth
                  variant="outlined"
                  placeholder="輸入搜尋內容，例如：微服務的 Saga 模式如何處理分散式交易？"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={handleSearch} disabled={searching}>
                          <SearchIcon color="primary" />
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
              {searching && <LinearProgress />}
              {searchResults && (
                <>
                  <Typography variant="body2" color="textSecondary" gutterBottom>
                    路由到模組: {searchResults.routedModules.join(', ')} |
                    耗時: {searchResults.totalTime}ms |
                    找到 {searchResults.results.length} 筆結果
                  </Typography>
                  <Table
                    title="搜尋結果"
                    data={searchResults.results}
                    columns={resultColumns}
                    options={{ paging: false, search: false }}
                  />
                </>
              )}
            </InfoCard>
          </Grid>

          {/* 模組總覽 */}
          <Grid item xs={12}>
            {loading && <LinearProgress />}
            {error && (
              <Typography color="error">
                載入模組失敗: {error.message}
              </Typography>
            )}
            {modules && (
              <Table
                title="已註冊模組"
                data={modules}
                columns={moduleColumns}
                options={{ paging: true, pageSize: 10, search: true }}
              />
            )}
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};
