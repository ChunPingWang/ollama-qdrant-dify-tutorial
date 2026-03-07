#!/usr/bin/env python3
"""
RAG 自動調參工具：Grid Search 找出最佳參數組合。
針對 chunk_size, chunk_overlap, top_k, vector_weight 進行搜尋，
用 rag_eval.py 的 Golden QA Set 計算指標。

用法：
  python3 rag_tuner.py                # 完整 grid search（含重建索引，較慢）
  python3 rag_tuner.py --quick        # 僅調 retrieval 參數（不重建索引，快速）
"""

import itertools
import json
import os
import pickle
import sys
import time
import chromadb
import ollama

# 載入 Golden QA Set 和評估函式
from rag_eval import GOLDEN_QA, eval_retrieval, _chunk_matches_keywords

# ── Grid Search 參數空間 ──────────────────────────────
# 完整模式：會重建索引（慢）
CHUNK_SIZES = [600, 800, 1000]
CHUNK_OVERLAPS = [150, 200, 300]

# 快速模式：僅調檢索參數（不重建索引）
TOP_KS = [8, 10, 12, 15]
VECTOR_WEIGHTS = [0.4, 0.5, 0.6, 0.7, 0.8]
RRF_KS = [60]  # 標準值，通常不需要調

# ── 設定 ──────────────────────────────────────────────
BASE_DIR = "/home/galileo/workspace/ollama"
CHROMA_DIR = os.path.join(BASE_DIR, "chroma_db")
BM25_PATH = os.path.join(BASE_DIR, "bm25_index.pkl")
COLLECTION_NAME = "microservices_patterns"
EMBED_MODEL = "nomic-embed-text"
PDF_PATH = os.path.join(BASE_DIR, "Microservices_Patterns_dual_Kimi+Qwen.pdf")


def build_index(chunk_size: int, chunk_overlap: int) -> tuple[object, dict]:
    """重建向量資料庫與 BM25 索引，回傳 (collection, bm25_data)。"""
    import fitz
    from rag_config import tokenize
    from rank_bm25 import BM25Okapi

    # 提取 PDF 文字
    doc = fitz.open(PDF_PATH)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text()
        if text.strip():
            pages.append({"page": i + 1, "text": text})
    doc.close()

    # 切塊
    chunks = []
    for page_info in pages:
        text = page_info["text"]
        page_num = page_info["page"]
        page_prefix = f"[第 {page_num} 頁] "
        start = 0
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            if chunk.strip():
                chunks.append({
                    "text": page_prefix + chunk.strip(),
                    "page": page_num,
                    "chunk_start": start,
                })
            start += chunk_size - chunk_overlap

    # 重建 ChromaDB
    client = chromadb.PersistentClient(path=CHROMA_DIR)
    try:
        client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass
    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    all_ids = []
    all_documents = []
    batch_size = 50
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        ids = [f"chunk_{i + j}" for j in range(len(batch))]
        documents = [c["text"] for c in batch]
        metadatas = [{"page": c["page"], "chunk_start": c["chunk_start"]} for c in batch]
        response = ollama.embed(model=EMBED_MODEL, input=documents)
        collection.add(ids=ids, documents=documents, metadatas=metadatas, embeddings=response["embeddings"])
        all_ids.extend(ids)
        all_documents.extend(documents)

    # 建立 BM25
    tokenized = [tokenize(doc) for doc in all_documents]
    bm25 = BM25Okapi(tokenized)
    bm25_data = {"bm25": bm25, "doc_ids": all_ids, "documents": all_documents}
    with open(BM25_PATH, "wb") as f:
        pickle.dump(bm25_data, f)

    return collection, bm25_data


def hybrid_search_with_params(
    question: str, collection, bm25_data: dict,
    top_k: int, vector_weight: float, bm25_weight: float, rrf_k: int,
    expanded_query: str,
) -> list[dict]:
    """用指定參數執行混合檢索。"""
    # 向量檢索
    q_embed = ollama.embed(model=EMBED_MODEL, input=expanded_query)["embeddings"][0]
    vec_results = collection.query(query_embeddings=[q_embed], n_results=min(top_k * 3, 50))
    vec_ids = vec_results["ids"][0]
    vec_docs = vec_results["documents"][0]
    vec_metas = vec_results["metadatas"][0]
    vec_dists = vec_results["distances"][0]

    doc_map = {}
    for i, (did, doc, meta, dist) in enumerate(zip(vec_ids, vec_docs, vec_metas, vec_dists)):
        doc_map[did] = {"text": doc, "page": meta["page"], "similarity": 1 - dist}

    # BM25 檢索
    from rag_config import tokenize
    query_tokens = tokenize(expanded_query)
    scores = bm25_data["bm25"].get_scores(query_tokens)
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k * 3]
    bm25_ranking = {}
    for rank, idx in enumerate(top_indices):
        did = bm25_data["doc_ids"][idx]
        bm25_ranking[did] = rank + 1
        if did not in doc_map:
            doc_map[did] = {"text": bm25_data["documents"][idx], "page": 0, "similarity": 0.0}

    # RRF 融合
    vec_ranking = {did: rank + 1 for rank, did in enumerate(vec_ids)}
    rrf_scores = {}
    for did in doc_map:
        vec_rank = vec_ranking.get(did, 1000)
        bm25_rank = bm25_ranking.get(did, 1000)
        rrf_scores[did] = vector_weight / (rrf_k + vec_rank) + bm25_weight / (rrf_k + bm25_rank)

    sorted_ids = sorted(rrf_scores, key=lambda x: rrf_scores[x], reverse=True)[:top_k]

    results = []
    for did in sorted_ids:
        info = doc_map[did]
        if info["page"] == 0:
            try:
                meta = collection.get(ids=[did])
                if meta["metadatas"]:
                    info["page"] = meta["metadatas"][0].get("page", 0)
            except Exception:
                pass
        results.append(info)
    return results


