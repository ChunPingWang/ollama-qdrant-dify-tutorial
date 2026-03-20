#!/usr/bin/env python3
"""
RAG 查詢介面：混合檢索（向量 + BM25）+ Query Expansion，送給 LLM 回答。
支援互動式對話與單次查詢模式。
"""

import json
import sys
import urllib.request

from rag_config import (
    COLLECTION_NAME, LLM_MODEL, TOP_K,
    hybrid_search, expand_query, get_qdrant_client,
)

SYSTEM_PROMPT = """你是一位資深的系統架構師，專精於微服務架構設計與 Kubernetes 容器編排。
你的知識來源是《Hands On Microservices With Kubernetes》這本書。

回答規則：
1. 根據提供的參考資料 (Context) 來回答問題
2. 如果參考資料中找不到答案，請誠實說明
3. 回答時盡量引用具體的章節、頁碼
4. 以繁體中文回答，但專有名詞可保留英文
5. 結合實際場景給出建議
"""


def query_rag(question: str, client, verbose: bool = False) -> str:
    """執行 RAG 查詢：混合檢索 → 組合 prompt → 呼叫 LLM。"""

    # 1. 混合檢索（向量 + BM25 + Query Expansion）
    results = hybrid_search(question, client, top_k=TOP_K)

    # 2. 組合 context
    context_parts = []
    for i, r in enumerate(results):
        context_parts.append(
            f"[參考 {i+1}] (第 {r['page']} 頁, 相似度: {r['similarity']:.3f})\n{r['text']}"
        )

    context = "\n\n---\n\n".join(context_parts)

    if verbose:
        expanded = expand_query(question)
        if expanded != question:
            print(f"\n  Query Expansion: {expanded[:120]}...")
        print("\n" + "─" * 40)
        print("檢索到的參考資料:")
        print("─" * 40)
        for part in context_parts:
            print(part[:200] + "..." if len(part) > 200 else part)
            print()
        print("─" * 40 + "\n")

    # 3. 呼叫 LLM
    user_message = f"""根據以下參考資料回答問題。

## 參考資料 (Context)
{context}

## 問題
{question}
"""

    payload = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "stream": True,
        "options": {"num_ctx": 8192, "stop": []},
    }).encode()

    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    full_response = []
    with urllib.request.urlopen(req, timeout=600) as resp:
        for line in resp:
            if not line.strip():
                continue
            data = json.loads(line)
            token = data.get("message", {}).get("content", "")
            if token:
                sys.stdout.write(token)
                sys.stdout.flush()
                full_response.append(token)
            if data.get("done"):
                break
    sys.stdout.write("\n")
    sys.stdout.flush()

    return "".join(full_response)


def main():
    client = get_qdrant_client()
    try:
        info = client.get_collection(COLLECTION_NAME)
        count = info.points_count
    except Exception:
        print("錯誤: 找不到向量資料庫！請先執行 ingest.py 建立資料庫。")
        sys.exit(1)

    print(f"已載入向量資料庫: {count} 個文字塊")
    print(f"LLM 模型: {LLM_MODEL}")
    print(f"檢索模式: 混合 (向量 + BM25 + Query Expansion)")

    # 單次查詢模式
    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
        print(f"\n問題: {question}\n")
        query_rag(question, client, verbose=True)
        return

    # 互動模式
    print("\n輸入問題開始查詢 (輸入 'quit' 或 'q' 退出, 'v' 切換顯示參考資料)")
    print("=" * 60)

    verbose = False
    while True:
        try:
            question = input("\n📚 問題> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再見!")
            break

        if not question:
            continue
        if question.lower() in ("quit", "q", "exit"):
            print("再見!")
            break
        if question.lower() == "v":
            verbose = not verbose
            print(f"顯示參考資料: {'開啟' if verbose else '關閉'}")
            continue

        print()
        query_rag(question, client, verbose=verbose)


if __name__ == "__main__":
    main()
