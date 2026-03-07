# Ollama RAG 系統：bank-architect + Microservices Patterns

使用本地 Ollama 的 `bank-architect` 模型，搭配《Microservices Patterns》(微服務設計模式) PDF 建立 RAG (Retrieval-Augmented Generation) 知識庫，實現基於書籍內容的智慧問答。

## 架構總覽

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  使用者提問   │────▶│ Query        │────▶│  混合檢索          │
│             │     │ Expansion    │     │ Vector + BM25     │
└─────────────┘     └──────────────┘     └────────┬─────────┘
                     中英術語擴展               RRF 融合排序 │ Top-K
                                                  ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   回答輸出   │◀────│bank-architect│◀────│  Prompt 組合      │
│  (串流輸出)  │     │   (LLM)      │     │ System + Context  │
└─────────────┘     └──────────────┘     │ + Question        │
                                         └──────────────────┘
```

### 處理流程

```
PDF ──▶ 文字提取 ──▶ 切塊 (800 字/塊) ──▶ Embedding ──▶ ChromaDB (向量)
         (PyMuPDF)                        (nomic-embed)    + BM25 索引 (關鍵字)

使用者問題 ──▶ Query Expansion ──▶ 混合檢索 (Vector + BM25)
          ──▶ RRF 融合排序 ──▶ 組合 Prompt ──▶ bank-architect ──▶ 回答
```

## 檔案結構

```
ollama/
├── README.md                                    # 本文件
├── rag_config.py                                # 共用設定、術語表、混合檢索邏輯
├── setup_env.py                                 # 環境檢查與安裝腳本
├── ingest.py                                    # PDF 切塊 → 向量化 + BM25 索引
├── rag_query.py                                 # RAG 查詢介面 (混合檢索)
├── rag_eval.py                                  # RAG 品質評估腳本 (12 題 Golden QA)
├── rag_tuner.py                                 # 自動調參工具 (Grid Search)
├── Microservices_Patterns_dual_Kimi+Qwen.pdf    # 來源 PDF (522 頁，英中雙語)
├── chroma_db/                                   # ChromaDB 向量資料庫 (自動產生)
└── bm25_index.pkl                               # BM25 關鍵字索引 (自動產生)
```

| 腳本 | 用途 | 執行時機 |
|------|------|----------|
| `setup_env.py` | 檢查 Ollama、模型、Python 套件是否就緒 | 首次使用前 |
| `ingest.py` | 將 PDF 向量化並建立 BM25 索引 | 首次使用或更換 PDF / 調參時 |
| `rag_query.py` | 互動式 / 命令列 RAG 查詢 | 日常查詢 |
| `rag_eval.py` | 評估檢索與生成品質 | 調參後驗證效果 |
| `rag_tuner.py` | 自動搜尋最佳參數 | 換 PDF 或調參時 |

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
systemctl status ollama
```

### Step 2：下載所需模型

```bash
# Embedding 模型 (必要，274 MB)
ollama pull nomic-embed-text

# LLM 模型 (bank-architect 為自訂模型，若無則可用其他模型替代)
ollama pull bank-architect
```

### Step 3：安裝 Python 套件

```bash
pip3 install --break-system-packages pymupdf chromadb ollama rank_bm25 jieba
```

> 若使用 venv 則不需要 `--break-system-packages`：
> ```bash
> python3 -m venv rag-env
> source rag-env/bin/activate
> pip install pymupdf chromadb ollama rank_bm25 jieba
> ```

### Step 4：執行環境檢查

```bash
python3 setup_env.py
```

### Step 5：建立向量資料庫與 BM25 索引

```bash
python3 ingest.py
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
已載入向量資料庫: 3072 個文字塊
LLM 模型: bank-architect
檢索模式: 混合 (向量 + BM25 + Query Expansion)

🏦 問題> 什麼是 Circuit Breaker 模式？
(模型串流輸出回答...)

🏦 問題> v
顯示參考資料: 開啟

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

## 評估 RAG 品質

```bash
# 完整評估（檢索 + 生成品質，需 LLM 可載入）
python3 rag_eval.py

