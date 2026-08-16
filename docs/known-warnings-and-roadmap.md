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
| 3 | onnxruntime (CosyVoice) | `CUDAExecutionProvider not available` -> CPU fallback | Slower TTS on GPU-less path; function OK | Rebuild onnxruntime with CUDA, or accept CPU | Medium |
| 4 | torch / transformers | `FutureWarning` (weight_norm, `torch.cuda.amp.autocast`), `UserWarning` (flash-attn) | Log noise only | Add `warnings.filterwarnings` suppression in server entry, or bump deps | Low |
| 5 | PowerShell console | Chinese shown as mojibake in attached console | Display only — app-internal logs now decode correctly | `chcp 65001` / use Windows Terminal (UTF-8) | Low |

> Note on #5: the Rust side already decodes GBK correctly. Any remaining console
> mojibake is the *terminal* code page (GBK) rendering UTF-8 text, not a code bug.

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
