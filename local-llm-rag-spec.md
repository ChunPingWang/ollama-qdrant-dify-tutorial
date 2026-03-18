# 地端 LLM + RAG 架構實作規格

> **用途**：供 Claude Code / Terminal 作為開發依據  
> **環境**：EVO-X2（128GB, AMD ROCm）+ Ollama + Qdrant + Dify  
> **語言**：繁體中文金融文件場景  
> **最後更新**：2026-03-19

---

## 目錄

1. [架構總覽](#1-架構總覽)
2. [核心元件說明](#2-核心元件說明)
3. [Qdrant 向量資料庫](#3-qdrant-向量資料庫)
4. [Embedding 模型選型](#4-embedding-模型選型)
5. [Dify 部署設定](#5-dify-部署設定)
6. [文件匯入 Pipeline](#6-文件匯入-pipeline)
7. [RAG 效果評測](#7-rag-效果評測)
8. [OpenCode 整合](#8-opencode-整合)
9. [工作清單](#9-工作清單)
10. [決策紀錄](#10-決策紀錄)

---

## 1. 架構總覽

### 資料流

```
使用者提問 (OpenCode)
        │
        ▼
  ┌─────────────┐
  │    Dify     │  :80  ← OpenAI-compatible endpoint
  │  RAG 編排層 │
  └──────┬──────┘
         │ 1. Embedding 問題向量
         ▼
  ┌─────────────┐
  │   Qdrant    │  :6333  ← 相似度搜尋 Top-K
  └──────┬──────┘
         │ 2. 回傳相關文件片段
         ▼
  ┌─────────────┐
  │    Dify     │  組合 RAG Prompt
  └──────┬──────┘
         │ 3. 送出組合後的 Prompt
         ▼
  ┌─────────────┐
  │   Ollama    │  :11434  ← gpt-oss:120b 推理
  └──────┬──────┘
         │ 4. 回傳答案
         ▼
  使用者收到答案 (OpenCode)
```

### 關鍵設計原則

- **LLM 不主動查詢 RAG**：RAG 是外部 Pipeline，由 Dify 編排
- **Prompt 組合**：`[System: 知識庫內容] + [User: 原始問題]`
- **向量化一致性**：匯入文件與查詢時必須使用**相同 Embedding 模型**

---

## 2. 核心元件說明

| 元件 | 角色 | 版本/規格 |
|---|---|---|
| **OpenCode** | 開發者 IDE，發出查詢 | OpenAI-compatible client |
| **Dify** | RAG 編排層，對外提供 API | latest (docker) |
| **Qdrant** | 向量資料庫 | latest |
| **Ollama** | 本地 LLM 推理引擎 | EVO-X2 AMD ROCm |
| **gpt-oss:120b** | 推理模型 | 主力 LLM |
| **BGE-M3** | Embedding 模型 | BAAI/bge-m3 |

---

## 3. Qdrant 向量資料庫

### 核心原理

```
文字 → Embedding 模型 → 向量 [0.12, 0.87, ...] → 向量空間中的點
語意相近 = 向量距離近（Cosine Similarity）
```

### 資料結構

```
Collection
  └── Point
        ├── id       : UUID
        ├── vector   : float[]  (維度由 Embedding 模型決定)
        └── payload  : { text, source, chunk_id, path }
```

### HNSW 搜尋演算法

- 多層圖結構，複雜度 O(log n)
- 比暴力搜尋快數百倍，適合大規模文件庫

### Docker 啟動

```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest
```

---

## 4. Embedding 模型選型

### 繁體中文場景比較

| 模型 | 維度 | Max Token | 繁中支援 | 大小 | 推薦度 |
|---|---|---|---|---|---|
| **BAAI/bge-m3** | 1024 | **8192** | ⭐⭐⭐⭐⭐ | 570MB | 🏆 首選 |
| intfloat/multilingual-e5-large | 1024 | 512 | ⭐⭐⭐⭐ | 560MB | 備選 |
| nomic-ai/nomic-embed-text-v1 | 768 | 8192 | ⭐⭐ | 274MB | 英文場景 |
| all-MiniLM-L6-v2 | 384 | 256 | ⭐ | 80MB | 基準線 |

### 選型結論

**繁體中文金融文件 → 使用 `BAAI/bge-m3`**

理由：
- 8192 token 長視窗，整頁 PDF 不截斷
- 100+ 語言訓練資料，繁簡中文語意區分強
- 中英混合（金融報告常見）表現優異

### 使用注意事項

```python
# BGE-M3 必須加 normalize_embeddings=True
vectors = model.encode(chunks, normalize_embeddings=True)

# multilingual-e5-large 需要加 prefix
query = "query: " + user_question
doc   = "passage: " + document_chunk
```

### Ollama 安裝

```bash
ollama pull bge-m3
ollama pull nomic-embed-text  # 備用，英文較快
```

---

## 5. Dify 部署設定

### .env 關鍵設定

```bash
# dify/docker/.env

OPENAI_API_KEY=dummy          # 不使用 OpenAI
VECTOR_STORE=qdrant
QDRANT_URL=http://qdrant:6333  # docker 內部網路
QDRANT_API_KEY=
QDRANT_CLIENT_TIMEOUT=20
```

### docker-compose.yaml 重點修改

```yaml
services:

  qdrant:
    image: qdrant/qdrant:latest
    restart: always
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - ./volumes/qdrant:/qdrant/storage
    networks:
      - ssrf_proxy_network
      - default

  api:
    image: langgenius/dify-api:latest
    extra_hosts:
      - "host.docker.internal:host-gateway"  # ← 連到宿主機 Ollama
    depends_on:
      - qdrant
    # ... 其他設定

  worker:
    image: langgenius/dify-api:latest
    extra_hosts:
      - "host.docker.internal:host-gateway"  # ← 同上
    depends_on:
      - qdrant
```

> **關鍵**：`extra_hosts: host.docker.internal:host-gateway` 讓容器能連到 `localhost:11434` 的 Ollama

### 啟動

```bash
cd dify/docker
cp .env.example .env
# 編輯 .env（設定上述參數）
docker compose up -d
docker compose ps   # 確認所有服務 healthy
```

### Dify UI 設定 Ollama

```
Settings → Model Providers → Ollama

  LLM:
    Model Name : gpt-oss:120b
    Base URL   : http://host.docker.internal:11434

  Text Embedding:
    Model Name : bge-m3
    Base URL   : http://host.docker.internal:11434
```

---

## 6. 文件匯入 Pipeline

### 安裝依賴

```bash
pip install qdrant-client sentence-transformers \
            langchain-text-splitters pymupdf tqdm
```

### 執行匯入

```bash
mkdir docs
cp your_documents/*.pdf docs/
python ingest.py
```

### ingest.py 關鍵設定

```python
QDRANT_HOST  = "localhost"
QDRANT_PORT  = 6333
COLLECTION   = "bank_docs"
EMBED_MODEL  = "BAAI/bge-m3"
CHUNK_SIZE   = 500    # 每個片段字數
CHUNK_OVERLAP = 50    # 片段重疊（保留上下文）
DOCS_DIR     = "./docs"
```

### 切割策略

```python
splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
    separators=["\n\n", "\n", "。", "，", " ", ""]
)
```

> 繁中文件使用 `。` 和 `，` 作為切割優先分隔符

---

## 7. RAG 效果評測

### 評測指標

| 指標 | 說明 | 目標值 |
|---|---|---|
| **Hit Rate @5** | Top-5 中至少有一個正確答案 | > 85% |
| **MRR** | 第一個正確答案的排名倒數均值 | > 0.80 |
| **NDCG@5** | 加權排名準確度 | > 0.75 |
| **Latency** | 每次查詢耗時 | < 200ms |

### 執行評測

```bash
pip install qdrant-client sentence-transformers tqdm rich
python rag_eval.py
# 輸出：終端機報表 + eval_results.json
```

### 預期結果（模擬數據）

| 模型 | Hit Rate | MRR | NDCG@5 | Latency |
|---|---|---|---|---|
| BGE-M3 | 90% | 0.835 | 0.812 | 142ms |
| mE5-Large | 80% | 0.760 | 0.738 | 165ms |
| Nomic-Embed | 60% | 0.550 | 0.526 | 68ms |
| MiniLM-L6 | 40% | 0.350 | 0.330 | 28ms |

### 視覺化儀表板

將 `eval_results.json` 貼入 `rag_eval_dashboard.jsx` 的「匯入 JSON」頁籤，可查看：
- 總覽指標 + Bar Chart
- 各類別雷達圖（授信、轉帳、存款、貸款、帳務）
- 每筆查詢 HIT/MISS 明細

---

## 8. OpenCode 整合

### 設定檔修改

```json
// ~/.config/opencode/config.json
{
  "providers": {
    "dify-rag": {
      "baseURL": "http://localhost/v1",
      "apiKey": "app-xxxxxxxx"
    }
  },
  "model": "dify-rag/gpt-oss:120b"
}
```

> API Key 從 Dify UI → Applications → API Access 取得

### 驗證連線

```bash
curl http://localhost/v1/chat/completions \
  -H "Authorization: Bearer app-xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-oss:120b",
    "messages": [{"role": "user", "content": "信用卡申請需要哪些文件？"}]
  }'
```

---

## 9. 工作清單

### Phase 1：環境建置

```
基礎設施
□ 確認 Ollama 正常運行 (curl http://localhost:11434/api/tags)
□ 確認 gpt-oss:120b 已載入
□ 拉取 bge-m3 Embedding 模型 (ollama pull bge-m3)
□ 啟動 Qdrant docker container
□ 驗證 Qdrant API (curl http://localhost:6333/collections)

Dify 部署
□ clone dify repo (git clone https://github.com/langgenius/dify)
□ 複製並修改 .env（設定 VECTOR_STORE=qdrant）
□ 修改 docker-compose.yaml（加入 qdrant service + extra_hosts）
□ 執行 docker compose up -d
□ 確認所有容器健康狀態
□ 在 Dify UI 設定 Ollama LLM (gpt-oss:120b)
□ 在 Dify UI 設定 Ollama Embedding (bge-m3)
```

### Phase 2：文件匯入

```
文件準備
□ 收集要建立知識庫的文件（PDF / TXT / MD）
□ 建立 docs/ 資料夾並放入文件
□ 評估文件語言（繁中 / 中英混合 → 確認使用 BGE-M3）

執行匯入
□ 安裝 Python 依賴 (pip install ...)
□ 設定 ingest.py 的 COLLECTION / CHUNK_SIZE
□ 執行 python ingest.py
□ 確認 Qdrant collection 建立並有資料
□ 執行 test_search() 驗證語意搜尋結果
```

### Phase 3：RAG 效果評測

```
準備評測集
□ 根據實際文件撰寫 10-20 筆評測查詢
□ 為每筆查詢設定 relevant_keywords
□ 依業務類別分組（授信 / 轉帳 / 存款 / 貸款 / 帳務）

執行評測
□ 執行 python rag_eval.py
□ 確認 Hit Rate @5 > 85%
□ 確認 MRR > 0.80
□ 匯入 eval_results.json 到視覺化儀表板
□ 分析各類別弱點，調整 chunk 策略或補充文件

模型比較（選做）
□ 比較 BGE-M3 vs mE5-Large 在你的文件上的實際效果
□ 記錄最終選型決策
```

### Phase 4：OpenCode 整合

```
API 設定
□ 在 Dify 建立 Application 並取得 API Key
□ 修改 OpenCode config.json 指向 Dify endpoint
□ 執行 curl 驗證 API 回應
□ 在 OpenCode 測試 RAG 查詢

品質驗證
□ 測試 5 筆真實業務問題
□ 確認答案引用了知識庫內容
□ 確認沒有幻覺（hallucination）問題
□ 記錄 P95 回應時間
```

### Phase 5：維運與優化（持續）

```
知識庫維護
□ 建立文件更新流程（新文件 → 重新 ingest）
□ 設定定期評測排程（每次更新文件後執行）
□ 監控 Qdrant collection 大小與查詢效能

調優方向
□ 若 Hit Rate < 85%：調小 chunk_size（試 300）
□ 若答案太片段：調大 chunk_overlap（試 100）
□ 若回應太慢：評估改用 nomic-embed-text（輕量）
□ 若中文效果差：確認 normalize_embeddings=True
```

---

## 10. 決策紀錄

| 日期 | 決策 | 理由 |
|---|---|---|
| 2026-03-19 | Embedding 選用 BGE-M3 | 繁中支援最佳，8192 token 長視窗 |
| 2026-03-19 | 向量庫選用 Qdrant | 已有使用經驗（Spring AI POC），API 簡潔 |
| 2026-03-19 | RAG 編排層選用 Dify | 快速驗證，有 UI 管理知識庫，可輸出 OpenAI-compatible API |
| 2026-03-19 | chunk_size = 500 | 繁中段落一般 200-400 字，500 保留完整語意 |

---

## 附錄：常用指令速查

```bash
# Ollama
ollama list                        # 已安裝模型
ollama pull bge-m3                 # 安裝 Embedding 模型
ollama ps                          # 目前載入的模型

# Qdrant
curl http://localhost:6333/collections              # 列出所有 collections
curl http://localhost:6333/collections/bank_docs    # 查看特定 collection

# Dify
docker compose -f dify/docker/docker-compose.yaml ps    # 服務狀態
docker compose -f dify/docker/docker-compose.yaml logs api -f  # API 日誌

# 文件匯入
python ingest.py                   # 匯入 docs/ 下所有文件

# RAG 評測
python rag_eval.py                 # 執行評測，輸出 eval_results.json
```

---

*本文件由對話自動生成，作為 Claude Code 開發依據。*  
*如需更新，直接修改對應章節後重新交給 Claude Code 執行即可。*
