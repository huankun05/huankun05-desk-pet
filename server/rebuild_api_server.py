"""rebuild_api_server.py
从 git HEAD 取干净 api_server.py，注入三处增强，写入工作树。
"""
import subprocess, sys

def main():
    cwd = r'F:\Work\Create\desk_pet\desk-pet'
    path = f'{cwd}/server/core/api_server.py'

    # 1. 读干净基线
    r = subprocess.run(
        ['git', 'show', 'HEAD:server/core/api_server.py'],
        capture_output=True, text=True, timeout=10, cwd=cwd
    )
    if r.returncode != 0:
        print(f"git show failed: {r.stderr[:300]}"); sys.exit(1)
    original = r.stdout

    mem_start = original.index('\nclass MemoryService:')
    time_start = original.index('\n\nclass TimeService:')
    clean_mem = original[mem_start:time_start]

    # 2. 增强1：get_stats
    get_stats = '''
    @staticmethod
    def get_stats(character_id: str = "default") -> dict:
        """记忆库统计信息。"""
        with get_db() as db:
            total = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ?",
                (character_id,),
            ).fetchone()[0]
            permanent = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ? AND is_permanent = 1",
                (character_id,),
            ).fetchone()[0]
            avg_imp_row = db.execute(
                "SELECT AVG(importance) FROM memory_fragments WHERE character_id = ?",
                (character_id,),
            ).fetchone()
            avg_imp = round(avg_imp_row[0] or 0, 3)
            recent = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ? AND created_at >= datetime('now', '-7 days')",
                (character_id,),
            ).fetchone()[0]
            accessed = db.execute(
                "SELECT COUNT(*) FROM memory_fragments WHERE character_id = ? AND access_count > 0",
                (character_id,),
            ).fetchone()[0]
        return {
            "total": total,
            "permanent": permanent,
            "ephemeral": total - permanent,
            "avg_importance": avg_imp,
            "recent_7d": recent,
            "accessed_ratio": round(accessed / total, 3) if total > 0 else 0,
        }

'''

    # 3. 增强2：extract_from_exchange
    extract = '''
    @staticmethod
    def extract_from_exchange(
        user_text: str,
        assistant_text: str,
        character_id: str = "default",
        user_id: str = "default",
        use_llm: bool = False,
    ) -> dict:
        """从对话交换中提取记忆碎片并持久化。"""
        from core.brain.scribe import Scribe, ExtractionConfig
        from core.brain.store import MemoryStore

        try:
            store = MemoryStore(character_id=character_id, user_id=user_id)
            scribe = Scribe(
                store=store,
                config=ExtractionConfig(enable_llm=use_llm),
            )
            fragments = scribe.reflect_and_save(user_text, assistant_text)
            return {"extracted": len(fragments), "fragments": [f.to_dict() for f in fragments]}
        except Exception as exc:
            return {"extracted": 0, "error": str(exc)}

'''

    # 4. 增强3：apply_decay_all
    orig_apply = '''    @staticmethod
    def apply_decay_all(character_id: str = "default") -> dict:
        """对所有非永久记忆应用遗忘曲线。"""
        frags = MemoryService.list_fragments(character_id, limit=1000)
        changed = 0
        with get_db() as db:
            for frag in frags:
                if frag["is_permanent"]:
                    continue
                mf = MemoryFragment(
                    id=frag["id"],
                    content=frag["content"],
                    importance=frag["importance"],
                    access_count=frag["access_count"],
                    is_permanent=frag["is_permanent"],
                )
                result = apply_decay(mf)
                if not result.should_keep:
                    db.execute("DELETE FROM memory_fragments WHERE id = ?", (frag["id"],))
                    changed += 1
                elif result.new_importance != frag["importance"]:
                    db.execute(
                        "UPDATE memory_fragments SET importance = ? WHERE id = ?",
                        (result.new_importance, frag["id"]),
                    )
                    changed += 1
        return {"processed": len(frags), "changed": changed}'''

    enhanced_apply = '''    @staticmethod
    def apply_decay_all(character_id: str = "default") -> dict:
        """对所有非永久记忆应用遗忘曲线 + 中等遗忘策略（importance<0.3 且 30 天未访问 → 删除）。"""
        from datetime import datetime as _dt
        frags = MemoryService.list_fragments(character_id, limit=1000)
        changed = 0
        deleted = 0
        with get_db() as db:
            for frag in frags:
                if frag["is_permanent"]:
                    continue
                mf = MemoryFragment(
                    id=frag["id"],
                    content=frag["content"],
                    importance=frag["importance"],
                    access_count=frag["access_count"],
                    is_permanent=frag["is_permanent"],
                )
                result = apply_decay(mf)
                should_delete = False
                if result.new_importance < 0.3 and frag["access_count"] == 0:
                    try:
                        last_acc = _dt.fromisoformat(frag["last_accessed"])
                        days_since = (_dt.now() - last_acc).days
                        if days_since > 30:
                            should_delete = True
                    except Exception:
                        pass
                if should_delete:
                    db.execute("DELETE FROM memory_fragments WHERE id = ?", (frag["id"],))
                    deleted += 1
                elif not result.should_keep:
                    db.execute("DELETE FROM memory_fragments WHERE id = ?", (frag["id"],))
                    deleted += 1
                elif result.new_importance != frag["importance"]:
                    db.execute(
                        "UPDATE memory_fragments SET importance = ? WHERE id = ?",
                        (result.new_importance, frag["id"]),
                    )
                    changed += 1
        return {"processed": len(frags), "changed": changed, "deleted": deleted}'''

    # 5. 注入增强
    new_mem = clean_mem.replace(orig_apply, enhanced_apply)
    new_mem = new_mem.replace(
        '    @staticmethod\n    def _row_to_dict',
        get_stats + '    @staticmethod\n    def _row_to_dict'
    )
    new_mem = new_mem.replace(
        '        return MemoryService.get_fragment(frag_id)\n\n    @staticmethod\n    def get_fragment(frag_id',
        extract + '        return MemoryService.get_fragment(frag_id)\n\n    @staticmethod\n    def get_fragment(frag_id'
    )

    # 6. 组装并写入
    new_file = original[:mem_start] + new_mem + original[time_start:]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_file)

    # 7. 验证
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    checks = {
        'get_stats': 'def get_stats(' in content,
        'extract_from_exchange': 'def extract_from_exchange(' in content,
        'apply_decay enhanced': '"deleted": deleted' in content,
        'stats before frag_id': content.index('get_stats') < content.index('{frag_id}'),
        'extract before get_fragment': content.index('extract_from_exchange') < content.index('def get_fragment'),
    }
    for k, v in checks.items():
        print(f"  {'✅' if v else '❌'} {k}")
    print(f"\nDone. {len(content)} chars written.")

if __name__ == '__main__':
    main()