def eval_params(
    collection, bm25_data: dict,
    top_k: int, vector_weight: float, rrf_k: int,
) -> dict:
    """用指定參數跑所有 Golden QA，回傳彙總指標。"""
    from rag_config import expand_query
    bm25_weight = 1.0 - vector_weight

    results = []
    for qa in GOLDEN_QA:
        expanded = expand_query(qa["question"])
        retrieved = hybrid_search_with_params(
            qa["question"], collection, bm25_data,
            top_k, vector_weight, bm25_weight, rrf_k, expanded,
        )
        ret_eval = eval_retrieval(qa, retrieved)
        results.append(ret_eval)

    n = len(results)
    return {
        "hit_rate": sum(r["hit"] for r in results) / n,
        "mrr": sum(r["mrr"] for r in results) / n,
        "precision": sum(r["precision"] for r in results) / n,
        # 綜合分數：加權平均
        "score": (
            sum(r["hit"] for r in results) / n * 0.4 +
            sum(r["mrr"] for r in results) / n * 0.35 +
            sum(r["precision"] for r in results) / n * 0.25
        ),
    }


def run_quick_tuning():
    """僅調檢索參數（不重建索引），用當前索引快速搜尋最佳設定。"""
    print("=" * 70)
    print("RAG 自動調參 — 快速模式（僅調檢索參數）")
    print("=" * 70)

    client = chromadb.PersistentClient(path=CHROMA_DIR)
    collection = client.get_collection(COLLECTION_NAME)
    print(f"向量資料庫: {collection.count()} 個文字塊")

    with open(BM25_PATH, "rb") as f:
        bm25_data = pickle.load(f)

    combos = list(itertools.product(TOP_KS, VECTOR_WEIGHTS, RRF_KS))
    print(f"參數組合數: {len(combos)}")
    print()

    all_results = []
    for i, (top_k, vec_w, rrf_k) in enumerate(combos):
        bm25_w = round(1.0 - vec_w, 1)
        metrics = eval_params(collection, bm25_data, top_k, vec_w, rrf_k)
        all_results.append({
            "top_k": top_k, "vector_weight": vec_w, "bm25_weight": bm25_w, "rrf_k": rrf_k,
            **metrics,
        })
        print(f"  [{i+1}/{len(combos)}] top_k={top_k:2d} vec_w={vec_w:.1f} bm25_w={bm25_w:.1f} "
              f"→ Hit={metrics['hit_rate']:.0%} MRR={metrics['mrr']:.3f} "
              f"Prec={metrics['precision']:.3f} Score={metrics['score']:.3f}")

    # 排序找最佳
    all_results.sort(key=lambda x: x["score"], reverse=True)

    print("\n" + "=" * 70)
    print("Top 5 最佳參數組合")
    print("=" * 70)
    print(f"{'排名':>4} {'top_k':>6} {'vec_w':>6} {'bm25_w':>7} {'Hit':>6} {'MRR':>6} {'Prec':>6} {'Score':>7}")
    print("-" * 60)
    for i, r in enumerate(all_results[:5]):
        print(f"{i+1:4d} {r['top_k']:6d} {r['vector_weight']:6.1f} {r['bm25_weight']:7.1f} "
              f"{r['hit_rate']:6.0%} {r['mrr']:6.3f} {r['precision']:6.3f} {r['score']:7.3f}")

    best = all_results[0]
    print(f"\n最佳參數:")
    print(f"  TOP_K          = {best['top_k']}")
    print(f"  VECTOR_WEIGHT  = {best['vector_weight']}")
    print(f"  BM25_WEIGHT    = {best['bm25_weight']}")
    print(f"  綜合分數       = {best['score']:.3f}")
    print(f"  Hit Rate       = {best['hit_rate']:.0%}")
    print(f"  MRR            = {best['mrr']:.3f}")
    print(f"  Precision      = {best['precision']:.3f}")

    # 輸出可直接貼到 rag_config.py 的設定
    print(f"\n可貼入 rag_config.py 的設定:")
    print(f"  TOP_K = {best['top_k']}")
    print(f"  VECTOR_WEIGHT = {best['vector_weight']}")
    print(f"  BM25_WEIGHT = {best['bm25_weight']}")

    return all_results


