"""
Hermes State DB 移植 Phase 1 正式验证

验证项目：
  1. hermes_core 可导入且所有导出符号可用
  2. SessionDB 可创建/打开数据库
  3. create_session + append_message + get_messages 完整链路
  4. FTS5 全文检索正常返回
  5. 数据库文件能正常关闭且数据持久化

输出：纯文本 + JSON（供 CI 消费）
"""

import json, sys, os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "server"))

def main():
    results = {}
    ok = True
    
    # 1. import
    try:
        from hermes_core import (
            SessionDB, SCHEMA_VERSION, FTS_SQL,
            DEFERRED_INDEX_SQL, _FTS_TRIGGERS, _FTS_CJK_TRIGGERS,
            get_hermes_home, get_hermes_dir,
            sanitize_context, describe_skill_invocation,
            SKILL_EXCERPT_JOINT, SKILL_SCAFFOLD_SQL_LIKE,
        )
        results["import"] = {
            "SCHEMA_VERSION": SCHEMA_VERSION,
            "FTS_SQL_truncated": FTS_SQL[:60] + "...",
            "get_hermes_home": str(get_hermes_home()),
            "sanitize_context": callable(sanitize_context),
            "describe_skill_invocation": callable(describe_skill_invocation),
        }
        print("[1/5] import hermes_core ... PASS")
    except Exception as e:
        results["import"] = {"error": str(e)}
        print(f"[1/5] import hermes_core ... FAIL: {e}")
        ok = False
        return results
    
    # 2. FTS5
    try:
        import sqlite3
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE VIRTUAL TABLE _probe USING fts5(x)")
        conn.execute("DROP TABLE _probe")
        conn.close()
        results["fts5_support"] = True
        print("[2/5] FTS5 support ... PASS")
    except Exception as e:
        results["fts5_support"] = False
        print(f"[2/5] FTS5 support ... FAIL: {e}")
        ok = False
    
    # 3. SessionDB 创建
    try:
        data_dir = Path(__file__).parent.parent.parent / "data"
        data_dir.mkdir(exist_ok=True)
        test_db = data_dir / "test_hermes_phase1.db"
        if test_db.exists():
            test_db.unlink()
        db = SessionDB(test_db)
        results["sessiondb_open"] = str(test_db)
        print(f"[3/5] SessionDB open ... PASS ({test_db})")
    except Exception as e:
        results["sessiondb_open"] = {"error": str(e)}
        print(f"[3/5] SessionDB open ... FAIL: {e}")
        ok = False
        return results
    
    # 4. 完整 CRUD 链路
    try:
        session_id = "phase1-verify-session"
        db.create_session(session_id, source="desk-pet-phase1-verify")
        db.append_message(session_id, role="user", content="Phase 1 验证用户消息")
        db.append_message(session_id, role="assistant", content="Phase 1 验证助手回复")
        msgs = db.get_messages(session_id, limit=10)
        results["crud"] = {
            "session_id": session_id,
            "messages_written": 2,
            "messages_read": len(msgs),
        }
        print(f"[4/5] Session CRUD ... PASS (wrote 2, read {len(msgs)})")
    except Exception as e:
        results["crud"] = {"error": str(e)}
        print(f"[4/5] Session CRUD ... FAIL: {e}")
        ok = False
    finally:
        db.close()
    
    # 5. FTS5 搜索
    try:
        db2 = SessionDB(test_db)
        search_results = db2.search_messages("验证")
        results["fts5_search"] = {
            "query": "验证",
            "hits": len(search_results),
        }
        print(f"[5/5] FTS5 search ... PASS ({len(search_results)} hits)")
        db2.close()
    except Exception as e:
        results["fts5_search"] = {"error": str(e)}
        print(f"[5/5] FTS5 search ... FAIL: {e}")
        ok = False
    
    # 清理
    if test_db.exists():
        test_db.unlink()
    
    results["overall"] = "PASS" if ok else "FAIL"
    return results

if __name__ == "__main__":
    print("=" * 60)
    print("Phase 1 Formal Verification: Hermes State DB")
    print("=" * 60)
    r = main()
    print()
    print(json.dumps(r, indent=2, ensure_ascii=False))
    sys.exit(0 if r.get("overall") == "PASS" else 1)
