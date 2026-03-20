#!/usr/bin/env python3
"""
從 stdin 或命令列參數接收文字，切塊後存入 Qdrant RAG 知識庫。

用法:
  # 直接輸入文字
  python ingest_stdin.py "Kubernetes Pod OOMKilled 時應檢查 limits 設定"

  # 指定來源標籤
  python ingest_stdin.py -s "SRE筆記" "Pod 重啟排查 SOP：先看 describe、再看 logs"

  # 從 stdin 讀取（可搭配 pipe）
  echo "重要知識..." | python ingest_stdin.py -s "opencode"

  # 互動模式（多行輸入，Ctrl+D 結束）
  python ingest_stdin.py -s "會議記錄"
"""

import sys
import uuid
import argparse
from datetime import datetime

import ollama
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

# ── 設定（與 ingest.py 一致）──────────────────────────
QDRANT_HOST = "localhost"
QDRANT_PORT = 6333
COLLECTION = "bank_docs"
EMBED_MODEL = "bge-m3"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


def chunk_text(text: str) -> list[str]:
    """將文字切成固定大小的塊。短文字直接回傳不切割。"""
    text = text.strip()
    if not text:
        return []
    if len(text) <= CHUNK_SIZE:
        return [text]

    chunks = []
    separators = ["\n\n", "\n", "。", "，", " ", ""]
    start = 0

    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))

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
            chunks.append(chunk)
        start = max(start + 1, end - CHUNK_OVERLAP)

    return chunks


def main():
    parser = argparse.ArgumentParser(description="將文字存入 RAG 知識庫")
    parser.add_argument("text", nargs="?", help="要存入的文字（省略則從 stdin 讀取）")
    parser.add_argument("-s", "--source", default="opencode", help="來源標籤 (預設: opencode)")
    args = parser.parse_args()

    # 取得文字：命令列參數 > stdin
    if args.text:
        text = args.text
    elif not sys.stdin.isatty():
        text = sys.stdin.read()
    else:
        print("請輸入文字（Ctrl+D 結束）:")
        text = sys.stdin.read()

    text = text.strip()
    if not text:
        print("沒有輸入文字，略過。")
        sys.exit(0)

    # 切塊
    chunks = chunk_text(text)
    print(f"文字長度: {len(text)} 字 → {len(chunks)} 個片段")

    # 向量化
    print(f"向量化中 ({EMBED_MODEL})...", end=" ", flush=True)
    response = ollama.embed(model=EMBED_MODEL, input=chunks)
    embeddings = response["embeddings"]
    print("完成")

    # 存入 Qdrant
    client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
    timestamp = datetime.now().isoformat()

    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector=emb,
            payload={
                "text": chunk,
                "source": args.source,
                "page": 0,
                "chunk_id": f"{args.source}_{timestamp}_{i}",
                "ingested_at": timestamp,
            },
        )
        for i, (chunk, emb) in enumerate(zip(chunks, embeddings))
    ]

    client.upsert(collection_name=COLLECTION, points=points)

    info = client.get_collection(COLLECTION)
    print(f"已存入 {len(points)} 個片段 → {COLLECTION} (總計 {info.points_count} points)")


if __name__ == "__main__":
    main()
