#!/usr/bin/env python3
"""
OpenAI-compatible API server，包裝 RAG 混合檢索 + LLM 回答。
供 OpenCode 或其他 OpenAI-compatible 客戶端使用。

啟動: python rag_server.py [--port 8000]
"""

import json
import sys
import time
import uuid
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread

from rag_config import (
    COLLECTION_NAME, TOP_K,
    hybrid_search, get_qdrant_client,
)

PORT = 8000
LLM_MODEL = "qwen3:14b-cloudnative"
QDRANT_CLIENT = None

SYSTEM_PROMPT = """你是一位資深的系統架構師，專精於微服務架構設計與 Kubernetes 容器編排。
你的知識來源是《Hands On Microservices With Kubernetes》這本書。

回答規則：
1. 根據提供的參考資料 (Context) 來回答問題
2. 如果參考資料中找不到答案，請誠實說明
3. 回答時盡量引用具體的章節、頁碼
4. 以繁體中文回答，但專有名詞可保留英文
5. 結合實際場景給出建議
"""


def rag_retrieve(question: str) -> str:
    """執行 RAG 檢索，回傳組合好的 context。"""
    results = hybrid_search(question, QDRANT_CLIENT, top_k=TOP_K)
    parts = []
    for i, r in enumerate(results):
        parts.append(
            f"[參考 {i+1}] (第 {r['page']} 頁, 相似度: {r['similarity']:.3f})\n{r['text']}"
        )
    return "\n\n---\n\n".join(parts)


def call_ollama_stream(messages: list[dict]):
    """呼叫 Ollama /api/chat，yield 每個 token。"""
    payload = json.dumps({
        "model": LLM_MODEL,
        "messages": messages,
        "stream": True,
        "options": {"num_ctx": 8192},
    }).encode()

    req = urllib.request.Request(
        "http://localhost:11434/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=600) as resp:
        for line in resp:
            if not line.strip():
                continue
            data = json.loads(line)
            token = data.get("message", {}).get("content", "")
            done = data.get("done", False)
            if token:
                yield token, done
            if done:
                return


class OpenAIHandler(BaseHTTPRequestHandler):
    """處理 OpenAI-compatible API 請求。"""

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {format % args}")

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_sse(self, data: str):
        self.wfile.write(f"data: {data}\n\n".encode())
        self.wfile.flush()

    def do_GET(self):
        if self.path in ("/v1/models", "/models"):
            self._send_json(200, {
                "object": "list",
                "data": [{
                    "id": "rag",
                    "object": "model",
                    "owned_by": "local",
                }],
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        messages = body.get("messages", [])
        stream = body.get("stream", False)

        # 取出最後一個 user message 作為查詢
        user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_msg = m["content"]
                break

        if not user_msg:
            self._send_json(400, {"error": "no user message"})
            return

        # RAG 檢索
        try:
            context = rag_retrieve(user_msg)
        except Exception as e:
            print(f"  RAG 檢索失敗: {e}")
            self._send_json(500, {"error": f"RAG retrieval failed: {e}"})
            return

        print(f"  RAG: 查詢「{user_msg[:60]}」→ 檢索到 {context.count('[參考')} 筆")

        # 組合 messages：system + context + user question
        rag_messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"## 參考資料 (Context)\n{context}\n\n## 問題\n{user_msg}"},
        ]

        chat_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
        created = int(time.time())

        try:
            self._handle_response(stream, chat_id, created, rag_messages)
        except Exception as e:
            print(f"  LLM 呼叫失敗: {e}")
            # If headers not sent yet, send error
            try:
                self._send_json(500, {"error": f"LLM call failed: {e}"})
            except Exception:
                pass

    def _handle_response(self, stream, chat_id, created, rag_messages):
        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            for token, done in call_ollama_stream(rag_messages):
                chunk = {
                    "id": chat_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": "rag",
                    "choices": [{
                        "index": 0,
                        "delta": {"content": token},
                        "finish_reason": "stop" if done else None,
                    }],
                }
                self._send_sse(json.dumps(chunk, ensure_ascii=False))

            self._send_sse("[DONE]")
        else:
            # Non-streaming: 收集全部 tokens
            full = []
            for token, done in call_ollama_stream(rag_messages):
                full.append(token)

            self._send_json(200, {
                "id": chat_id,
                "object": "chat.completion",
                "created": created,
                "model": "rag",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "".join(full)},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            })


def main():
    global QDRANT_CLIENT, PORT

    if "--port" in sys.argv:
        PORT = int(sys.argv[sys.argv.index("--port") + 1])

    # 連線 Qdrant
    QDRANT_CLIENT = get_qdrant_client()
    info = QDRANT_CLIENT.get_collection(COLLECTION_NAME)
    print(f"Qdrant 已連線: {info.points_count} points in '{COLLECTION_NAME}'")
    print(f"LLM: {LLM_MODEL}")
    print(f"RAG Server 啟動: http://localhost:{PORT}/v1/chat/completions")
    print(f"按 Ctrl+C 停止\n")

    server = HTTPServer(("0.0.0.0", PORT), OpenAIHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止。")
        server.server_close()


if __name__ == "__main__":
    main()