# 僅評估檢索品質（不需 LLM）
python3 rag_eval.py --retrieval-only
```

內建 12 題 Golden QA Set，涵蓋書中主要微服務模式（Saga、Circuit Breaker、CQRS、API Gateway 等）。

### 評估指標

| 層面 | 指標 | 說明 |
|------|------|------|
| 檢索 | **Hit Rate@K** | 前 K 筆結果是否包含相關內容 |
| 檢索 | **MRR@K** | 第一筆相關結果的排名倒數 |
| 檢索 | **Precision@K** | 前 K 筆中有多少是相關的 |
| 生成 | **Faithfulness** | 回答是否忠於檢索到的參考資料 (1-5) |
| 生成 | **Relevancy** | 回答是否切題且正確 (1-5) |
| 綜合 | **RAG Score** | HitRate×0.3 + Faithfulness×0.35 + Relevancy×0.35 |

## 調參記錄與最佳化

### 改善歷程

| 指標 | v1 (純向量) | v2 (混合檢索) | v3 (自動調參) |
|------|-----------|-------------|-------------|
| **Hit Rate@K** | 66.7% (8/12) | 100% (12/12) | **100%** (12/12) |
| **MRR@K** | 0.440 | 0.903 | **0.917** |
| **Precision@K** | 0.281 | 0.842 | **0.925** |
| **綜合分數** | — | 0.928 | **0.952** |

### 參數對照表

所有參數集中於 `rag_config.py`：

#### 切塊參數

| 參數 | v1 | v2 (當前) | 調參理由 |
|------|-----|----------|--------|
| `CHUNK_SIZE` | 1500 | **800** | 縮小區塊提高檢索精確度，避免過多無關內容稀釋語意 |
| `CHUNK_OVERLAP` | 300 | **200** | 維持適當重疊確保跨塊語意連續性 |
| 文字塊總數 | 1681 | **3072** | 更細粒度的切塊產生更多區塊 |

#### 檢索參數

| 參數 | v1 | v2 (手動) | v3 (自動調參) | 調參理由 |
|------|-----|----------|-------------|--------|
| `TOP_K` | 8 | 10 | **10** | 增加候選數量以提高召回率 |
| `VECTOR_WEIGHT` | — | 0.6 | **0.4** | 自動調參發現 BM25 對此雙語文件更重要 |
| `BM25_WEIGHT` | — | 0.4 | **0.6** | 專有名詞多，關鍵字匹配權重應更高 |
| `RRF_K` | — | 60 | **60** | Reciprocal Rank Fusion 平滑常數（標準值） |

#### 三項關鍵改善

**1. 混合檢索 (Hybrid Search)**

純向量搜尋對專有名詞（如 "Circuit Breaker"、"Strangler Application"）的召回不足，尤其在雙語文件中。加入 BM25 關鍵字搜尋後，以 Reciprocal Rank Fusion (RRF) 融合兩路結果：

```
RRF_score(d) = w_vec / (k + rank_vec(d)) + w_bm25 / (k + rank_bm25(d))
```

- 向量搜尋負責語意相似度
- BM25 負責精確關鍵字匹配
- RRF 融合取兩者之長

**2. 查詢擴展 (Query Expansion)**

針對雙語 PDF 的 embedding 漂移問題，建立中英對照術語表（40+ 組）。查詢時自動加入同義詞：

```
原始查詢: "斷路器模式的用途"
擴展後:   "斷路器模式的用途 circuit breaker 斷路器 half-open 半開狀態"
```

涵蓋的術語類別：
- 架構模式：Saga、Circuit Breaker、CQRS、Strangler、Event Sourcing ...
- API 模式：API Gateway、API Composition、Backends for Frontends ...
- 通訊模式：Messaging、Message Channel、Service Discovery ...
- 分解策略：Decompose by Business Capability、Decompose by Subdomain ...
- 部署/測試/可觀察性：Sidecar、Service Mesh、Distributed Tracing ...

**3. 縮小 Chunk Size**

| CHUNK_SIZE | 文字塊數 | Hit Rate | MRR | 分析 |
|------------|---------|----------|-----|------|
| 1500 | 1681 | 66.7% | 0.440 | 區塊過大，無關內容稀釋了核心語意 |
| **800** | **3072** | **100%** | **0.903** | 區塊更聚焦，embedding 更能代表核心概念 |

### 調參建議

若要進一步調整參數，建議流程：

```bash
# 1. 修改 rag_config.py 中的參數
# 2. 重建索引
python3 ingest.py
# 3. 跑評估驗證
python3 rag_eval.py --retrieval-only
# 4. 對比改善前後的指標
```

可嘗試的方向：
- **CHUNK_SIZE**: 600~1000 之間微調，過小可能切斷完整概念
- **TOP_K**: 8~15，更多候選提高召回但增加 LLM context 負擔
- **VECTOR_WEIGHT / BM25_WEIGHT**: 調整兩路搜尋的相對權重
- **Embedding 模型**: 可嘗試 `mxbai-embed-large` 或 `bge-m3`（多語言）

### 自動調參 (Auto-Tuning)

提供 `rag_tuner.py` 自動搜尋最佳參數：

```bash
# 快速模式：僅調檢索參數（不重建索引，約 1 分鐘）
python3 rag_tuner.py --quick

