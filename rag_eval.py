#!/usr/bin/env python3
"""
RAG 評估腳本：用 Golden QA Set 量化檢索品質與生成品質。
指標：
  - 檢索層：Hit Rate@K, MRR@K, Avg Similarity
  - 生成層：LLM-as-Judge 評分 (Faithfulness, Relevancy)
"""

import json
import sys
import time
import urllib.request

from rag_config import (
    COLLECTION_NAME, EMBED_MODEL, LLM_MODEL, TOP_K,
    hybrid_search, expand_query, get_qdrant_client,
)

# ── Golden QA Set ────────────────────────────────────
# 每題包含: question, expected_keywords (判斷檢索命中的關鍵詞), golden_answer
GOLDEN_QA = [
    {
        "id": 1,
        "question": "Saga 模式是什麼？它如何解決微服務中的分散式交易問題？",
        "expected_keywords": ["saga", "compensating transaction", "補償交易", "local transaction", "本地交易"],
        "golden_answer": "Saga 是一種在微服務架構中維護資料一致性的機制。它是一系列本地交易的序列，每個本地交易更新自己的資料庫並發布事件觸發下一個交易。若某步驟失敗，則執行補償交易 (compensating transactions) 來撤銷之前的變更。",
    },
    {
        "id": 2,
        "question": "Circuit Breaker（斷路器）模式的用途是什麼？",
        "expected_keywords": ["circuit breaker", "斷路器", "half-open", "半開", "threshold"],
        "golden_answer": "Circuit Breaker 模式用於防止服務在遠端呼叫失敗時不斷重試。當失敗次數超過閾值，斷路器會跳開 (open)，後續呼叫立即失敗而不實際發送請求。經過一段時間後進入半開 (half-open) 狀態嘗試恢復。",
    },
    {
        "id": 3,
        "question": "「按業務能力分解」(Decompose by business capability) 模式如何運作？",
        "expected_keywords": ["business capability", "業務能力", "decompose by business", "按業務能力分解"],
        "golden_answer": "此模式根據組織的業務能力來定義微服務。業務能力是組織為了創造價值而執行的事項，通常相當穩定。例如 FTGO 的業務能力包含供應商管理、消費者管理、訂單接收與履行、會計等，每項能力對應到一個或一組服務。",
    },
    {
        "id": 4,
        "question": "API Gateway 模式的主要功能與優缺點？",
        "expected_keywords": ["api gateway", "API 閘道", "request routing", "請求路由", "protocol translation"],
        "golden_answer": "API Gateway 是微服務架構的單一入口點，負責請求路由、API 組合與協議轉換。優點包含封裝內部結構、簡化客戶端呼叫。缺點是可能成為開發瓶頸、需要高可用部署。",
    },
    {
        "id": 5,
        "question": "CQRS (Command Query Responsibility Segregation) 模式的動機與運作方式？",
        "expected_keywords": ["cqrs", "command query responsibility segregation", "命令查詢職責分離", "read-only view", "唯讀視圖"],
        "golden_answer": "CQRS 將命令（寫入）與查詢（讀取）分離為不同的模型。動機是 API 組合模式無法有效實作某些跨服務查詢。CQRS 維護一個或多個由事件驅動更新的唯讀視圖資料庫，專門用於查詢。",
    },
    {
        "id": 6,
        "question": "微服務中的訊息傳遞 (Messaging) 有哪幾種訊息類型？",
        "expected_keywords": ["document", "command", "event", "文件", "命令", "事件", "message type", "訊息類型"],
        "golden_answer": "訊息分為三種類型：文件 (Document)——僅包含資料的通用訊息；命令 (Command)——相當於 RPC 請求，指定要執行的操作及其參數；事件 (Event)——表示發送者發生了值得注意的事情，通常是領域事件，代表領域物件的狀態變更。",
    },
    {
        "id": 7,
        "question": "什麼是 Strangler Application 模式？如何用它從單體式架構遷移到微服務？",
        "expected_keywords": ["strangler", "絞殺者", "migration", "遷移", "monolith", "單體"],
        "golden_answer": "Strangler Application 是一種漸進式遷移策略，新功能以微服務方式開發，同時逐步將舊功能從單體中抽取為獨立服務。隨時間推移，單體不斷縮小直到被完全取代或變成一個普通的服務。",
    },
    {
        "id": 8,
        "question": "API Composition 模式的三個缺點是什麼？",
        "expected_keywords": ["api composition", "API 組合", "increased overhead", "reduced availability", "data consistency", "增加的負擔", "可用性降低", "資料一致性"],
        "golden_answer": "API Composition 模式有三個缺點：1. 增加的負擔 (Increased overhead)——需要多次網路請求和資料庫查詢；2. 可用性降低的風險 (Risk of reduced availability)——涉及的服務越多可用性越低；3. 缺乏事務性資料一致性 (Lack of transactional data consistency)——多資料庫查詢可能返回不一致的資料。",
    },
    {
        "id": 9,
        "question": "在微服務架構中，服務發現 (Service Discovery) 有哪幾種模式？",
        "expected_keywords": ["service discovery", "服務發現", "service registry", "服務註冊", "3rd party registration", "client-side discovery", "server-side discovery"],
        "golden_answer": "服務發現主要有三種模式：1. 第三方註冊 (3rd party registration)——由 registrar（通常是部署平台）負責註冊；2. 客戶端發現 (Client-side discovery)——客戶端直接查詢服務註冊表；3. 伺服器端發現 (Server-side discovery)——客戶端向 DNS 名稱發出請求，由路由器查詢服務註冊表並負載平衡。",
    },
    {
        "id": 10,
        "question": "Event Sourcing（事件溯源）模式的核心概念是什麼？",
        "expected_keywords": ["event sourcing", "事件溯源", "event store", "事件存儲", "aggregate", "聚合", "replay", "重播"],
        "golden_answer": "Event Sourcing 以事件序列來持久化聚合體 (Aggregate) 的狀態，而非儲存當前狀態。每次狀態變更都記錄為一個事件並附加到事件存儲中。要還原聚合體的當前狀態，只需重播其所有事件。這確保了完整的審計軌跡，且天然支援事件驅動的架構。",
    },
    {
        "id": 11,
        "question": "按子領域分解 (Decompose by subdomain) 模式與 DDD 有什麼關係？",
        "expected_keywords": ["subdomain", "子領域", "domain-driven design", "領域驅動設計", "bounded context", "限界上下文"],
        "golden_answer": "此模式基於領域驅動設計 (DDD) 的概念。DDD 為每個子領域定義獨立的領域模型。子領域是領域 (domain) 的一部分，識別子領域的方式與識別業務能力相同：分析業務並辨識不同的專業領域。子領域對應到的服務與業務能力對應到的服務非常相似。DDD 中的 subdomains 和 bounded contexts 兩個概念在微服務架構中特別有用。",
    },
    {
        "id": 12,
        "question": "訊息通道 (Message Channel) 有哪兩種類型？各自的用途？",
        "expected_keywords": ["point-to-point", "點對點", "publish-subscribe", "發布-訂閱", "發佈-訂閱", "message channel", "訊息通道"],
        "golden_answer": "訊息通道有兩種類型：1. 點對點 (Point-to-point)——將訊息傳遞給恰好一個消費者，用於實現一對一的互動模式，例如命令訊息；2. 發布-訂閱 (Publish-subscribe)——將訊息傳遞給所有連接的消費者，用於實現一對多的互動模式，例如事件訊息。",
    },
]


