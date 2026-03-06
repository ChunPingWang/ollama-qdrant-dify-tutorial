# Ollama RAG 系統：bank-architect + Microservices Patterns

使用本地 Ollama 的 `bank-architect` 模型，搭配《Microservices Patterns》(微服務設計模式) PDF 建立 RAG (Retrieval-Augmented Generation) 知識庫，實現基於書籍內容的智慧問答。

## 架構總覽

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  使用者提問   │────▶│  Embedding   │────▶│   ChromaDB       │
│             │     │ nomic-embed  │     │  向量資料庫        │
└─────────────┘     └──────────────┘     └────────┬─────────┘
                                                  │ Top-K 相似文字塊
                                                  ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   回答輸出   │◀────│bank-architect│◀────│  Prompt 組合      │
│  (串流輸出)  │     │   (LLM)      │     │ System + Context  │
└─────────────┘     └──────────────┘     │ + Question        │
                                         └──────────────────┘
```

### 處理流程

```
PDF ──▶ 文字提取 ──▶ 切塊 (1500 字/塊) ──▶ Embedding ──▶ ChromaDB
                     (PyMuPDF)              (nomic-embed-text)    (向量資料庫)

使用者問題 ──▶ Embedding ──▶ 向量檢索 ──▶ 組合 Prompt ──▶ bank-architect ──▶ 回答
```

## 檔案結構

```
ollama/
├── README.md                                    # 本文件
├── setup_env.py                                 # 環境檢查與安裝腳本
├── ingest.py                                    # PDF 切塊 → 向量化 → 存入 ChromaDB
├── rag_query.py                                 # RAG 查詢介面 (互動 + 命令列)
├── Microservices_Patterns_dual_Kimi+Qwen.pdf    # 來源 PDF (522 頁，英中雙語)
└── chroma_db/                                   # ChromaDB 向量資料庫 (自動產生)
```

| 腳本 | 用途 | 執行時機 |
|------|------|----------|
| `setup_env.py` | 檢查 Ollama、模型、Python 套件是否就緒 | 首次使用前 |
| `ingest.py` | 將 PDF 文字提取、切塊、向量化並存入 ChromaDB | 首次使用或更換 PDF 時 |
| `rag_query.py` | 互動式 / 命令列 RAG 查詢 | 日常查詢 |

## 前置需求

| 項目 | 版本/規格 | 說明 |
|------|-----------|------|
| **Ollama** | >= 0.17 | 本地 LLM 推論引擎 |
| **Python** | >= 3.10 | 執行 RAG 腳本 |
| **RAM** | >= 64 GB (建議) | bank-architect 模型約 65 GB |
| **磁碟** | >= 70 GB 可用空間 | 模型 + 向量資料庫 |

## 安裝步驟

### Step 1：安裝 Ollama

若尚未安裝，請參考 [Ollama 官網](https://ollama.com) 安裝。Linux 快速安裝：

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

確認服務運行中：

```bash
ollama --version
# ollama version is 0.17.6

systemctl status ollama
# ● ollama.service - Ollama Service
#    Active: active (running)
```

### Step 2：下載所需模型

```bash
# Embedding 模型 (必要，274 MB)
ollama pull nomic-embed-text

# LLM 模型 (bank-architect 為自訂模型，若無則可用其他模型替代)
# 例如使用 qwen3:32b 或 llama3.1:70b
ollama pull bank-architect
```

### Step 3：安裝 Python 套件

```bash
pip3 install --break-system-packages pymupdf chromadb ollama
```

> 若使用 venv 則不需要 `--break-system-packages`：
> ```bash
> python3 -m venv rag-env
> source rag-env/bin/activate
> pip install pymupdf chromadb ollama
> ```

### Step 4：執行環境檢查

```bash
python3 setup_env.py
```

輸出範例：

```
============================================================
RAG 環境檢查與安裝
============================================================

[1/5] 檢查 Ollama CLI...
  OK: ollama version is 0.17.6

