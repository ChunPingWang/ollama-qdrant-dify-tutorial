# 地端 LLM + RAG 完整教學

> 在 AMD Strix Halo (96GB VRAM) 上建構本地 AI 知識庫系統

## 架構總覽

```
使用者提問 (OpenCode / Terminal)
        │
        ▼
  ┌─────────────┐
  │    Dify     │  :80  ← OpenAI-compatible endpoint
  │  RAG 編排層 │
  └──────┬──────┘
         │ 1. Embedding 問題向量 (BGE-M3)
         ▼
  ┌─────────────┐
  │   Qdrant    │  :6333  ← 相似度搜尋 Top-K
  │  向量資料庫  │
  └──────┬──────┘
         │ 2. 回傳相關文件片段
         ▼
  ┌─────────────┐
  │    Dify     │  組合 RAG Prompt
  └──────┬──────┘
         │ 3. 送出組合後的 Prompt
         ▼
  ┌─────────────┐
  │   Ollama    │  :11434  ← qwen3:14b-cloudnative 推理
  └──────┬──────┘
         │ 4. 回傳答案
         ▼
  使用者收到答案
```

## 核心元件

| 元件 | 角色 | 版本/規格 |
|---|---|---|
| **Ollama** | 本地 LLM 推理引擎 | v0.18.0, ROCm backend |
| **qwen3:14b-cloudnative** | 推理模型（SRE/Cloud Native 專精） | 9.3GB, 22 tok/s |
| **BGE-M3** | Embedding 模型（繁中最佳） | 1024 維, 8192 token |
| **Qdrant** | 向量資料庫 | HNSW, Cosine Similarity |
| **Dify** | RAG 編排層 | Docker Compose 部署 |

---

## 硬體環境

- **機器**: GMK EVO x2
- **CPU**: AMD Ryzen AI Max+ (Strix Halo), 32 cores
- **GPU**: AMD Radeon 8060S (iGPU, ROCm gfx1151)
- **RAM**: 128 GB（BIOS 分配 96GB 給 GPU）
- **VRAM**: 96 GB unified memory

---

## Ollama 模型調優

### 系統層級設定 (`/etc/systemd/system/ollama.service.d/override.conf`)

```ini
[Service]
Environment="OLLAMA_LLM_LIBRARY=rocm"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q4_0"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_GPU_OVERHEAD=2147483648"
Environment="OLLAMA_HOST=0.0.0.0:11434"
```

### 模型 Modelfile 調優

本專案提供多個 Modelfile，針對不同場景：

| Modelfile | 用途 | 特色 |
|---|---|---|
| `Modelfile.qwen3:14b` | SRE/Cloud Native 快速問答 | **無 thinking**, 22 tok/s |
| `Modelfile.qwen3:14b-think` | 複雜排查/架構設計 | 有 thinking, 深度推理 |
| `Modelfile.gptoss120b` | 國泰世華 CBP 銀行顧問 | 專業金融 system prompt |
| `Modelfile.gptoss120b-cloudnative` | Cloud Native 專家 (gpt-oss) | 34 tok/s, MXFP4 |

### 關鍵調優參數說明

```
PARAMETER num_gpu 99          # 全部層數卸載到 GPU
PARAMETER num_batch 4096      # 加大 batch size 加速 prompt eval
PARAMETER num_ctx 32768       # 上下文長度
PARAMETER temperature 0.4     # 低 temperature 讓技術回答更精準
PARAMETER min_p 0.1           # 取代 top_k，更好的取樣策略
PARAMETER top_k 0             # 關閉 top_k（改用 min_p）
PARAMETER num_predict 4096    # 限制最大輸出 token 數
```

### 模型 Benchmark 結果

在 Strix Halo (96GB VRAM, ~256 GB/s bandwidth) 上實測：

| 模型 | 大小 | 生成速度 | Thinking | 適用場景 |
|---|---|---|---|---|
| gpt-oss:120b | 65GB (MXFP4) | **34 tok/s** | 有 (channel 格式, 前端不支援) | API 後端 |
| **qwen3:14b** | 9GB (Q4_K_M) | **22 tok/s** | `<think>` 標準 / 可關閉 | 前端整合首選 |
| qwen3:32b | 20GB (Q4_K_M) | 10 tok/s | `<think>` 標準 | 品質優先 |
| gemma3:27b | 17GB | 12 tok/s | 無 | 無 thinking 需求 |
| llama3.3:70b | 42GB (Q4_K_M) | 5 tok/s | 無 | 品質最高但慢 |

### Thinking 模式控制

Qwen3 的 thinking 會在前端顯示推理過程。本專案提供兩個版本：

- **`qwen3:14b-cloudnative`**: 透過覆寫 Template 完全關閉 thinking（每則訊息自動注入 `/no_think` + 空 `<think></think>` 前綴）
- **`qwen3:14b-cloudnative-think`**: 保留原始 Template，支援深度推理

### gpt-oss:120b 的 `<|end|>` Stop Token 陷阱

gpt-oss 使用 `<|end|>` 同時作為 **channel 分隔符**和**對話結束符**。若在 Modelfile 中設定 `PARAMETER stop <|end|>`，模型會在 thinking channel 結束後直接被截斷，導致 content 永遠為空。

**解決方案**: 不設定 stop token，讓模型使用內建的結束機制。

---

## RAG 系統原理與實作

### 什麼是 RAG？

RAG (Retrieval-Augmented Generation) 讓 LLM 能夠查詢外部知識庫回答問題，而不是只靠訓練時學到的知識。

