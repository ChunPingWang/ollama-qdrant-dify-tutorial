import React, { useState } from 'react';
import {
  Header,
  Page,
  Content,
  ContentHeader,
  InfoCard,
  Table,
  TableColumn,
  StatusOK,
  StatusError,
  StatusPending,
  StatusRunning,
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tabs,
  Tab,
} from '@material-ui/core';
import SearchIcon from '@material-ui/icons/Search';
import DeleteIcon from '@material-ui/icons/Delete';
import RefreshIcon from '@material-ui/icons/Refresh';
import VisibilityIcon from '@material-ui/icons/Visibility';
import { useParams } from 'react-router-dom';
import { useAsync, useAsyncRetry } from 'react-use';
import { docsModuleApiRef } from '../api/docsModuleApi';
import { docsHubApiRef } from '@backstage-docs/plugin-docs-hub';
import { FileUploadZone } from './FileUploadZone';
import type { Document, DocumentStatus, VectorSearchResult } from '@backstage-docs/plugin-docs-hub';

const STATUS_COMPONENTS: Record<DocumentStatus, React.ReactElement> = {
  ready: <StatusOK>就緒</StatusOK>,
  error: <StatusError>錯誤</StatusError>,
  uploading: <StatusRunning>上傳中</StatusRunning>,
  parsing: <StatusPending>解析中</StatusPending>,
  embedding: <StatusRunning>向量化中</StatusRunning>,
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <div role="tabpanel" hidden={value !== index}>
    {value === index && <Box pt={2}>{children}</Box>}
  </div>
);