[2/5] 檢查 Ollama 服務...
  OK: Ollama API 服務運行中 (http://localhost:11434)

[3/5] 檢查 Ollama 模型...
  OK: nomic-embed-text — Embedding 模型 (274 MB)
  OK: bank-architect — LLM 模型

[4/5] 檢查 Python 套件...
  OK: pymupdf
  OK: chromadb
  OK: ollama

[5/5] 檢查向量資料庫...
  OK: ChromaDB 已建立，包含 1681 個文字塊

============================================================
所有檢查通過! 可以開始使用 RAG 系統。
============================================================
```

### Step 5：建立向量資料庫 (Ingest)

```bash
python3 ingest.py
```

輸出範例：

```
============================================================
RAG 資料庫建置工具
============================================================

[1/3] 提取 PDF 文字...
從 PDF 提取了 522 頁有效文字

[2/3] 切割文字塊...
切成 1681 個文字塊

[3/3] 向量化並存入 ChromaDB...
  進度: 1681/1681 (100%) - 54.9 chunks/s - 預估剩餘 0s

完成! 共處理 1681 個文字塊，耗時 30.6 秒
向量資料庫儲存於: /home/galileo/workspace/ollama/chroma_db
Collection 名稱: microservices_patterns
```

### Step 6：開始查詢

```bash
# 互動模式
python3 rag_query.py

# 單次查詢
python3 rag_query.py "什麼是 Saga 模式？"
```

## 使用方式

### 互動模式

```bash
python3 rag_query.py
```

```
已載入向量資料庫: 1681 個文字塊
LLM 模型: bank-architect
Embedding 模型: nomic-embed-text

輸入問題開始查詢 (輸入 'quit' 或 'q' 退出, 'v' 切換顯示參考資料)
============================================================

🏦 問題> 什麼是 Circuit Breaker 模式？

(模型串流輸出回答...)

🏦 問題> v
顯示參考資料: 開啟

🏦 問題> API Gateway 的設計考量有哪些？

────────────────────────────────────────
檢索到的參考資料:
────────────────────────────────────────
[參考 1] (第 293 頁, 相似度: 0.812)
...
────────────────────────────────────────

(模型串流輸出回答，包含書中頁碼引用...)

🏦 問題> q
再見!
```

### 命令列模式

```bash
python3 rag_query.py "CQRS 模式如何應用於銀行對帳系統？"
```

### 操作指令

| 指令 | 說明 |
|------|------|
| 直接輸入問題 | 送出查詢 |
| `v` | 開啟/關閉 顯示檢索到的參考資料 |
| `q` / `quit` / `exit` | 退出 |
| `Ctrl+C` | 強制退出 |

## 自訂設定

### 更換 LLM 模型

編輯 `rag_query.py` 頂部的設定：

```python
LLM_MODEL = "bank-architect"  # 改為你的模型名稱，例如 "qwen3:32b"
```

### 更換 PDF 文件

編輯 `ingest.py` 頂部的設定，然後重新執行 ingest：

```python
PDF_PATH = "/path/to/your/new_document.pdf"
```

```bash
python3 ingest.py    # 重建向量資料庫
```

### 調整檢索參數

| 參數 | 檔案 | 預設值 | 說明 |
|------|------|--------|------|
| `CHUNK_SIZE` | `ingest.py` | 1500 | 每塊文字的字元數，越大上下文越完整但精確度降低 |
| `CHUNK_OVERLAP` | `ingest.py` | 300 | 相鄰塊的重疊字元數，避免切斷語意 |
| `TOP_K` | `rag_query.py` | 8 | 每次查詢檢索的文字塊數量 |
| `num_ctx` | `rag_query.py` | 8192 | LLM 的 context window 大小 |

### 修改 System Prompt

編輯 `rag_query.py` 中的 `SYSTEM_PROMPT` 變數，可自訂模型的角色與回答風格。

## 技術細節

### 各腳本說明

#### `setup_env.py` — 環境檢查

逐步檢查以下項目，若缺少可自動安裝：

1. Ollama CLI 是否安裝
2. Ollama API 服務是否運行 (`http://localhost:11434`)
3. 所需模型是否已下載 (`nomic-embed-text`, `bank-architect`)
4. Python 套件是否已安裝 (`pymupdf`, `chromadb`, `ollama`)
5. 向量資料庫是否已建立 (`chroma_db/`)

#### `ingest.py` — PDF 向量化入庫

處理流程：

1. **文字提取**：使用 PyMuPDF (`fitz`) 逐頁提取 PDF 中的文字
2. **切塊**：以 1500 字元為一塊、300 字元重疊進行切割，並在每塊前加入 `[第 N 頁]` 標記
3. **向量化**：以每 50 塊為一批，呼叫 Ollama 的 `nomic-embed-text` 模型產生 embedding
4. **儲存**：寫入 ChromaDB（cosine 距離），包含文字內容、頁碼、位置等 metadata

#### `rag_query.py` — RAG 查詢

處理流程：

1. **問題向量化**：將使用者問題透過 `nomic-embed-text` 轉為 embedding
2. **向量檢索**：在 ChromaDB 中找出 Top-K (預設 8) 最相似的文字塊
3. **Prompt 組合**：將檢索到的文字塊作為 Context，與 System Prompt、使用者問題組合
4. **LLM 生成**：透過 Ollama HTTP API 串流呼叫 `bank-architect` 模型生成回答

> **重要實作細節**：`bank-architect` 模型的 Modelfile 中設定了 `PARAMETER stop <|end|>`，
> 這會導致模型在 thinking channel 結束後就停止，無法產出 final channel 的實際回答。
> 腳本中透過 HTTP API 傳入 `"options": {"stop": []}` 來覆蓋此設定，確保模型正常輸出。

### 元件版本

| 元件 | 版本 | 用途 |
|------|------|------|
| Ollama | 0.17.6 | LLM 推論引擎 |
| nomic-embed-text | latest (274 MB) | 文字向量化 |
| bank-architect | latest (65 GB) | LLM 回答生成 |
| PyMuPDF | 1.27.1 | PDF 文字提取 |
| ChromaDB | 1.5.2 | 本地向量資料庫 |
| ollama (Python) | 0.6.1 | Ollama API 客戶端 |

## 疑難排解

### Ollama 服務未啟動

```bash
# 檢查狀態
systemctl status ollama

# 啟動服務
sudo systemctl start ollama

# 或手動啟動
ollama serve
```

### bank-architect 模型回答為空

這是因為模型 Modelfile 中的 `stop <|end|>` 設定問題。`rag_query.py` 已內建解法 (透過 HTTP API 覆蓋 stop token)。若直接使用 `ollama run` 則可能遇到此問題。

### 記憶體不足 (OOM)

`bank-architect` 模型需要約 65 GB RAM。若記憶體不足，可改用較小的模型：

```bash
ollama pull qwen3:8b   # 約 5 GB
```

然後修改 `rag_query.py`：

```python
LLM_MODEL = "qwen3:8b"
```

### 檢索結果不精確

可嘗試以下調整：

- 減小 `CHUNK_SIZE` (例如 800)，讓每塊更聚焦
- 增大 `TOP_K` (例如 12)，檢索更多候選
- 更換 embedding 模型 (例如 `mxbai-embed-large`)

### 重建向量資料庫

若更換 PDF 或調整切塊參數後，需重新建立：

```bash
python3 ingest.py
```

腳本會自動刪除舊的 collection 並重建。