```
傳統 LLM:  問題 → LLM → 答案（可能幻覺）
RAG LLM:   問題 → 搜尋知識庫 → [相關文件 + 問題] → LLM → 答案（有依據）
```

### Embedding 模型：BGE-M3

將文字轉換為高維度向量，語意相近的文字在向量空間中距離近。

```
"Kubernetes Pod 記憶體不足" → [0.12, 0.87, -0.34, ...]  (1024 維)
"K8s container OOMKilled"  → [0.11, 0.85, -0.32, ...]  (距離很近！)
```

**為何選 BGE-M3？**
- 8192 token 長視窗，整頁 PDF 不截斷
- 100+ 語言訓練，繁簡中文語意區分強
- 中英混合（金融報告常見）表現優異

### 向量資料庫：Qdrant

儲存和搜尋向量的專用資料庫。

```
Collection
  └── Point
        ├── id       : UUID
        ├── vector   : float[1024]  (BGE-M3 輸出)
        └── payload  : { text, source, page, chunk_id }
```

**HNSW 演算法**: 多層圖結構，搜尋複雜度 O(log n)，比暴力搜尋快數百倍。

### 文件切塊策略

```python
CHUNK_SIZE = 500     # 每個片段 500 字
CHUNK_OVERLAP = 50   # 重疊 50 字保留上下文
# 繁中優先斷點："\n\n" → "\n" → "。" → "，"
```

### Dify：RAG 編排層

Dify 負責將所有元件串接起來：
1. 接收使用者問題
2. 呼叫 BGE-M3 將問題向量化
3. 在 Qdrant 中搜尋最相關的文件片段
4. 組合 `[系統提示 + 知識庫內容 + 使用者問題]` 成完整 Prompt
5. 送給 Ollama (qwen3:14b-cloudnative) 生成答案

---

## 快速開始

### 1. 啟動 Ollama + 模型

```bash
# 確認 Ollama 運行中
curl http://localhost:11434/api/tags

# 建立 SRE 專用模型
ollama create qwen3:14b-cloudnative -f Modelfile.qwen3:14b

# 拉取 Embedding 模型
ollama pull bge-m3
```

### 2. 啟動 Qdrant

```bash
docker run -d \
  --name qdrant \
  -p 6333:6333 \
  -p 6334:6334 \
  -v $(pwd)/qdrant_storage:/qdrant/storage \
  qdrant/qdrant:latest

# 驗證
curl http://localhost:6333/collections
```

### 3. 匯入文件

```bash
# 將文件放入 docs/ 目錄（支援 PDF/TXT/MD）
mkdir -p docs
cp your_documents/*.pdf docs/

# 安裝依賴
pip install qdrant-client sentence-transformers pymupdf tqdm

# 執行匯入
python ingest.py
```

### 4. 部署 Dify

```bash
# Clone Dify
git clone --depth 1 https://github.com/langgenius/dify.git ~/dify

# 設定
cd ~/dify/docker
cp .env.example .env

# 修改 .env
#   VECTOR_STORE=qdrant
#   QDRANT_URL=http://host.docker.internal:6333
#   QDRANT_API_KEY=

# 修改 docker-compose.yaml，在 api 和 worker 服務加入：
#   extra_hosts:
#     - "host.docker.internal:host-gateway"

# 啟動
docker compose up -d
```

### 5. 設定 Dify UI

開啟 `http://localhost:80`，進入設定：

```
Settings → Model Providers → Ollama

  LLM:
    Model Name : qwen3:14b-cloudnative
    Base URL   : http://host.docker.internal:11434

  Text Embedding:
    Model Name : bge-m3
    Base URL   : http://host.docker.internal:11434
```

---

## 專案結構

```
.
├── README.md                          # 本文件
├── local-llm-rag-spec.md             # 詳細規格書
├── ingest.py                          # 文件匯入 Qdrant 工具
├── rag_eval.py                        # RAG 效果評測腳本
├── rag_config.py                      # RAG 共用設定（舊版 ChromaDB）
├── rag_query.py                       # RAG 查詢工具
├── docs/                              # 待匯入的文件目錄
├── qdrant_storage/                    # Qdrant 持久化資料
├── Modelfile.qwen3:14b               # Qwen3 14B SRE 快速版（無 thinking）
├── Modelfile.qwen3:14b-think         # Qwen3 14B SRE 深度版（有 thinking）
├── Modelfile.qwen3:32b               # Qwen3 32B Cloud Native 版
├── Modelfile.gptoss120b              # GPT-OSS 120B 銀行顧問版
└── Modelfile.gptoss120b-cloudnative  # GPT-OSS 120B Cloud Native 版
```

---

## 決策紀錄

| 日期 | 決策 | 理由 |
|---|---|---|
| 2026-03-19 | 推理模型選用 qwen3:14b | 22 tok/s、前端相容、thinking 可控 |
| 2026-03-19 | Embedding 選用 BGE-M3 | 繁中支援最佳，8192 token 長視窗 |
| 2026-03-19 | 向量庫選用 Qdrant | API 簡潔、HNSW 搜尋高效 |
| 2026-03-19 | RAG 編排選用 Dify | 快速驗證，有 UI 管理，OpenAI-compatible API |
| 2026-03-19 | chunk_size = 500 | 繁中段落一般 200-400 字，500 保留完整語意 |
| 2026-03-19 | 關閉 Qwen3 thinking | OpenCode 前端會洩漏 thinking 內容 |
| 2026-03-19 | 不設 gpt-oss stop token | `<|end|>` 同時是 channel 分隔符，設成 stop 會截斷 content |

---

## 授權

MIT License