def get_collection():
    """取得 Qdrant 客戶端。"""
    return get_qdrant_client()


def retrieve(question: str, client, top_k: int = TOP_K) -> list[dict]:
    """混合檢索：向量 + BM25 + Query Expansion。"""
    return hybrid_search(question, client, top_k=top_k)


# ── 檢索品質指標 ──────────────────────────────────────
def _chunk_matches_keywords(text: str, keywords: list[str]) -> bool:
    """判斷一個 chunk 是否包含任一期望關鍵詞（不區分大小寫）。"""
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in keywords)


def eval_retrieval(qa: dict, retrieved: list[dict]) -> dict:
    """計算單題的檢索指標（使用關鍵詞比對判斷命中）。"""
    keywords = qa["expected_keywords"]
    similarities = [r["similarity"] for r in retrieved]

    # 每個 chunk 是否命中
    chunk_hits = [_chunk_matches_keywords(r["text"], keywords) for r in retrieved]

    # Hit Rate: 前 K 筆是否命中任一
    hit = any(chunk_hits)

    # MRR: 第一個命中的排名倒數
    mrr = 0.0
    for rank, is_hit in enumerate(chunk_hits, 1):
        if is_hit:
            mrr = 1.0 / rank
            break

    # Precision@K: 前 K 筆中有多少命中
    hits_count = sum(chunk_hits)
    precision = hits_count / len(retrieved)

    # 命中的 chunk 頁碼
    hit_pages = [r["page"] for r, h in zip(retrieved, chunk_hits) if h]

    return {
        "hit": hit,
        "mrr": mrr,
        "precision": precision,
        "avg_similarity": sum(similarities) / len(similarities) if similarities else 0,
        "top1_similarity": similarities[0] if similarities else 0,
        "hit_pages": hit_pages,
    }


