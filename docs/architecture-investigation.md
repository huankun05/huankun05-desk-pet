# Architecture Investigation & Unification Plan

**Date**: 2026-08-17  
**Author**: 汐月 (Hermes Agent)  
**Status**: Draft — pending discussion with 锟哥

---

## 1. Current State: Two Cores, Two Memory Systems

### What We Have

```
server/
├── hermes_core/                    ← Hermes 原生核心（重型）
│   ├── hermes_state.py             ← SessionDB, FTS5, 8569 lines
│   ├── memory_manager.py
│   ├── message_sanitization.py
│   ├── sqlite_runtime.py
│   └── ...
│
├── core/                           ← 项目自研核心（轻量）
│   ├── brain/                      ← 记忆碎片系统（独立）
│   │   ├── store.py                ← MemoryStore, CRUD, 492 lines
│   │   ├── fragment.py
│   │   ├── archivist.py
│   │   ├── hebbian.py
│   │   ├── librarian.py
│   │   ├── scribe.py
│   │   └── memory_service.py
│   ├── api_server.py               ← Core API (port 9877)
│   ├── session_service.py          ← 接入 hermes_core.SessionDB
│   ├── heart/                      ← 情绪/表情/激素
│   ├── soul/                       ← 人格/漂移
│   └── time/                       ← 昼夜/纪念日
│
└── cosyvoice_server.py             ← TTS 服务（独立）
```

### Databases

| File | Managed By | Contents |
|------|-----------|----------|
| `data/hermes_state.db` | `hermes_core` | messages (353 rows), sessions (2), FTS5 index |
| `data/core.db` | `core/brain` | memory_fragments (4), emotion_history (3), personality_states (1) |
| `data/memories.db` | ~~旧 Hermes~~ | **DELETED** (0 rows, legacy) |

### The Problem: Two Brains

- **`hermes_core`** 管理会话历史、FTS5 全文检索、状态导入导出
- **`core/brain`** 管理记忆碎片、知识库、情绪/人格状态
- 两者**互不知晓**，各自写各自的数据库
- 前端记忆检索走**第三条路**：本地 RAG 引擎（BM25 + Ebbinghaus），不直接查这两个 DB

### Why This Is Unsustainable

1. **状态不一致风险**：情绪/人格状态和会话历史由两套代码分别更新
2. **功能重复**：两边都有"记忆"相关逻辑，新功能不知道改哪边
3. **维护成本翻倍**：bug fix、优化、重构都要改两处
4. **冲突 inevitable**：随着功能增加，两套系统必然出现数据竞争

---

## 2. Investigation Findings

### 2.1 Frontend Warning Issues

| Warning | Source | Impact | Fix Status |
|---------|--------|--------|-----------|
| SQLite WAL bug | Hermes Gateway (Python 3.12.10, SQLite 3.49.1) | Auto-degraded to `journal_mode=DELETE`, no functional impact | **Known issue** — upgrade Python to 3.13+ or Hermes update |
| torch weight_norm deprecated | CosyVoice upstream | Log noise | **Fixed** — added `warnings.filterwarnings` |
| onnxruntime Memcpy nodes | onnxruntime 1.20.0 | Performance degradation (CUDA graph disabled) | **Low priority** — can optimize model graph later |

### 2.2 TTS Hot-Swap & Fallback

**Status**: Already implemented ✅

- `manager.ts`: `markUnhealthy()` + `resolveActive()` with 5min TTL
- `ttsBackend.ts`: `switchActiveTTSBackend()` + `ensureActiveTTSBackend()`
- 5 backends registered: Edge TTS, CosyVoice V3, GPT-SoVITS v2, Piper, Custom

**Gap**: No user-visible notification when fallback happens.

**Fix applied**: Added `showToast()` in `pipeline/stages/tts.ts`:
- Backend unavailable → toast "TTS 服务不可用，请检查配置"
- Provider unreachable → toast "TTS 服务「xxx」不可用，已自动降级"

### 2.3 Frontend Bundle Size

**Finding**: Not redundant. All chunks are lazy-loaded route pages.

- `MarketplaceIndex`, `PluginsPage`, `Live2DPage`, etc. are all registered in `routes.tsx`
- Vite splits each route into independent chunks, loaded on demand
- Iconify chunk already optimized to 435KB

**Conclusion**: No cleanup needed. This is normal code-splitting.

---

## 3. Unification Plan: One Core, One Memory

### Core Principle

> **`hermes_core/` is the only core.**  
> **`core/brain/` functionality moves into `hermes_core/`.**  
> **Two DB files remain, but only `hermes_core` manages them.**

### Why Not Merge Database Files?

