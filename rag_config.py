"""RAG 系統共用設定與工具函式。"""

import json
import os
import re
import pickle
import jieba
from rank_bm25 import BM25Okapi

# ── 路徑與模型設定 ────────────────────────────────────
BASE_DIR = "/home/galileo/workspace/ollama"
PDF_PATH = os.path.join(BASE_DIR, "Microservices_Patterns_dual_Kimi+Qwen.pdf")
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")
BM25_PATH = os.path.join(BASE_DIR, "bm25_index.pkl")
COLLECTION_NAME = "microservices_patterns"
EMBED_MODEL = "nomic-embed-text"
LLM_MODEL = "bank-architect"

# ── 檢索參數 ─────────────────────────────────────────
TOP_K = 10
VECTOR_WEIGHT = 0.6  # RRF 中向量檢索的權重
BM25_WEIGHT = 0.4    # RRF 中 BM25 的權重
RRF_K = 60           # Reciprocal Rank Fusion 常數

# ── 切塊參數（改善後）──────────────────────────────────
CHUNK_SIZE = 800     # 縮小以提高精確度
CHUNK_OVERLAP = 200  # 適當重疊

# ── Query Expansion：中英對照術語表 ─────────────────────
TERM_EXPANSION = {
    # 架構模式
    "saga": ["saga", "saga pattern", "補償交易", "compensating transaction", "本地交易"],
    "斷路器": ["circuit breaker", "斷路器", "half-open", "半開狀態", "熔斷"],
    "circuit breaker": ["circuit breaker", "斷路器", "half-open", "半開狀態"],
    "api gateway": ["api gateway", "API 閘道", "request routing", "請求路由", "protocol translation", "協議轉換"],
    "api 閘道": ["api gateway", "API 閘道", "request routing", "請求路由"],
    "cqrs": ["cqrs", "command query responsibility segregation", "命令查詢職責分離", "命令查詢責任分離"],
    "命令查詢職責分離": ["cqrs", "command query responsibility segregation", "命令查詢職責分離"],
    "event sourcing": ["event sourcing", "事件溯源", "event store", "事件存儲", "aggregate", "聚合"],
    "事件溯源": ["event sourcing", "事件溯源", "event store", "事件存儲"],
    "strangler": ["strangler application", "strangler fig", "絞殺者", "絞殺者應用程式", "漸進式遷移"],
    "絞殺者": ["strangler application", "strangler fig", "絞殺者", "漸進式遷移"],
    "api composition": ["api composition", "API 組合", "api composer", "API 組合器"],
    "api 組合": ["api composition", "API 組合", "api composer", "API 組合器"],
    # 服務發現
    "service discovery": ["service discovery", "服務發現", "service registry", "服務註冊表", "服務註冊"],
    "服務發現": ["service discovery", "服務發現", "service registry", "服務註冊表"],
    # 通訊
    "messaging": ["messaging", "訊息傳遞", "message broker", "訊息代理", "message channel", "訊息通道"],
    "訊息傳遞": ["messaging", "訊息傳遞", "message broker", "訊息代理"],
    "message channel": ["message channel", "訊息通道", "point-to-point", "點對點", "publish-subscribe", "發布-訂閱", "發佈-訂閱"],
    "訊息通道": ["message channel", "訊息通道", "point-to-point", "點對點", "publish-subscribe", "發布-訂閱"],
    # 分解
    "decompose by business capability": ["decompose by business capability", "按業務能力分解", "business capability", "業務能力"],
    "業務能力分解": ["decompose by business capability", "按業務能力分解", "business capability", "業務能力"],
    "decompose by subdomain": ["decompose by subdomain", "按子領域分解", "subdomain", "子領域", "ddd", "domain-driven design", "領域驅動設計", "bounded context", "限界上下文"],
    "子領域分解": ["decompose by subdomain", "按子領域分解", "subdomain", "子領域", "ddd", "領域驅動設計"],
    # 部署
    "sidecar": ["sidecar", "邊車", "邊車模式"],
    "service mesh": ["service mesh", "服務網格"],
    # 測試
    "consumer-driven contract": ["consumer-driven contract", "消費者驅動的合約測試"],
    # 可觀察性
    "distributed tracing": ["distributed tracing", "分散式追蹤", "分佈式追蹤"],
    "health check": ["health check", "健康檢查", "health check api"],
}


