#!/usr/bin/env python3
"""
RAG 環境檢查與安裝腳本。
檢查 Ollama 服務、模型、Python 套件是否就緒，並自動安裝缺少的部分。
"""

import subprocess
import sys
import shutil
import json
import urllib.request
import urllib.error


def run(cmd: str, capture: bool = True) -> tuple[int, str]:
    """執行 shell 指令並回傳 (returncode, stdout)。"""
    result = subprocess.run(
        cmd, shell=True, capture_output=capture, text=True
    )
    return result.returncode, (result.stdout + result.stderr).strip()


def check_ollama_installed() -> bool:
    """檢查 ollama CLI 是否已安裝。"""
    return shutil.which("ollama") is not None


def check_ollama_running() -> bool:
    """檢查 Ollama API 服務是否在運行。"""
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def get_installed_models() -> list[str]:
    """取得已安裝的 Ollama 模型清單。"""
    try:
        req = urllib.request.Request("http://localhost:11434/api/tags")
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


def check_python_package(package: str) -> bool:
    """檢查 Python 套件是否已安裝。"""
    try:
        __import__(package)
        return True
    except ImportError:
        return False


def install_python_packages(packages: list[str]):
    """安裝 Python 套件。"""
    cmd = [sys.executable, "-m", "pip", "install", "--break-system-packages"] + packages
    print(f"  執行: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


def pull_ollama_model(model: str):
    """下載 Ollama 模型。"""
    print(f"  執行: ollama pull {model}")
    subprocess.run(["ollama", "pull", model], check=True)


def main():
    print("=" * 60)
    print("RAG 環境檢查與安裝")
    print("=" * 60)

    all_ok = True

    # ── 1. 檢查 Ollama CLI ──
    print("\n[1/5] 檢查 Ollama CLI...")
    if check_ollama_installed():
        rc, ver = run("ollama --version")
        print(f"  OK: {ver}")
    else:
        print("  FAIL: 未安裝 Ollama。請先至 https://ollama.com 安裝。")
        all_ok = False

    # ── 2. 檢查 Ollama 服務 ──
    print("\n[2/5] 檢查 Ollama 服務...")
    if check_ollama_running():
        print("  OK: Ollama API 服務運行中 (http://localhost:11434)")
    else:
        print("  FAIL: Ollama 服務未運行。請執行 'ollama serve' 或 'systemctl start ollama'。")
        all_ok = False

    # ── 3. 檢查模型 ──
    print("\n[3/5] 檢查 Ollama 模型...")
    models = get_installed_models()

    required_models = {
        "nomic-embed-text": "Embedding 模型 (274 MB)",
        "bank-architect": "LLM 模型 (可替換為其他模型)",
    }

    for model, desc in required_models.items():
        found = any(model in m for m in models)
        if found:
            print(f"  OK: {model} — {desc}")
        else:
            print(f"  MISSING: {model} — {desc}")
            if model == "nomic-embed-text":
                answer = input(f"  是否自動下載 {model}? (y/n): ").strip().lower()
                if answer == "y":
                    pull_ollama_model(model)
                else:
                    all_ok = False
            else:
                print(f"  提示: 請執行 'ollama pull {model}' 或修改腳本中的 LLM_MODEL 設定。")
                all_ok = False

    # ── 4. 檢查 Python 套件 ──
    print("\n[4/5] 檢查 Python 套件...")
    package_map = {
        "fitz": "pymupdf",
        "chromadb": "chromadb",
        "ollama": "ollama",
    }

    missing = []
    for import_name, pip_name in package_map.items():
        if check_python_package(import_name):
            print(f"  OK: {pip_name}")
        else:
            print(f"  MISSING: {pip_name}")
            missing.append(pip_name)

    if missing:
        answer = input(f"  是否自動安裝 {', '.join(missing)}? (y/n): ").strip().lower()
        if answer == "y":
            install_python_packages(missing)
        else:
            all_ok = False

    # ── 5. 檢查向量資料庫 ──
    print("\n[5/5] 檢查向量資料庫...")
    import os
    chroma_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")
    if os.path.isdir(chroma_dir):
        try:
            import chromadb
            client = chromadb.PersistentClient(path=chroma_dir)
            col = client.get_collection("microservices_patterns")
            count = col.count()
            print(f"  OK: ChromaDB 已建立，包含 {count} 個文字塊")
        except Exception:
            print("  WARN: chroma_db 目錄存在但 collection 無效，請重新執行 ingest.py。")
            all_ok = False
    else:
        print("  WARN: 向量資料庫尚未建立，請執行 'python3 ingest.py'。")

    # ── 結果摘要 ──
    print("\n" + "=" * 60)
    if all_ok:
        print("所有檢查通過! 可以開始使用 RAG 系統。")
        print("\n  python3 ingest.py        # 建立向量資料庫 (首次)")
        print("  python3 rag_query.py     # 開始查詢")
    else:
        print("部分檢查未通過，請依照上述提示修正後重試。")
    print("=" * 60)


if __name__ == "__main__":
    main()
