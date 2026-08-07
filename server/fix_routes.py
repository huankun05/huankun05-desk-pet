"""fix_api_server_routes.py — 一次性修复 api_server.py 的所有路由/结构问题"""
import sys

def main():
    path = r'F:\Work\Create\desk_pet\desk-pet\server\core\api_server.py'
    with open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    changes = []

    # ─── 修复1: add_fragment 补全 return ───
    for i, line in enumerate(lines):
        if 'frag_id = cursor.lastrowid' in line and 420 < i < 450:
            # 检查下一行是不是 return
            if 'return MemoryService.get_fragment' not in lines[i+1]:
                lines.insert(i+1, '        return MemoryService.get_fragment(frag_id)\n')
                lines.insert(i+2, '\n')
                changes.append(f"L{i+2}: add_fragment return inserted")
            break

    # ─── 修复2: 提取 {frag_id} 路由并移到 Time section 前 ───
    def find_line(pat):
        for i, l in enumerate(lines):
            if pat in l:
                return i
        return -1

    get_idx = find_line('@app.get("/api/core/brain/memories/{frag_id}")')
    patch_idx = find_line('@app.patch("/api/core/brain/memories/{frag_id}')
    del_idx = find_line('@app.delete("/api/core/brain/memories/{frag_id}')
    apply_idx = find_line('@app.post("/api/core/brain/memories/apply-decay")')
    time_idx = find_line('# Time / 时间系统')

    if get_idx > 0 and time_idx > 0 and get_idx < time_idx:
        # 收集每个路由的完整块
        def collect_block(start):
            end = start + 1
            while end < len(lines) and not (lines[end].startswith('@app') or lines[end].strip() == ''):
                end += 1
            return lines[start:end]

        blocks = []
        for idx in [del_idx, patch_idx, get_idx]:
            if idx > 0:
                block = collect_block(idx)
                blocks.append((idx, block))

        # 从后往前删除
        for idx, _ in reversed(blocks):
            end = idx + 1
            while end < len(lines) and not (lines[end].startswith('@app') or lines[end].strip() == ''):
                end += 1
            del lines[idx:end]

        # 在 Time section 前插入
        for _, block in blocks:
            for line in reversed(block):
                lines.insert(time_idx, line)
        changes.append(f"Moved {len(blocks)} frag_id routes to before Time section")
    else:
        changes.append("frag_id routes already after Time section or not found")

    # ─── 修复3: 在 apply-decay 后确保有 extract + stats ───
    apply_idx = find_line('@app.post("/api/core/brain/memories/apply-decay")')
    if apply_idx > 0:
        # 找 apply-decay 后的插入点（跳过函数体）
        ins = apply_idx + 1
        while ins < len(lines) and not (lines[ins].startswith('@app') or lines[ins].strip() == ''):
            ins += 1
        while ins < len(lines) and lines[ins].strip() == '':
            ins += 1

        stats_missing = find_line('@app.get("/api/core/brain/memories/stats")') == -1
        extract_missing = find_line('@app.post("/api/core/brain/memories/extract")') == -1

        insert_lines = []
        if stats_missing:
            insert_lines.extend([
                '    @app.get("/api/core/brain/memories/stats")\n',
                '    def get_memory_stats(character_id: str = "default") -> dict:\n',
                '        return MemoryService.get_stats(character_id)\n',
                '\n',
            ])
        if extract_missing:
            insert_lines.extend([
                '    @app.post("/api/core/brain/memories/extract")\n',
                '    def extract_from_exchange(req: MemoryExtractRequest) -> dict:\n',
                '        return MemoryService.extract_from_exchange(\n',
                '            user_text=req.user_text,\n',
                '            assistant_text=req.assistant_text,\n',
                '            character_id=req.character_id,\n',
                '            user_id=req.user_id,\n',
                '            use_llm=req.use_llm,\n',
                '        )\n',
                '\n',
            ])

        if insert_lines:
            for j, line in enumerate(insert_lines):
                lines.insert(ins + j, line)
            changes.append(f"Inserted stats/extract at L{ins+1}")

    # 写回
    with open(path, 'w', encoding='utf-8') as f:
        f.writelines(lines)

    # 验证
    with open(path, 'r', encoding='utf-8') as f:
        final = f.readlines()

    print("Changes made:")
    for c in changes:
        print(f"  ✅ {c}")

    print("\nFinal route order:")
    for i, line in enumerate(final, 1):
        if 'app.get("/api/core/brain/memories' in line or 'app.post("/api/core/brain/memories' in line:
            print(f"  L{i}: {line.rstrip()}")

    # 关键检查
    checks = {
        'add_fragment return': 'return MemoryService.get_fragment(frag_id)' in ''.join(final),
        'stats before frag_id': False,
        'extract exists': False,
    }
    stats_line = next((i for i, l in enumerate(final) if '/memories/stats' in l), -1)
    frag_line = next((i for i, l in enumerate(final) if '/memories/{frag_id}' in l), -1)
    checks['stats before frag_id'] = stats_line < frag_line if stats_line > 0 and frag_line > 0 else False
    checks['extract exists'] = any('/memories/extract' in l for l in final)

    print("\nValidation:")
    for k, v in checks.items():
        print(f"  {'✅' if v else '❌'} {k}")

if __name__ == '__main__':
    main()