def tokenize(text: str) -> list[str]:
    """中英文混合斷詞。"""
    text = text.lower()
    # 先用 jieba 做中文斷詞，同時保留英文單詞
    tokens = []
    for word in jieba.cut(text):
        word = word.strip()
        if len(word) > 1 or word.isalpha():
            tokens.append(word)
    return tokens


def expand_query(question: str) -> str:
    """根據術語表擴展查詢，加入同義詞。"""
    question_lower = question.lower()
    expansions = set()
    for key, synonyms in TERM_EXPANSION.items():
        if key in question_lower:
            expansions.update(synonyms)
    if expansions:
        return question + " " + " ".join(expansions)
    return question


def build_bm25_index(documents: list[str], doc_ids: list[str]) -> None:
    """建立 BM25 索引並序列化到磁碟。"""
    tokenized = [tokenize(doc) for doc in documents]
    bm25 = BM25Okapi(tokenized)
    with open(BM25_PATH, "wb") as f:
        pickle.dump({"bm25": bm25, "doc_ids": doc_ids, "documents": documents}, f)
    print(f"BM25 索引已儲存: {BM25_PATH}")


def load_bm25_index() -> dict | None:
    """載入 BM25 索引。"""
    if not os.path.exists(BM25_PATH):
        return None
    with open(BM25_PATH, "rb") as f:
        return pickle.load(f)


def hybrid_search(question: str, collection, top_k: int = TOP_K) -> list[dict]:
    """混合檢索：向量搜尋 + BM25，用 RRF 融合排序。"""
    import ollama

    # 1. Query expansion
    expanded = expand_query(question)

    # 2. 向量檢索（用擴展後的 query）
    q_embed = ollama.embed(model=EMBED_MODEL, input=expanded)["embeddings"][0]
    vec_results = collection.query(
        query_embeddings=[q_embed],
        n_results=min(top_k * 3, 50),  # 多取一些候選，後續融合
    )
    vec_ids = vec_results["ids"][0]
    vec_docs = vec_results["documents"][0]
    vec_metas = vec_results["metadatas"][0]
    vec_dists = vec_results["distances"][0]

    # 建立 id → 資料的映射
    doc_map = {}
    for i, (did, doc, meta, dist) in enumerate(zip(vec_ids, vec_docs, vec_metas, vec_dists)):
        doc_map[did] = {"text": doc, "page": meta["page"], "similarity": 1 - dist}

    # 3. BM25 檢索
    bm25_data = load_bm25_index()
    bm25_ranking = {}
    if bm25_data:
        query_tokens = tokenize(expanded)
        scores = bm25_data["bm25"].get_scores(query_tokens)
        # 取 top 候選
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k * 3]
        for rank, idx in enumerate(top_indices):
            did = bm25_data["doc_ids"][idx]
            bm25_ranking[did] = rank + 1
            if did not in doc_map:
                doc_map[did] = {
                    "text": bm25_data["documents"][idx],
                    "page": 0,  # 從 BM25 來的，需要從 collection 取 metadata
                    "similarity": 0.0,
                }

    # 4. RRF 融合
    # 向量排名
    vec_ranking = {did: rank + 1 for rank, did in enumerate(vec_ids)}

    rrf_scores = {}
    for did in doc_map:
        vec_rank = vec_ranking.get(did, 1000)
        bm25_rank = bm25_ranking.get(did, 1000)
        rrf_scores[did] = (
            VECTOR_WEIGHT / (RRF_K + vec_rank) +
            BM25_WEIGHT / (RRF_K + bm25_rank)
        )

    # 5. 排序取 top_k
    sorted_ids = sorted(rrf_scores, key=lambda x: rrf_scores[x], reverse=True)[:top_k]

    # 6. 補全 metadata（BM25 獨有的結果需要從 collection 取 page）
    results = []
    for did in sorted_ids:
        info = doc_map[did]
        if info["page"] == 0:
            # 從 ChromaDB 取 metadata
            try:
                meta = collection.get(ids=[did])
                if meta["metadatas"]:
                    info["page"] = meta["metadatas"][0].get("page", 0)
            except Exception:
                pass
        results.append(info)

    return results
