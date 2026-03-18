#!/usr/bin/env python3
"""
將 docs/ 目錄下的 PDF/TXT/MD 文件切塊並存入 Qdrant 向量資料庫，供 RAG 查詢使用。
使用 Ollama 的 bge-m3 模型產生 embedding。
"""

import os
import sys
import time
import glob
import uuid
import fitz  # PyMuPDF
import ollama
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
)

# ── 設定 ──────────────────────────────────────────────
QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
COLLECTION = "bank_docs"
EMBED_MODEL = "bge-m3"
EMBED_DIM = 1024          # BGE-M3 輸出維度
DOCS_DIR = "./docs"
CHUNK_SIZE = 500           # 每個片段字數
CHUNK_OVERLAP = 50         # 片段重疊（保留上下文）
BATCH_SIZE = 32            # 每批向量化數量


def extract_text_from_pdf(pdf_path: str) -> list[dict]:
    """從 PDF 提取文字，逐頁。"""
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text()
        if text.strip():
            pages.append({"page": i + 1, "text": text, "source": os.path.basename(pdf_path)})
    doc.close()
    return pages


def extract_text_from_txt(file_path: str) -> list[dict]:
    """從 TXT/MD 提取文字。"""
    with open(file_path, "r", encoding="utf-8") as f:
        text = f.read()
    if text.strip():
        return [{"page": 1, "text": text, "source": os.path.basename(file_path)}]
    return []


def extract_all_docs(docs_dir: str) -> list[dict]:
    """從 docs/ 目錄提取所有文件文字。"""
    all_pages = []
    patterns = ["*.pdf", "*.txt", "*.md"]
    for pattern in patterns:
        for file_path in sorted(glob.glob(os.path.join(docs_dir, pattern))):
            print(f"  讀取: {os.path.basename(file_path)}")
            if file_path.endswith(".pdf"):
                pages = extract_text_from_pdf(file_path)
            else:
                pages = extract_text_from_txt(file_path)
            all_pages.extend(pages)
            print(f"    → {len(pages)} 頁")
    return all_pages


def chunk_text(pages: list[dict]) -> list[dict]:
    """將文字切成固定大小的塊，帶重疊。繁中優先使用句號和逗號作為斷點。"""
    chunks = []
    separators = ["\n\n", "\n", "。", "，", " ", ""]

    for page_info in pages:
        text = page_info["text"]
        source = page_info["source"]
        page_num = page_info["page"]

        start = 0
        while start < len(text):
            end = min(start + CHUNK_SIZE, len(text))

            # 嘗試在分隔符處斷開
            if end < len(text):
                best_break = end
                for sep in separators:
                    if not sep:
                        break
                    idx = text.rfind(sep, start, end)
                    if idx > start + CHUNK_SIZE // 2:
                        best_break = idx + len(sep)
                        break
                end = best_break

            chunk = text[start:end].strip()
            if chunk:
                chunks.append({
                    "text": chunk,
                    "source": source,
                    "page": page_num,
                    "chunk_id": f"{source}_p{page_num}_{start}",
                })
            start = max(start + 1, end - CHUNK_OVERLAP)

    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """使用 Ollama bge-m3 產生 embedding。"""
    response = ollama.embed(model=EMBED_MODEL, input=texts)
    return response["embeddings"]


def ingest():
    """主流程：提取 → 切塊 → 向量化 → 存入 Qdrant。"""
    print("=" * 60)
    print("RAG 資料庫建置工具 (Qdrant + BGE-M3)")
    print("=" * 60)

    # 0. 檢查 docs/
    if not os.path.isdir(DOCS_DIR):
        print(f"\n❌ 找不到 {DOCS_DIR} 目錄，請先建立並放入文件。")
        sys.exit(1)

    # 1. 提取文字
    print(f"\n[1/3] 提取 {DOCS_DIR} 下所有文件...")
    pages = extract_all_docs(DOCS_DIR)
    if not pages:
        print(f"\n❌ {DOCS_DIR} 中沒有可提取的文件（支援 PDF/TXT/MD）。")
        sys.exit(1)
    print(f"  共提取 {len(pages)} 頁文字")

    # 2. 切塊
    print(f"\n[2/3] 切割文字塊 (chunk_size={CHUNK_SIZE}, overlap={CHUNK_OVERLAP})...")
    chunks = chunk_text(pages)
    print(f"  共 {len(chunks)} 個文字塊")

    # 3. 向量化並存入 Qdrant
    print(f"\n[3/3] 向量化並存入 Qdrant ({QDRANT_HOST}:{QDRANT_PORT})...")
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)

    # 重建 collection
    if client.collection_exists(COLLECTION):
        client.delete_collection(COLLECTION)
        print(f"  已刪除舊的 collection: {COLLECTION}")

    client.create_collection(
        collection_name=COLLECTION,
        vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
    )
    print(f"  已建立 collection: {COLLECTION} (dim={EMBED_DIM}, cosine)")

    total = len(chunks)
    start_time = time.time()

    for i in range(0, total, BATCH_SIZE):
        batch = chunks[i : i + BATCH_SIZE]
        texts = [c["text"] for c in batch]

        # 向量化
        embeddings = embed_texts(texts)

        # 建立 points
        points = []
        for j, (chunk, embedding) in enumerate(zip(batch, embeddings)):
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload={
                        "text": chunk["text"],
                        "source": chunk["source"],
                        "page": chunk["page"],
                        "chunk_id": chunk["chunk_id"],
                    },
                )
            )

        client.upsert(collection_name=COLLECTION, points=points)

        done = min(i + BATCH_SIZE, total)
        elapsed = time.time() - start_time
        rate = done / elapsed if elapsed > 0 else 0
        eta = (total - done) / rate if rate > 0 else 0
        print(f"  進度: {done}/{total} ({done * 100 // total}%) - {rate:.1f} chunks/s - ETA {eta:.0f}s", end="\r")

    elapsed_total = time.time() - start_time
    print(f"\n\n完成! 共處理 {total} 個文字塊，耗時 {elapsed_total:.1f} 秒")
    print(f"Qdrant collection: {COLLECTION}")

    # 驗證
    info = client.get_collection(COLLECTION)
    print(f"驗證: {info.points_count} points in collection")


if __name__ == "__main__":
    ingest()
