#!/usr/bin/env python3
"""
將 PDF 文件切塊並存入 ChromaDB 向量資料庫，供 RAG 查詢使用。
使用 Ollama 的 nomic-embed-text 模型產生 embedding。
"""

import sys
import time
import fitz  # PyMuPDF
import chromadb
import ollama

# ── 設定 ──────────────────────────────────────────────
PDF_PATH = "/home/galileo/workspace/ollama/Microservices_Patterns_dual_Kimi+Qwen.pdf"
CHROMA_DIR = "/home/galileo/workspace/ollama/chroma_db"
COLLECTION_NAME = "microservices_patterns"
EMBED_MODEL = "nomic-embed-text"
CHUNK_SIZE = 1500  # 每塊大約字元數（加大以保留更多上下文）
CHUNK_OVERLAP = 300  # 重疊字元數


def extract_text_from_pdf(pdf_path: str) -> list[dict]:
    """從 PDF 提取文字，每兩頁合併以保留跨頁上下文。"""
    doc = fitz.open(pdf_path)
    pages = []
    for i, page in enumerate(doc):
        text = page.get_text()
        if text.strip():
            pages.append({"page": i + 1, "text": text})
    doc.close()
    print(f"從 PDF 提取了 {len(pages)} 頁有效文字")
    return pages


def chunk_text(pages: list[dict]) -> list[dict]:
    """將文字切成固定大小的塊，帶重疊，並加入頁碼標記提升檢索品質。"""
    chunks = []
    for page_info in pages:
        text = page_info["text"]
        page_num = page_info["page"]
        # 在每塊前面加入頁碼標記，幫助 embedding 理解上下文
        page_prefix = f"[第 {page_num} 頁] "
        start = 0
        while start < len(text):
            end = start + CHUNK_SIZE
            chunk = text[start:end]
            if chunk.strip():
                chunks.append({
                    "text": page_prefix + chunk.strip(),
                    "page": page_num,
                    "chunk_start": start,
                })
            start += CHUNK_SIZE - CHUNK_OVERLAP
    print(f"切成 {len(chunks)} 個文字塊")
    return chunks


def get_embedding(text: str) -> list[float]:
    """使用 Ollama 取得 embedding。"""
    response = ollama.embed(model=EMBED_MODEL, input=text)
    return response["embeddings"][0]


def ingest():
    """主流程：提取 → 切塊 → 向量化 → 存入 ChromaDB。"""
    print("=" * 60)
    print("RAG 資料庫建置工具")
    print("=" * 60)

    # 1. 提取 PDF 文字
    print("\n[1/3] 提取 PDF 文字...")
    pages = extract_text_from_pdf(PDF_PATH)

    # 2. 切塊
    print("\n[2/3] 切割文字塊...")
    chunks = chunk_text(pages)

    # 3. 向量化並存入 ChromaDB
    print(f"\n[3/3] 向量化並存入 ChromaDB ({CHROMA_DIR})...")
    client = chromadb.PersistentClient(path=CHROMA_DIR)

    # 若已存在則先刪除重建
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"  已刪除舊的 collection: {COLLECTION_NAME}")
    except Exception:
        pass

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    batch_size = 50
    total = len(chunks)
    start_time = time.time()

    for i in range(0, total, batch_size):
        batch = chunks[i : i + batch_size]
        ids = [f"chunk_{i + j}" for j in range(len(batch))]
        documents = [c["text"] for c in batch]
        metadatas = [{"page": c["page"], "chunk_start": c["chunk_start"]} for c in batch]

        # 批次取得 embeddings
        response = ollama.embed(model=EMBED_MODEL, input=documents)
        embeddings = response["embeddings"]

        collection.add(
            ids=ids,
            documents=documents,
            metadatas=metadatas,
            embeddings=embeddings,
        )

        done = min(i + batch_size, total)
        elapsed = time.time() - start_time
        rate = done / elapsed if elapsed > 0 else 0
        eta = (total - done) / rate if rate > 0 else 0
        print(f"  進度: {done}/{total} ({done*100//total}%) - {rate:.1f} chunks/s - 預估剩餘 {eta:.0f}s", end="\r")

    elapsed_total = time.time() - start_time
    print(f"\n\n完成! 共處理 {total} 個文字塊，耗時 {elapsed_total:.1f} 秒")
    print(f"向量資料庫儲存於: {CHROMA_DIR}")
    print(f"Collection 名稱: {COLLECTION_NAME}")


if __name__ == "__main__":
    ingest()