- `hermes_state.db`: messages + FTS5 + sessions (transaction-heavy, session-scoped)
- `core.db`: memory_fragments + emotion_history + personality_states (append-heavy, user-scoped)
- Different write patterns, different indexes, different lifecycle
- **Risk of merge**: FTS5 index rebuild, transaction conflicts, rollback complexity
- **Decision**: Keep two files, unify the code that accesses them

### Target Architecture

```
server/
├── hermes_core/                           ← ONLY CORE
│   ├── __init__.py                        ← re-export unified API
│   ├── hermes_state.py                    ← SessionDB (hermes_state.db)
│   ├── memory_unified.py                  ← NEW: unified memory interface
│   │   ├── search(query, limit)           ← FTS5 messages + BM25 fragments
│   │   ├── add_fragment(fragment)         ← write to core.db
│   │   └── get_session_history(session_id)← read from hermes_state.db
│   ├── memory_bridge.py                   ← NEW: wrap core/brain logic
│   │   └── MemoryStore (compat wrapper)   ← for gradual migration
│   ├── session_service.py                 ← existing, already uses SessionDB
│   ├── heart/                             ← emotion/expression/hormone
│   ├── soul/                              ← personality/drift
│   ├── time/                              ← circadian/anniversaries
│   └── ...
│
├── core/                                  ← BUSINESS LOGIC ONLY
│   ├── api_server.py                      ← routes call hermes_core
│   ├── session_service.py                 ← thin wrapper
│   ├── heart/                             ← moved from core/heart
│   ├── soul/                              ← moved from core/soul
│   ├── time/                              ← moved from core/time
│   └── brain/                             ← DEPRECATED (compat only)
│       └── store.py                       ← keep for now, remove later
│
└── cosyvoice_server.py                    ← standalone TTS
```

### Migration Path

#### Phase 1: Add Unified Interface (this week)
1. Create `hermes_core/memory_unified.py`
   - `search(query, limit)` — query both FTS5 and memory_fragments
   - `add_fragment(fragment)` — write to core.db
   - `get_session_history(session_id)` — read from hermes_state.db
2. Create `hermes_core/memory_bridge.py`
   - Wrap `core.brain.store.MemoryStore` as `hermes_core.MemoryStore`
   - Maintain backward compatibility for existing imports
3. Update `hermes_core/__init__.py` to re-export unified API

#### Phase 2: Migrate Callers (next week)
1. Update `core/api_server.py` memory routes → use `hermes_core.memory_unified`
2. Update `core/session.py` → use `hermes_core.memory_unified`
3. Update frontend `pipeline/stages/unified-memory.ts` → call backend unified API

#### Phase 3: Cleanup (after verification)
1. Mark `core/brain/memory_service.py` as deprecated
2. Remove direct `core.brain` imports from new code
3. Verify all memory operations go through `hermes_core`

---

## 4. Completed Fixes (2026-08-17)

### 4.1 Warnings
- [x] Suppress torch FutureWarning/UserWarning in `cosyvoice_server.py`
- [x] SQLite WAL bug: documented, auto-degraded, not blocking
- [x] onnxruntime performance warning: low priority, deferred

### 4.2 TTS Fallback Notification
- [x] Added `showToast()` in `pipeline/stages/tts.ts`
- [x] Backend unavailable → warning toast
- [x] Provider unreachable → "TTS 服务「xxx」不可用，已自动降级"

### 4.3 Cleanup
- [x] Deleted `data/memories.db` (legacy, 0 rows)
- [x] Verified `core.db` and `hermes_state.db` are the only active databases

---

## 5. Open Questions for Discussion

1. **Do we keep `core/brain/store.py` as a permanent compatibility layer, or plan to delete it?**
2. **Should the unified memory search be triggered from frontend or backend?** (Current: frontend RAG engine. Proposed: backend unified API + frontend RAG)
3. **Do we need a migration script for existing `core.db` data, or is it fresh enough to ignore?**
4. **Timeline**: aggressive (finish in 1 week) or conservative (2-3 weeks with testing)?

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Breaking existing memory API during migration | Medium | High | Keep `core/brain/store.py` as compat layer until all callers verified |
| FTS5 query performance with unified search | Low | Medium | Benchmark before/after; keep queries simple |
| Frontend RAG engine becomes redundant | Medium | Low | Deprecate gradually, not delete immediately |
| CosyVoice dependency on torch warnings resurfacing | Medium | Low | Already suppressed at server startup |

---

## 7. Next Steps (Pending 锟哥's Approval)

1. Review this document and provide feedback
2. Confirm migration timeline preference
3. Approve starting Phase 1: create `memory_unified.py` + `memory_bridge.py`
4. Discuss any additional concerns about the "one core" direction

---

*Document version: 1.0*  
*Last updated: 2026-08-17*
