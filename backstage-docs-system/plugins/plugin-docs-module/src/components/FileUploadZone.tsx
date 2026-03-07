import React, { useCallback, useState, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Chip,
  makeStyles,
  Paper,
} from '@material-ui/core';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';
import InsertDriveFileIcon from '@material-ui/icons/InsertDriveFile';
import PictureAsPdfIcon from '@material-ui/icons/PictureAsPdf';
import DescriptionIcon from '@material-ui/icons/Description';
import TableChartIcon from '@material-ui/icons/TableChart';
import TextFieldsIcon from '@material-ui/icons/TextFields';
import DeleteIcon from '@material-ui/icons/Delete';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import ErrorIcon from '@material-ui/icons/Error';
import { useApi } from '@backstage/core-plugin-api';
import { docsModuleApiRef } from '../api/docsModuleApi';
import type { DocumentFormat, UploadProgress } from '@backstage-docs/plugin-docs-hub';
import { SUPPORTED_MIME_TYPES } from '@backstage-docs/plugin-docs-hub';

const useStyles = makeStyles((theme) => ({
  dropzone: {
    border: `2px dashed ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    padding: theme.spacing(4),
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    backgroundColor: theme.palette.background.default,
    '&:hover': {
      borderColor: theme.palette.primary.main,
      backgroundColor: theme.palette.action.hover,
    },
  },
  dropzoneActive: {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.primary.light + '20',
    transform: 'scale(1.01)',
  },
  fileList: {
    marginTop: theme.spacing(2),
    maxHeight: 400,
    overflow: 'auto',
  },
  formatChip: {
    marginRight: theme.spacing(0.5),
    marginBottom: theme.spacing(0.5),
  },
  uploadButton: {
    marginTop: theme.spacing(2),
  },
  hiddenInput: {
    display: 'none',
  },
}));

const FORMAT_ICONS: Record<DocumentFormat, React.ReactElement> = {
  pdf: <PictureAsPdfIcon color="error" />,
  word: <DescriptionIcon color="primary" />,
  excel: <TableChartIcon style={{ color: '#217346' }} />,
  markdown: <TextFieldsIcon color="secondary" />,
  text: <InsertDriveFileIcon />,
};

function detectFormat(file: File): DocumentFormat | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  for (const [format, exts] of Object.entries({
    pdf: ['.pdf'],
    word: ['.doc', '.docx'],
    excel: ['.xls', '.xlsx', '.csv'],
    markdown: ['.md', '.mdx'],
    text: ['.txt', '.text'],
  })) {
    if (exts.includes(ext)) return format as DocumentFormat;
  }
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface FileUploadZoneProps {
  moduleId: string;
  onUploadComplete?: () => void;
}

interface PendingFile {
  file: File;
  format: DocumentFormat | null;
  id: string;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  moduleId,
  onUploadComplete,
}) => {
  const classes = useStyles();
  const moduleApi = useApi(docsModuleApiRef);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progresses, setProgresses] = useState<Record<string, UploadProgress>>({});

  // 所有支援的 MIME type
  const allMimeTypes = Object.values(SUPPORTED_MIME_TYPES).flat();
  const acceptString = allMimeTypes.join(',');

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles: PendingFile[] = Array.from(files)
      .map((file) => ({
        file,
        format: detectFormat(file),
        id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      }))
      .filter((pf) => pf.format !== null);

    setPendingFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // ── Drag & Drop handlers ──────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  // ── Click upload handler ──────────────────────────────
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleClickUploadArea = () => {
    fileInputRef.current?.click();
  };

  // ── 執行上傳 ──────────────────────────────────────────
  const handleUpload = async () => {
    if (pendingFiles.length === 0) return;
    setUploading(true);

    try {
      const files = pendingFiles.map((pf) => pf.file);
      await moduleApi.uploadDocuments(moduleId, files, [], (progress) => {
        setProgresses((prev) => ({
          ...prev,
          [progress.fileId]: progress,
        }));
      });

      setPendingFiles([]);
      setProgresses({});
      onUploadComplete?.();
    } catch (err) {
      pendingFiles.forEach((pf) => {
        setProgresses((prev) => ({
          ...prev,
          [pf.file.name]: {
            fileId: pf.file.name,
            fileName: pf.file.name,
            status: 'error',
            progress: 0,
            error: err instanceof Error ? err.message : 'Upload failed',
          },
        }));
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      {/* 隱藏的 file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={acceptString}
        onChange={handleFileSelect}
        className={classes.hiddenInput}
      />

      {/* 拖拉上傳區域 */}
      <Paper
        className={`${classes.dropzone} ${dragActive ? classes.dropzoneActive : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClickUploadArea}
        elevation={0}
      >
        <CloudUploadIcon style={{ fontSize: 48, color: '#999' }} />
        <Typography variant="h6" gutterBottom>
          拖曳檔案到此處，或點擊選擇檔案
        </Typography>
        <Typography variant="body2" color="textSecondary">
          支援格式：
        </Typography>
        <Box mt={1}>
          {(['pdf', 'word', 'excel', 'markdown', 'text'] as DocumentFormat[]).map(
            (fmt) => (
              <Chip
                key={fmt}
                icon={FORMAT_ICONS[fmt]}
                label={fmt.toUpperCase()}
                size="small"
                variant="outlined"
                className={classes.formatChip}
              />
            ),
          )}
        </Box>
      </Paper>

      {/* 待上傳檔案列表 */}
      {pendingFiles.length > 0 && (
        <Paper className={classes.fileList} variant="outlined">
          <List dense>
            {pendingFiles.map((pf) => {
              const progress = progresses[pf.file.name];
              return (
                <ListItem key={pf.id}>
                  <ListItemIcon>
                    {progress?.status === 'ready' ? (
                      <CheckCircleIcon style={{ color: 'green' }} />
                    ) : progress?.status === 'error' ? (
                      <ErrorIcon color="error" />
                    ) : (
                      pf.format && FORMAT_ICONS[pf.format]
                    )}
                  </ListItemIcon>
                  <ListItemText
                    primary={pf.file.name}
                    secondary={
                      <>
                        {formatFileSize(pf.file.size)}
                        {pf.format && (
                          <Chip
                            label={pf.format}
                            size="small"
                            style={{ marginLeft: 8 }}
                          />
                        )}
                        {progress?.error && (
                          <Typography
                            variant="caption"
                            color="error"
                            component="span"
                            style={{ marginLeft: 8 }}
                          >
                            {progress.error}
                          </Typography>
                        )}
                      </>
                    }
                  />
                  {progress && progress.status === 'uploading' && (
                    <Box width={100} mr={2}>
                      <LinearProgress
                        variant="determinate"
                        value={progress.progress}
                      />
                    </Box>
                  )}
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => removeFile(pf.id)}
                      disabled={uploading}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              );
            })}
          </List>
        </Paper>
      )}

      {/* 上傳按鈕 */}
      {pendingFiles.length > 0 && (
        <Button
          variant="contained"
          color="primary"
          startIcon={<CloudUploadIcon />}
          onClick={handleUpload}
          disabled={uploading}
          className={classes.uploadButton}
          fullWidth
        >
          {uploading
            ? '上傳中...'
            : `上傳 ${pendingFiles.length} 個檔案`}
        </Button>
      )}
    </Box>
  );
};