export const DocsModulePage = () => {
  const { moduleId } = useParams<{ moduleId: string }>();
  const moduleApi = useApi(docsModuleApiRef);
  const hubApi = useApi(docsHubApiRef);

  const [tabIndex, setTabIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VectorSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ id: string; content: string } | null>(null);

  const moduleInfo = useAsync(
    () => hubApi.getModule(moduleId!),
    [moduleId],
  );

  const documents = useAsyncRetry(
    () => moduleApi.listDocuments(moduleId!),
    [moduleId],
  );

  const handleSearch = async () => {
    if (!searchQuery.trim() || !moduleId) return;
    setSearching(true);
    try {
      const results = await moduleApi.searchInModule(moduleId, searchQuery, 10);
      setSearchResults(results);
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (docId: string) => {
    if (!moduleId) return;
    await moduleApi.deleteDocument(moduleId, docId);
    documents.retry();
  };

  const handleReprocess = async (docId: string) => {
    if (!moduleId) return;
    await moduleApi.reprocessDocument(moduleId, docId);
    documents.retry();
  };

  const handlePreview = async (docId: string) => {
    if (!moduleId) return;
    const content = await moduleApi.getDocumentContent(moduleId, docId);
    setPreviewDoc({ id: docId, content });
  };

  const docColumns: TableColumn<Document>[] = [
    { title: '文件名稱', field: 'title' },
    { title: '檔案', field: 'fileName' },
    {
      title: '格式',
      field: 'format',
      render: (row) => <Chip label={row.format.toUpperCase()} size="small" />,
    },
    {
      title: '大小',
      field: 'size',
      render: (row) =>
        row.size < 1024 * 1024
          ? `${(row.size / 1024).toFixed(1)} KB`
          : `${(row.size / (1024 * 1024)).toFixed(1)} MB`,
    },
    { title: '切片數', field: 'chunkCount', type: 'numeric' },
    {
      title: '狀態',
      field: 'status',
      render: (row) => STATUS_COMPONENTS[row.status],
    },
    {
      title: '標籤',
      field: 'tags',
      render: (row) =>
        row.tags.map((tag) => (
          <Chip key={tag} label={tag} size="small" style={{ margin: 1 }} />
        )),
    },
    { title: '上傳時間', field: 'uploadedAt' },
    {
      title: '操作',
      render: (row) => (
        <Box display="flex" style={{ gap: 4 }}>
          <IconButton size="small" onClick={() => handlePreview(row.id)} title="預覽">
            <VisibilityIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleReprocess(row.id)} title="重新處理">
            <RefreshIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => handleDelete(row.id)} title="刪除">
            <DeleteIcon fontSize="small" color="error" />
          </IconButton>
        </Box>
      ),
    },
  ];

  const resultColumns: TableColumn<VectorSearchResult>[] = [
    {
      title: '相似度',
      field: 'similarity',
      render: (row) => (
        <Chip
          label={`${(row.similarity * 100).toFixed(1)}%`}
          size="small"
          color={row.similarity > 0.8 ? 'primary' : 'default'}
        />
      ),
    },
    { title: '來源檔案', field: 'metadata.sourceFile' },
    { title: '頁碼', field: 'metadata.page' },
    {
      title: '匹配內容',
      field: 'chunkText',
      render: (row) =>
        row.chunkText.length > 200
          ? `${row.chunkText.slice(0, 200)}...`
          : row.chunkText,
    },
  ];

  return (
    <Page themeId="tool">
      <Header
        title={moduleInfo.value?.name ?? moduleId ?? '模組'}
        subtitle={moduleInfo.value?.description ?? '文件模組'}
      />
      <Content>
        <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)}>
          <Tab label="文件列表" />
          <Tab label="上傳文件" />
          <Tab label="模組內搜尋" />
        </Tabs>

        {/* Tab 0: 文件列表 */}
        <TabPanel value={tabIndex} index={0}>
          <ContentHeader title="文件管理">
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={documents.retry}
            >
              重新整理
            </Button>
          </ContentHeader>
          {documents.loading && <LinearProgress />}
          {documents.error && (
            <Typography color="error">{documents.error.message}</Typography>
          )}
          {documents.value && (
            <Table
              title={`共 ${documents.value.length} 份文件`}
              data={documents.value}
              columns={docColumns}
              options={{ paging: true, pageSize: 20, search: true }}
            />
          )}
        </TabPanel>

        {/* Tab 1: 上傳文件 */}
        <TabPanel value={tabIndex} index={1}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={8}>
              <InfoCard title="上傳文件">
                <FileUploadZone
                  moduleId={moduleId!}
                  onUploadComplete={() => {
                    documents.retry();
                    setTabIndex(0);
                  }}
                />
              </InfoCard>
            </Grid>
            <Grid item xs={12} md={4}>
              <InfoCard title="上傳說明">
                <Typography variant="body2" paragraph>
                  支援以下檔案格式：
                </Typography>
                <Typography variant="body2" component="div">
                  <ul>
                    <li><strong>PDF</strong> — 自動提取文字與頁碼</li>
                    <li><strong>Word</strong> (.doc, .docx) — 提取段落與表格</li>
                    <li><strong>Excel</strong> (.xls, .xlsx, .csv) — 逐工作表轉文字</li>
                    <li><strong>Markdown</strong> (.md, .mdx) — 保留結構標記</li>
                    <li><strong>純文字</strong> (.txt) — 直接處理</li>
                  </ul>
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  上傳後系統會自動解析、切片、向量化，存入本模組的向量資料庫。
                  同時會產生摘要同步至 Hub 中央索引。
                </Typography>
              </InfoCard>
            </Grid>
          </Grid>
        </TabPanel>

        {/* Tab 2: 模組內搜尋 */}
        <TabPanel value={tabIndex} index={2}>
          <InfoCard title="語意搜尋">
            <Box display="flex" style={{ gap: 8 }} mb={2}>
              <TextField
                fullWidth
                variant="outlined"
                placeholder="在此模組中搜尋..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                }}
              />
              <IconButton onClick={handleSearch} disabled={searching}>
                <SearchIcon color="primary" />
              </IconButton>
            </Box>
            {searching && <LinearProgress />}
            {searchResults.length > 0 && (
              <Table
                title="搜尋結果"
                data={searchResults}
                columns={resultColumns}
                options={{ paging: false, search: false }}
              />
            )}
          </InfoCard>
        </TabPanel>

        {/* 文件預覽 Dialog */}
        <Dialog
          open={previewDoc !== null}
          onClose={() => setPreviewDoc(null)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>文件內容預覽</DialogTitle>
          <DialogContent dividers>
            <Typography
              variant="body2"
              component="pre"
              style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}
            >
              {previewDoc?.content}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPreviewDoc(null)}>關閉</Button>
          </DialogActions>
        </Dialog>
      </Content>
    </Page>
  );
};
