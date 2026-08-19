# Known Warnings & Follow-up Roadmap

Tracks non-code-blocking issues and the remaining phases of the voice-assistant
permission system. Updated as items are triaged.

## 1. Recently fixed

- **stderr UTF-8 crash**: `service.rs` — replaced `reader.lines()` (strict UTF-8)
  with `read_until(b'\n')` + a `decode_stderr` helper (UTF-8 first, GBK via
  `encoding_rs` fallback, lossy UTF-8 last). Python services on Chinese Windows
  emit GBK stderr bytes; the old path threw `stream did not contain valid UTF-8`
  and closed the pipe. Now captured cleanly.
- **Chinese mojibake in logs**: same `decode_stderr` change now recovers Chinese
  text instead of `from_utf8_lossy` mangling GBK bytes.
- **10 dead_code warnings**: 9 functions marked `#[allow(dead_code)]`;
  `get_logs`/`logs` wired into the new `get_service_logs` Tauri command.
- **7 compile errors in `local_tools.rs`**: `IAudioEndpointVolume` path
  (`Win32::Media::Audio::Endpoints` + Cargo feature), missing `write_clipboard`,
  `SendInput`/`LockWorkStation`/`LoadXml` signatures.

## 2. Known warnings (non-blocking)

| # | Source | Warning | Impact | Suggested fix | Priority |
|---|--------|---------|--------|---------------|----------|
| 1 | pnpm | `global bin directory not in PATH` (from `pnpm add -g pnpm`) | None — `pnpm tauri dev` still works (v11.17.0) | Run `pnpm setup` to add bin to PATH, or ignore | Low |
| 2 | hermes-gateway | SQLite 3.49.1 WAL-reset corruption bug; auto switches to `journal_mode=DELETE` | None (auto-mitigated) | `hermes update` to upgrade embedded SQLite >= 3.51.3, or pin SQLite | Low |
| 3 | torch / transformers | `FutureWarning` (weight_norm, `torch.cuda.amp.autocast`), `UserWarning` (flash-attn) | Log noise only | Add `warnings.filterwarnings` suppression in server entry, or bump deps | Low |
| 4 | PowerShell console | Chinese shown as mojibake in attached console | Display only — app-internal logs now decode correctly | `chcp 65001` / use Windows Terminal (UTF-8) | Low |

> Note on #4: the Rust side already decodes GBK correctly. Any remaining console
> mojibake is the *terminal* code page (GBK) rendering UTF-8 text, not a code bug.

## 1b. ESLint frontend warnings (2026-08-19)

The frontend is TypeScript-strict + ESLint. 92 warnings were found; after cleanup
74 remain. They are non-blocking but tracked here so the team does not ignore
them.

| # | File(s) | Warning pattern | Count | Suggested fix | Priority |
|---|---------|-----------------|-------|---------------|----------|
| 1 | `.test.ts` / `solar-icons-custom/index.d.ts` | `no-explicit-any` | 25 | Replace `any` with typed interfaces / generics, or add `// @ts-ignore` with reason. `.d.ts` files may need upstream package patch. | Medium |
| 2 | `useHermesGateway.ts` / `ChatModesPage.tsx` / `useInteraction.ts` / ... | `set-state-in-effect` | 19 | Move initialization into a lazy `useState`/`useRef` pattern so state is set before mount, or remove the effect and use derived state. | Medium |
| 3 | `routes.tsx` / `ChatPanelWindow.tsx` / `PluginsPage.tsx` | `react-refresh/only-export-components` | 12 | Extract HOCs / constants / non-component helpers into a separate module so each file only exports components / hooks. | Low |
| 4 | `ChatPanelWindow.ts` / `useInteraction.ts` / ... | `exhaustive-deps` | 4 | Either add missing deps to the dependency array, or explicitly disable with a comment explaining why. | Low |
| 5 | `SettingsSearch.tsx` / `PluginsPage.tsx` / ... | `no-unused-vars` | 6 | Remove unused imports / variables, or prefix with `_`. | Low |
| 6 | `SettingsSearch.tsx` / `PluginsPage.tsx` / ... | `no-unused-vars` (remaining) | 8 | Same as #5 — most are dead imports after refactors. | Low |

## 3. Follow-up roadmap — permission system

- **P3**: TTS consent speech / voice response / emergency-stop / first-run wizard.
- **P4**: high-risk + PIN / undo preview / smart escalation / rate-limit.
- **P5**: wake sound-wave layer + live STT subtitles.

## 4. Build-environment note

`cargo check` / `tauri dev` can be very slow (~15–20 min) because the Tauri
build script registers the entire `../server` tree (GB model weights) as
`rerun-if-changed`, and Windows Defender real-time scan touches every file.
Add Defender exclusions for both `../server` and `../dist` to fix. The dev
machine already has exclusions, so local builds finish in seconds.