def run_full_tuning():
    """完整 grid search，包含重建索引。"""
    print("=" * 70)
    print("RAG 自動調參 — 完整模式（含重建索引）")
    print("=" * 70)

    chunk_combos = list(itertools.product(CHUNK_SIZES, CHUNK_OVERLAPS))
    retrieval_combos = list(itertools.product(TOP_KS, VECTOR_WEIGHTS, RRF_KS))
    total = len(chunk_combos) * len(retrieval_combos)
    print(f"切塊組合: {len(chunk_combos)}, 檢索組合: {len(retrieval_combos)}, 總計: {total}")
    print("注意: 每組切塊參數需重建索引，完整搜尋可能需要較長時間。\n")

    all_results = []
    run = 0

    for chunk_size, chunk_overlap in chunk_combos:
        if chunk_overlap >= chunk_size:
            continue

        print(f"\n{'='*50}")
        print(f"重建索引: chunk_size={chunk_size}, overlap={chunk_overlap}")
        print(f"{'='*50}")
        t0 = time.time()
        collection, bm25_data = build_index(chunk_size, chunk_overlap)
        n_chunks = collection.count()
        print(f"  完成: {n_chunks} 個文字塊，耗時 {time.time()-t0:.0f}s")

        for top_k, vec_w, rrf_k in retrieval_combos:
            run += 1
            bm25_w = round(1.0 - vec_w, 1)
            metrics = eval_params(collection, bm25_data, top_k, vec_w, rrf_k)
            result = {
                "chunk_size": chunk_size, "chunk_overlap": chunk_overlap, "n_chunks": n_chunks,
                "top_k": top_k, "vector_weight": vec_w, "bm25_weight": bm25_w, "rrf_k": rrf_k,
                **metrics,
            }
            all_results.append(result)
            print(f"  [{run}/{total}] top_k={top_k:2d} vec_w={vec_w:.1f} "
                  f"→ Hit={metrics['hit_rate']:.0%} MRR={metrics['mrr']:.3f} Score={metrics['score']:.3f}")

    # 排序
    all_results.sort(key=lambda x: x["score"], reverse=True)

    print(f"\n{'='*70}")
    print("Top 10 最佳參數組合")
    print(f"{'='*70}")
    print(f"{'#':>3} {'chunk':>6} {'ovlp':>5} {'#塊':>5} {'top_k':>6} {'vec_w':>6} "
          f"{'Hit':>5} {'MRR':>6} {'Prec':>6} {'Score':>7}")
    print("-" * 70)
    for i, r in enumerate(all_results[:10]):
        print(f"{i+1:3d} {r['chunk_size']:6d} {r['chunk_overlap']:5d} {r['n_chunks']:5d} "
              f"{r['top_k']:6d} {r['vector_weight']:6.1f} "
              f"{r['hit_rate']:5.0%} {r['mrr']:6.3f} {r['precision']:6.3f} {r['score']:7.3f}")

    best = all_results[0]
    print(f"\n最佳參數:")
    print(f"  CHUNK_SIZE     = {best['chunk_size']}")
    print(f"  CHUNK_OVERLAP  = {best['chunk_overlap']}")
    print(f"  TOP_K          = {best['top_k']}")
    print(f"  VECTOR_WEIGHT  = {best['vector_weight']}")
    print(f"  BM25_WEIGHT    = {best['bm25_weight']}")
    print(f"  綜合分數       = {best['score']:.3f}")

    # 用最佳切塊參數重建索引
    if best["chunk_size"] != all_results[-1].get("chunk_size") or True:
        print(f"\n以最佳切塊參數重建索引...")
        build_index(best["chunk_size"], best["chunk_overlap"])
        print("完成! 索引已更新為最佳設定。")

    print(f"\n可貼入 rag_config.py 的設定:")
    print(f"  CHUNK_SIZE = {best['chunk_size']}")
    print(f"  CHUNK_OVERLAP = {best['chunk_overlap']}")
    print(f"  TOP_K = {best['top_k']}")
    print(f"  VECTOR_WEIGHT = {best['vector_weight']}")
    print(f"  BM25_WEIGHT = {best['bm25_weight']}")

    # 儲存完整結果
    result_path = os.path.join(BASE_DIR, "tuning_results.json")
    with open(result_path, "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    print(f"\n完整結果已儲存: {result_path}")

    return all_results


if __name__ == "__main__":
    if "--quick" in sys.argv:
        run_quick_tuning()
    else:
        run_full_tuning()