# 完整模式：含切塊參數 × 檢索參數的 Grid Search（需重建索引，較慢）
python3 rag_tuner.py
```

**快速模式**搜尋空間：
- `TOP_K`: [8, 10, 12, 15]
- `VECTOR_WEIGHT`: [0.4, 0.5, 0.6, 0.7, 0.8]

**完整模式**額外搜尋：
- `CHUNK_SIZE`: [600, 800, 1000]
- `CHUNK_OVERLAP`: [150, 200, 300]

自動調參會輸出 Top 5 最佳參數組合，以及可直接貼入 `rag_config.py` 的設定。
綜合分數公式：`Score = HitRate×0.4 + MRR×0.35 + Precision×0.25`

## 自訂設定

### 更換 LLM 模型

編輯 `rag_config.py`：

```python
LLM_MODEL = "bank-architect"  # 改為你的模型名稱，例如 "qwen3:32b"
```

### 更換 PDF 文件

編輯 `rag_config.py`，然後重新執行 ingest：

```python
PDF_PATH = "/path/to/your/new_document.pdf"
```

```bash
python3 ingest.py    # 重建向量資料庫 + BM25 索引
```

### 修改 System Prompt

編輯 `rag_query.py` 中的 `SYSTEM_PROMPT` 變數，可自訂模型的角色與回答風格。

### 擴充術語表

編輯 `rag_config.py` 中的 `TERM_EXPANSION` 字典，加入更多領域術語的中英對照：

```python
TERM_EXPANSION = {
    "你的術語": ["synonym1", "同義詞1", "synonym2"],
    ...
}
```

## 技術細節

### 各腳本說明

#### `rag_config.py` — 共用設定模組

集中管理所有 RAG 系統參數與核心函式：
- 路徑、模型、檢索參數設定
- 中英對照術語表 (`TERM_EXPANSION`)
- `tokenize()`: 使用 jieba 進行中英文混合斷詞
- `expand_query()`: 根據術語表擴展查詢
- `build_bm25_index()` / `load_bm25_index()`: BM25 索引管理
- `hybrid_search()`: 向量 + BM25 混合檢索，RRF 融合排序

#### `ingest.py` — PDF 向量化入庫

處理流程：

1. **文字提取**：使用 PyMuPDF (`fitz`) 逐頁提取 PDF 中的文字
2. **切塊**：以 800 字元為一塊、200 字元重疊進行切割，每塊前加 `[第 N 頁]` 標記
3. **向量化**：以每 50 塊為一批，呼叫 `nomic-embed-text` 產生 embedding，存入 ChromaDB
4. **BM25 索引**：使用 jieba 斷詞後建立 BM25Okapi 索引，序列化到 `bm25_index.pkl`

#### `rag_query.py` — RAG 查詢

處理流程：

1. **Query Expansion**：根據術語表自動擴展查詢（加入中英同義詞）
2. **混合檢索**：同時進行向量搜尋與 BM25 搜尋
3. **RRF 融合**：以 Reciprocal Rank Fusion 合併兩路排序，取 Top-K
4. **Prompt 組合**：將檢索結果作為 Context，組合完整 prompt
5. **LLM 生成**：透過 Ollama HTTP API 串流呼叫 LLM 生成回答

> **實作細節**：`bank-architect` 模型的 Modelfile 中設定了 `PARAMETER stop <|end|>`，
> 會導致模型在 thinking channel 結束後停止。腳本透過 HTTP API 傳入 `"options": {"stop": []}` 覆蓋此設定。

#### `rag_eval.py` — 品質評估

- 12 題 Golden QA Set（含標準答案與期望關鍵詞）
- 檢索品質：Hit Rate、MRR、Precision（使用關鍵詞比對判斷命中）
- 生成品質：LLM-as-Judge 評估 Faithfulness 與 Relevancy（需 LLM 可用）
- LLM 不可用時自動降級為僅檢索評估模式

### 元件版本

| 元件 | 版本 | 用途 |
|------|------|------|
| Ollama | 0.17.6 | LLM 推論引擎 |
| nomic-embed-text | latest (274 MB) | 文字向量化 |
| bank-architect | latest (65 GB) | LLM 回答生成 |
| PyMuPDF | 1.27.1 | PDF 文字提取 |
| ChromaDB | 1.5.2 | 本地向量資料庫 |
| rank_bm25 | 0.2.2 | BM25 關鍵字搜尋 |
| jieba | 0.42.1 | 中文斷詞 |
| ollama (Python) | 0.6.1 | Ollama API 客戶端 |

## 疑難排解

### Ollama 服務未啟動

```bash
systemctl status ollama
sudo systemctl start ollama
# 或手動啟動: ollama serve
```

### bank-architect 模型回答為空

這是因為模型 Modelfile 中的 `stop <|end|>` 設定問題。`rag_query.py` 已內建解法 (透過 HTTP API 覆蓋 stop token)。

### 記憶體不足 (OOM)

`bank-architect` 模型需要約 65 GB RAM。若記憶體不足，可改用較小的模型：

```bash
ollama pull qwen3:8b   # 約 5 GB
```

然後修改 `rag_config.py`：

```python
LLM_MODEL = "qwen3:8b"
```

### 檢索結果不精確

1. 先跑評估確認基線：`python3 rag_eval.py --retrieval-only`
2. 調整 `rag_config.py` 中的參數
3. 重建索引：`python3 ingest.py`
4. 再跑評估比較：`python3 rag_eval.py --retrieval-only`

### 重建向量資料庫

更換 PDF 或調整切塊參數後，需重新建立：

```bash
python3 ingest.py
```

腳本會自動刪除舊的 collection 並重建向量資料庫與 BM25 索引。