# ── 生成品質指標 (LLM-as-Judge) ─────────────────────
def _check_llm_available() -> bool:
    """檢查 LLM 模型是否可載入。"""
    try:
        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            "options": {"num_ctx": 512},
        }).encode()
        req = urllib.request.Request(
            "http://localhost:11434/api/chat",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp.read()
        return True
    except Exception as e:
        return False


def llm_call(prompt: str) -> str:
    """呼叫 LLM 取得回應（串流模式，與 rag_query.py 一致）。"""
    payload = json.dumps({
        "model": LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": True,
        "options": {"num_ctx": 4096, "temperature": 0.1, "stop": []},
    }).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    tokens = []
    with urllib.request.urlopen(req, timeout=300) as resp:
        for line in resp:
            if not line.strip():
                continue
            data = json.loads(line)
            token = data.get("message", {}).get("content", "")
            if token:
                tokens.append(token)
            if data.get("done"):
                break
    return "".join(tokens)


def generate_answer(question: str, context: str) -> str:
    """用 RAG 生成回答。"""
    prompt = f"""根據以下參考資料回答問題。請簡潔扼要地回答。

## 參考資料
{context}

## 問題
{question}
"""
    return llm_call(prompt)


def judge_faithfulness(question: str, context: str, answer: str) -> dict:
    """用 LLM 評估回答是否忠於 context（不幻覺）。"""
    prompt = f"""你是一位嚴格的評審。請評估以下「回答」是否完全基於「參考資料」中的內容，沒有編造不存在的資訊。

## 參考資料
{context[:3000]}

## 問題
{question}

## 回答
{answer}

請只回傳一個 JSON 物件，格式如下，不要加任何其他文字：
{{"score": <1-5的整數>, "reason": "<一句話說明>"}}

評分標準：
5 = 完全忠於參考資料
4 = 大部分忠於，有少量推論但合理
3 = 部分忠於，有些內容未在參考資料中
2 = 大部分不忠於參考資料
1 = 完全編造"""
    raw = llm_call(prompt)
    return _parse_judge_response(raw, "faithfulness")


def judge_relevancy(question: str, answer: str, golden_answer: str) -> dict:
    """用 LLM 評估回答與問題的相關性及正確性。"""
    prompt = f"""你是一位嚴格的評審。請比較「回答」與「標準答案」，評估回答是否切題且正確。

## 問題
{question}

## 標準答案
{golden_answer}

## 實際回答
{answer}

請只回傳一個 JSON 物件，格式如下，不要加任何其他文字：
{{"score": <1-5的整數>, "reason": "<一句話說明>"}}

評分標準：
5 = 涵蓋標準答案所有要點且正確
4 = 涵蓋大部分要點，遺漏少量
3 = 涵蓋約一半要點
2 = 僅涵蓋少量要點
1 = 完全離題或錯誤"""
    raw = llm_call(prompt)
    return _parse_judge_response(raw, "relevancy")


def _parse_judge_response(raw: str, metric_name: str) -> dict:
    """嘗試從 LLM 回應中解析 JSON 評分。"""
    # 嘗試找到 JSON 區塊
    text = raw.strip()
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            result = json.loads(text[start:end])
            score = int(result.get("score", 0))
            if 1 <= score <= 5:
                return {"score": score, "reason": result.get("reason", "")}
        except (json.JSONDecodeError, ValueError):
            pass
    return {"score": 0, "reason": f"無法解析 {metric_name} 回應: {text[:100]}"}


# ── 主流程 ───────────────────────────────────────────
def run_eval(skip_generation: bool = False):
    print("=" * 70)
    print("RAG 評估報告")
    print("=" * 70)

    client = get_collection()
    info = client.get_collection(COLLECTION_NAME)
    count = info.points_count
    print(f"向量資料庫: {count} 個文字塊 | TOP_K={TOP_K} | 測試題數: {len(GOLDEN_QA)}")

    # 自動偵測 LLM 是否可用
    if not skip_generation:
        print(f"檢查 LLM 模型 ({LLM_MODEL}) 是否可用...", end=" ")
        if _check_llm_available():
            print("OK")
        else:
            print("不可用 (記憶體不足?)")
            print("  → 自動切換為僅檢索評估模式。如需完整評估，請確保模型可載入。")
            skip_generation = True
    print()

    retrieval_results = []
    generation_results = []

    for qa in GOLDEN_QA:
        qid = qa["id"]
        question = qa["question"]
        print(f"─── 題 {qid:2d} ───────────────────────────────────────")
        print(f"  Q: {question}")

        # 1. 檢索評估
        retrieved = retrieve(question, client)
        ret_eval = eval_retrieval(qa, retrieved)
        retrieval_results.append(ret_eval)

        hit_str = "HIT" if ret_eval["hit"] else "MISS"
        print(f"  檢索: {hit_str} | MRR={ret_eval['mrr']:.2f} | "
              f"Precision={ret_eval['precision']:.2f} | "
              f"Top1 Sim={ret_eval['top1_similarity']:.3f}")
        if ret_eval["hit_pages"]:
            print(f"  命中頁碼: {ret_eval['hit_pages']}")
        else:
            retrieved_pages = [r["page"] for r in retrieved]
            print(f"  未命中! 檢索到頁碼: {retrieved_pages}")
            print(f"  期望關鍵詞: {qa['expected_keywords'][:3]}...")

        # 2. 生成品質評估
        if not skip_generation:
            context = "\n\n".join(
                f"[第 {r['page']} 頁] {r['text'][:500]}" for r in retrieved
            )
            answer = generate_answer(question, context)
            print(f"  A: {answer[:120]}...")

            faith = judge_faithfulness(question, context, answer)
            relev = judge_relevancy(question, answer, qa["golden_answer"])
            generation_results.append({
                "faithfulness": faith,
                "relevancy": relev,
                "answer": answer,
            })
            print(f"  Faithfulness={faith['score']}/5 ({faith['reason']})")
            print(f"  Relevancy  ={relev['score']}/5 ({relev['reason']})")
        print()

    # ── 彙總報告 ──────────────────────────────────────
    print("=" * 70)
    print("彙總結果")
    print("=" * 70)

    n = len(retrieval_results)
    hit_rate = sum(r["hit"] for r in retrieval_results) / n
    avg_mrr = sum(r["mrr"] for r in retrieval_results) / n
    avg_precision = sum(r["precision"] for r in retrieval_results) / n
    avg_sim = sum(r["avg_similarity"] for r in retrieval_results) / n
    avg_top1 = sum(r["top1_similarity"] for r in retrieval_results) / n

    print(f"\n[檢索品質] (TOP_K={TOP_K}, {n} 題)")
    print(f"  Hit Rate@{TOP_K}     : {hit_rate:.1%}  ({sum(r['hit'] for r in retrieval_results)}/{n})")
    print(f"  MRR@{TOP_K}          : {avg_mrr:.3f}")
    print(f"  Precision@{TOP_K}    : {avg_precision:.3f}")
    print(f"  Avg Similarity    : {avg_sim:.3f}")
    print(f"  Avg Top1 Sim      : {avg_top1:.3f}")

    if generation_results:
        valid_faith = [g["faithfulness"]["score"] for g in generation_results if g["faithfulness"]["score"] > 0]
        valid_relev = [g["relevancy"]["score"] for g in generation_results if g["relevancy"]["score"] > 0]

        print(f"\n[生成品質] ({len(generation_results)} 題)")
        if valid_faith:
            print(f"  Faithfulness 平均  : {sum(valid_faith)/len(valid_faith):.2f}/5")
        if valid_relev:
            print(f"  Relevancy 平均     : {sum(valid_relev)/len(valid_relev):.2f}/5")

        # 綜合 RAGAS-like 分數 (簡化版: 加權平均)
        if valid_faith and valid_relev:
            faith_norm = sum(valid_faith) / len(valid_faith) / 5
            relev_norm = sum(valid_relev) / len(valid_relev) / 5
            ragas = (hit_rate * 0.3 + faith_norm * 0.35 + relev_norm * 0.35)
            print(f"\n  綜合 RAG 分數       : {ragas:.1%}")
            print(f"    (= HitRate×0.3 + Faithfulness×0.35 + Relevancy×0.35)")

    # ── 逐題明細表 ────────────────────────────────────
    print(f"\n{'─'*70}")
    print(f"{'題號':>4} {'Hit':>4} {'MRR':>6} {'Prec':>6} {'Top1Sim':>8}", end="")
    if generation_results:
        print(f" {'Faith':>6} {'Relev':>6}", end="")
    print()
    print(f"{'─'*70}")

    for i, qa in enumerate(GOLDEN_QA):
        r = retrieval_results[i]
        print(f"{qa['id']:4d} {'Y' if r['hit'] else 'N':>4} "
              f"{r['mrr']:6.2f} {r['precision']:6.2f} {r['top1_similarity']:8.3f}", end="")
        if i < len(generation_results):
            g = generation_results[i]
            print(f" {g['faithfulness']['score']:6d} {g['relevancy']['score']:6d}", end="")
        print()

    print(f"{'─'*70}")
    print("完成!")


if __name__ == "__main__":
    skip_gen = "--retrieval-only" in sys.argv
    if skip_gen:
        print("模式: 僅評估檢索 (跳過生成品質)")
    run_eval(skip_generation=skip_gen)
